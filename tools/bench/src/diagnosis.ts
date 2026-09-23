// The diagnosis metrics, made permanent — docs/engine/06-MEASUREMENT-AND-
// LEVELS.md part one, §3: "turn 01-DIAGNOSIS.md's measurements into a
// permanent `tools/bench`... each of these is a one-line regression check."
//
//   | Metric                                    | Today  | Target  |
//   |--------------------------------------------|--------|---------|
//   | Moves leaving a piece hanging for free      | 32.7%  | < 5%    |
//   | Free threats ignored                        | 74%    | < 10%   |
//   | Depth reached in 1.2s (midgame)             | 3-4    | 7-8     |
//   | Nodes per second (midgame)                  | 24 500 | 150000+ |
//   | Effective branching factor                  | 14.3   | ~5      |
//
// (all measured at Hard). `hangingRate` reproduces the first two;
// `depthAndSpeed` and `branchingFactor` the rest — see 01-DIAGNOSIS.md §2-4
// for the original methodology this mirrors.

import { applyMove, createGame, getVariant, legalMoves, threatenedBy } from '@sps/engine';
import type { GameState, VariantId } from '@sps/engine';
import { chooseMove, hangingSquaresOf } from '@sps/ai';
import type { EngineConfig } from './match.js';

/** A hash of (gameSeed, ply), in the shape `tools/sim` and `src/match.ts` both
 *  use, so a run is reproducible from its seed. */
function plySeed(gameSeed: number, ply: number): number {
  let hash = (gameSeed ^ Math.imul(ply + 1, 0x85ebca6b)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x2c1b3c6d) >>> 0;
  return hash >>> 0;
}

function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : Number((part / whole).toFixed(4));
}

export interface HangingRateOptions {
  variant?: VariantId;
  level: EngineConfig;
  games: number;
  seed?: number;
}

export interface HangingRateResult {
  variant: VariantId;
  level: string;
  games: number;
  moves: number;
  /** "Moves leaving a piece hanging for free" — 01-DIAGNOSIS.md §2 col. 3. */
  leftHanging: number;
  leftHangingRate: number;
  /** Positions where the mover already had a piece hanging before it moved —
   *  01-DIAGNOSIS.md §2 col. 4's denominator. */
  alreadyHanging: number;
  /** ...and played a move that did nothing about it — the numerator. */
  ignoredHanging: number;
  ignoredHangingRate: number;
}

/**
 * Self-plays `level` against itself for `games` games and measures the two
 * headline diagnosis metrics: how often a move leaves a piece hanging for
 * free, and how often a position that already had one gets ignored.
 *
 * "Fixed" mirrors `generate-tactics.ts`'s `fixesFor` and search.ts's own
 * `evasions()`: moving the hanging piece away, or capturing whatever was
 * threatening it. One definition of "hanging", used everywhere it matters —
 * `evaluate.ts`'s threat term, the quiescence evasions, and this metric.
 */
export function hangingRate(options: HangingRateOptions): HangingRateResult {
  const variantId = options.variant ?? 'original';
  const variant = getVariant(variantId);
  const seed = options.seed ?? 1;

  let moves = 0;
  let leftHanging = 0;
  let alreadyHanging = 0;
  let ignoredHanging = 0;

  for (let game = 0; game < options.games; game++) {
    // Distinct from the per-ply seed itself, so different games don't retread
    // the same ply-indexed hash values.
    const gameSeed = seed + game * 7919;
    let state: GameState = createGame(variant);

    while (!state.result) {
      const mover = state.turn;
      const before = hangingSquaresOf(state, mover);

      const { move } = chooseMove(state, options.level, plySeed(gameSeed, state.ply));
      const after = applyMove(state, move).state;

      moves++;
      if (hangingSquaresOf(after, mover).length > 0) leftHanging++;

      if (before.length > 0) {
        alreadyHanging++;
        const attackers = new Set<number>();
        for (const square of before) {
          for (const attacker of threatenedBy(state, square)) attackers.add(attacker);
        }
        const fixed = before.includes(move.from) || (move.captured !== null && attackers.has(move.to));
        if (!fixed) ignoredHanging++;
      }

      state = after;
    }
  }

  return {
    variant: variantId,
    level: typeof options.level === 'string' ? options.level : 'custom',
    games: options.games,
    moves,
    leftHanging,
    leftHangingRate: rate(leftHanging, moves),
    alreadyHanging,
    ignoredHanging,
    ignoredHangingRate: rate(ignoredHanging, alreadyHanging),
  };
}

