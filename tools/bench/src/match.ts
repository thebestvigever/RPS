// Engine-versus-engine matches — docs/engine/06-MEASUREMENT-AND-LEVELS.md
// part one, §1. `tools/sim` already plays computer-vs-computer with a seed
// that varies per game and per ply, but only ever the same `Level` on both
// sides (spec 9.6's balance guard). This plays two different configurations
// against each other and reports the result as an Elo difference with an
// error bar, optionally stopping early once SPRT is conclusive.

import { applyMove, createGame, getVariant } from '@sps/engine';
import type { Side, VariantConfig, VariantId } from '@sps/engine';
import { chooseMove, resolveLevelConfig } from '@sps/ai';
import type { Level, LevelConfig } from '@sps/ai';
import { eloEstimate } from './elo.js';
import type { EloEstimate, WDL } from './elo.js';
import { sprt } from './sprt.js';
import type { SprtParams, SprtResult } from './sprt.js';

export type EngineConfig = Level | LevelConfig;

/**
 * The same configuration, but on a fast clock — docs/engine/06-MEASUREMENT-
 * AND-LEVELS.md part one: "at ~130 plies and 1.2s a move that is hours, so
 * also support a fast control (~50ms a move) for screening." Only changes
 * anything for a config whose `depth` is `'iterative'`; a fixed-depth config
 * has no time budget to shrink.
 */
export function fastControl(config: EngineConfig, budgetMs = 50): LevelConfig {
  return { ...resolveLevelConfig(config), budgetMs };
}

/** A hash of (gameSeed, ply) in the shape `tools/sim`'s own per-ply seed
 *  uses, so a game reached the same way plays out the same way. */
function plySeed(gameSeed: number, ply: number): number {
  let hash = (gameSeed ^ Math.imul(ply + 1, 0x85ebca6b)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x2c1b3c6d) >>> 0;
  return hash >>> 0;
}

export interface GameOutcome {
  winner: 'A' | 'B' | null;
  plies: number;
  reason: string;
}

/** Plays one game between `configA` and `configB`, with `aIsBlue` choosing
 *  which side gets the first move. */
export function playGame(
  variant: VariantConfig,
  configA: EngineConfig,
  configB: EngineConfig,
  aIsBlue: boolean,
  seed: number,
): GameOutcome {
  const bySide: Record<Side, EngineConfig> = aIsBlue
    ? { blue: configA, red: configB }
    : { blue: configB, red: configA };

  let state = createGame(variant);
  while (!state.result) {
    const { move } = chooseMove(state, bySide[state.turn], plySeed(seed, state.ply));
    state = applyMove(state, move).state;
  }

  const result = state.result;
  let winner: 'A' | 'B' | null = null;
  if (result.winner !== null) {
    const winnerIsA = aIsBlue ? result.winner === 'blue' : result.winner === 'red';
    winner = winnerIsA ? 'A' : 'B';
  }

  return { winner, plies: state.ply, reason: result.reason };
}

export interface MatchOptions {
  variant?: VariantId;
  configA: EngineConfig;
  configB: EngineConfig;
  /** Base seed. Each pair of colour-swapped games gets its own seed from here. */
  seed?: number;
  /** Fixed game count. Ignored once `sprt` is given — that stops itself. */
  games?: number;
  /** Hard cap so an inconclusive SPRT match still terminates. */
  maxGames?: number;
  sprt?: SprtParams;
}

export interface MatchResult {
  variant: VariantId;
  gamesPlayed: number;
  winsA: number;
  winsB: number;
  draws: number;
  /** Elo of A relative to B. */
  elo: EloEstimate;
  sprt?: SprtResult & { params: SprtParams };
}

const DEFAULT_GAMES = 200;
const DEFAULT_MAX_GAMES = 2000;

/**
 * Plays `configA` against `configB` and reports the result.
 *
 * Games are played in colour-swapped pairs from the same seed — A as blue
 * then A as red, both from the same starting branch — so a first-move
 * advantage in either config cancels out rather than being read as strength
 * (docs/engine/06-MEASUREMENT-AND-LEVELS.md part one, §1's "varied
 * openings").
 */
export function runMatch(options: MatchOptions): MatchResult {
  const variantId = options.variant ?? 'original';
  const variant = getVariant(variantId);
  const baseSeed = options.seed ?? 1;
  const target = options.sprt ? (options.maxGames ?? DEFAULT_MAX_GAMES) : (options.games ?? DEFAULT_GAMES);

  const wdl: WDL = { wins: 0, draws: 0, losses: 0 };
  let gamesPlayed = 0;
  let lastSprt: SprtResult | undefined;

  outer: for (let pair = 0; gamesPlayed < target; pair++) {
    const gameSeed = baseSeed + pair;

    for (const aIsBlue of [true, false]) {
      if (gamesPlayed >= target) break outer;

      const outcome = playGame(variant, options.configA, options.configB, aIsBlue, gameSeed);
      gamesPlayed++;
      if (outcome.winner === 'A') wdl.wins++;
      else if (outcome.winner === 'B') wdl.losses++;
      else wdl.draws++;

      if (options.sprt) {
        lastSprt = sprt(wdl, options.sprt);
        if (lastSprt.status !== 'continue') break outer;
      }
    }
  }

  const result: MatchResult = {
    variant: variantId,
    gamesPlayed,
    winsA: wdl.wins,
    winsB: wdl.losses,
    draws: wdl.draws,
    elo: eloEstimate(wdl),
  };

  if (options.sprt) {
    result.sprt = { ...(lastSprt ?? sprt(wdl, options.sprt)), params: options.sprt };
  }

  return result;
}
