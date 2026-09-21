// Self-play harness — spec 9.6. Use it before any rules change and in CI.
//
// The first run of the finished AI should land near the numbers in spec 6. Large
// differences point to a rules bug before they point to an AI difference.

import { applyMove, createGame, getVariant, other } from '@sps/engine';
import type { Side } from '@sps/engine';
import { chooseMove } from '@sps/ai';
import type { SimOptions, SimSummary } from './summary.js';

export { checkBalanceGuard, GUARD } from './summary.js';
export type { GuardVerdict, SimOptions, SimSummary } from './summary.js';
export { parseOptions, DEFAULTS } from './options.js';

/**
 * A distinct seed per game AND per ply. `chooseMove` is deterministic for a
 * given position and seed, so a seed that varied only per game would make every
 * move of that game a fixed function of the position — and every game with the
 * same opening identical.
 */
function seedFor(base: number, game: number, ply: number): number {
  let hash = (base ^ Math.imul(game + 1, 0x9e3779b9) ^ Math.imul(ply + 1, 0x85ebca6b)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x2c1b3c6d) >>> 0;
  return hash >>> 0;
}

const COUNTED_REASONS = ['corner', 'no-moves', 'repetition', 'move-limit'] as const;
type CountedReason = (typeof COUNTED_REASONS)[number];

function isCounted(reason: string): reason is CountedReason {
  return (COUNTED_REASONS as readonly string[]).includes(reason);
}

function share(part: number, whole: number): number {
  return whole === 0 ? 0 : Number((part / whole).toFixed(4));
}

export function runSimulation(options: SimOptions): SimSummary {
  const variant = getVariant(options.variant);
  const levels: Record<Side, SimOptions['blue']> = { blue: options.blue, red: options.red };

  const reasons: Record<CountedReason, number> = {
    corner: 0,
    'no-moves': 0,
    repetition: 0,
    'move-limit': 0,
  };

  let blue = 0;
  let red = 0;
  let draws = 0;
  let totalPlies = 0;
  let totalCaptures = 0;
  let wipedOutGames = 0;
  let firstWiperWon = 0;
  let sealedGames = 0;

  for (let game = 0; game < options.games; game++) {
    let state = createGame(variant);
    let captures = 0;
    let firstWiper: Side | null = null;
    let sealed = false;

    while (!state.result) {
      const { move } = chooseMove(state, levels[state.turn], seedFor(options.seed, game, state.ply));
      const applied = applyMove(state, move);

      for (const event of applied.events) {
        if (event.type === 'capture') captures++;
        // `side` is the side that LOST the type, so the wiper is its opponent.
        if (event.type === 'type-extinct' && firstWiper === null) firstWiper = other(event.side);
        if (event.type === 'sealed') sealed = true;
      }

      state = applied.state;
    }

    const result = state.result;
    if (isCounted(result.reason)) reasons[result.reason]++;

    if (result.winner === 'blue') blue++;
    else if (result.winner === 'red') red++;
    else draws++;

    totalPlies += state.ply;
    totalCaptures += captures;
    if (sealed) sealedGames++;
    if (firstWiper !== null) {
      wipedOutGames++;
      if (result.winner === firstWiper) firstWiperWon++;
    }
  }

  const games = options.games;

  return {
    variant: options.variant,
    blue,
    red,
    draws,
    reasons,
    avgPlies: games === 0 ? 0 : Number((totalPlies / games).toFixed(1)),
    avgCaptures: games === 0 ? 0 : Number((totalCaptures / games).toFixed(1)),
    typeWipedOutRate: share(wipedOutGames, games),
    firstToWipeOutWins: share(firstWiperWon, wipedOutGames),
    sealedRate: share(sealedGames, games),
  };
}