/**
 * A reproducible "midgame" position: Medium self-play from the start, for
 * `targetPly` plies (default 30, matching 01-DIAGNOSIS.md §3-4's own
 * benchmark position). Deterministic from `variant` and `seed`, so it needs no
 * fixture file — regenerating it IS the test that today's engine still
 * reaches a comparable position, which a frozen FEN would not catch.
 */
export function midgamePosition(variantId: VariantId = 'original', seed = 1, targetPly = 30): GameState {
  const variant = getVariant(variantId);
  let state = createGame(variant);
  while (!state.result && state.ply < targetPly) {
    const { move } = chooseMove(state, 'medium', plySeed(seed, state.ply));
    state = applyMove(state, move).state;
  }
  return state;
}

export interface DepthAndSpeedResult {
  ply: number;
  legalMoves: number;
  depth: number;
  nodes: number;
  ms: number;
  nodesPerSecond: number;
}

/** Depth reached and nodes/second at Hard's real 1.2s budget, on the midgame
 *  benchmark position — 01-DIAGNOSIS.md §3-4. */
export function depthAndSpeed(
  options: { variant?: VariantId; seed?: number; targetPly?: number } = {},
): DepthAndSpeedResult {
  const seed = options.seed ?? 1;
  const state = midgamePosition(options.variant ?? 'original', seed, options.targetPly ?? 30);
  const { stats } = chooseMove(state, 'hard', seed + 1);

  return {
    ply: state.ply,
    legalMoves: legalMoves(state).length,
    depth: stats.depth,
    nodes: stats.nodes,
    ms: stats.ms,
    nodesPerSecond: stats.ms > 0 ? Math.round((stats.nodes / stats.ms) * 1000) : stats.nodes,
  };
}

export interface BranchingFactorResult {
  ply: number;
  /** One honest (unbounded, jitter-off) fixed-depth search per depth from
   *  `minDepth` to `maxDepth`. */
  samples: Array<{ depth: number; nodes: number; ms: number }>;
  /** nodes(depth) / nodes(depth - 1) for each consecutive pair above. */
  effectiveBranchingFactors: number[];
}

/**
 * Effective branching factor from consecutive fixed depths on the midgame
 * benchmark position — 01-DIAGNOSIS.md §3's "effective branching factor from
 * depth 3 to 4: 14.3x".
 *
 * Capped at depth 4 by default: depth 5 alone cost 37-115 seconds a position
 * pre-04-SPEED.md/03-SEARCH.md (01-DIAGNOSIS.md §3), which is affordable once
 * but not as a default for a tool meant to run often. Pass a higher
 * `maxDepth` once the search is faster.
 */
export function branchingFactor(
  options: {
    variant?: VariantId;
    seed?: number;
    targetPly?: number;
    minDepth?: number;
    maxDepth?: number;
  } = {},
): BranchingFactorResult {
  const seed = options.seed ?? 1;
  const state = midgamePosition(options.variant ?? 'original', seed, options.targetPly ?? 30);
  const minDepth = options.minDepth ?? 1;
  const maxDepth = options.maxDepth ?? 4;

  const samples: Array<{ depth: number; nodes: number; ms: number }> = [];
  for (let depth = minDepth; depth <= maxDepth; depth++) {
    // jitter: Infinity is 01-DIAGNOSIS.md §3's own method for "the honest
    // cost": it disables the root window, so this is an unpruned-at-the-root
    // fixed-depth search, not what a real move choice would spend.
    const { stats } = chooseMove(
      state,
      { depth, minDepth: depth, jitter: Infinity, keepTerms: true, budgetMs: Infinity },
      seed + depth,
    );
    samples.push({ depth: stats.depth, nodes: stats.nodes, ms: stats.ms });
  }

  const effectiveBranchingFactors: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const prevNodes = samples[i - 1]!.nodes;
    effectiveBranchingFactors.push(prevNodes > 0 ? samples[i]!.nodes / prevNodes : 0);
  }

  return { ply: state.ply, samples, effectiveBranchingFactors };
}
