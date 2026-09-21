// Answering a draw offer — spec addendum, clocks and offers.
//
// An engine should take a draw when it isn't winning and refuse when it is.
// This game gives one extra, unusually clean signal: when BOTH corners are
// sealed, neither side can win by the corner (2.10), and the spec's own
// simulations found that is where the Original's draws come from (6.3). A
// position like that is heading for a repetition or the 300-ply limit whatever
// anyone does, so there is nothing to play on for.

import { canHoldSeal, isSealed, other } from '@sps/engine';
import type { GameState, Side } from '@sps/engine';
import { LEVELS } from './levels.js';
import type { Level } from './levels.js';
import { analyseRoot } from './search.js';

/**
 * Accept while the advantage is under this. A piece is worth 100 (9.2), so
 * this is "not up so much as half a piece".
 */
export const DRAW_ACCEPT_THRESHOLD = 60;

/**
 * Below this many plies a draw offer is not a serious one — it is a player
 * trying their luck before the game has a shape. Spec 6.1 puts a real game at
 * 129-138 plies, so this is the first tenth of one.
 */
export const DRAW_MIN_PLY = 24;

export interface DrawDecision {
  accept: boolean;
  /** Plain words, for the status line (10.6). */
  reason: string;
  /** The computer's own evaluation, positive when it is ahead. */
  score: number;
}

export function shouldAcceptDraw(
  state: GameState,
  side: Side,
  level: Level,
  seed: number,
): DrawDecision {
  if (state.result) {
    return { accept: false, reason: 'the game is already over', score: 0 };
  }

  // Both corners sealed AND both seals able to survive the next move: nobody
  // can win by the corner, so there is nothing to play for but the move limit.
  //
  // The second half matters. There is no passing (2.4), so a Keep held by a
  // side's only piece is forced open on their turn — a position that merely
  // LOOKS sealed can be one move from losing. Accepting a draw there would be
  // giving away a win.
  const opponent = other(side);
  if (
    isSealed(state, side) &&
    isSealed(state, opponent) &&
    canHoldSeal(state, side) &&
    canHoldSeal(state, opponent)
  ) {
    return { accept: true, reason: 'both corners are sealed', score: 0 };
  }

  if (state.ply < DRAW_MIN_PLY) {
    return { accept: false, reason: 'it is too early to tell', score: 0 };
  }

  const config = LEVELS[level];
  const depth = config.depth === 'iterative' ? config.minDepth : config.depth;
  const scored = analyseRoot(state, {
    depth,
    keepTerms: config.keepTerms,
    seed,
    // A full window: this is a judgement about the position, not a move choice,
    // so the number has to be the real one.
    jitter: Infinity,
  });

  // analyseRoot scores from the point of view of the side to move.
  const best = scored[0]?.score ?? 0;
  const score = state.turn === side ? best : -best;

  return score <= DRAW_ACCEPT_THRESHOLD
    ? { accept: true, reason: 'the position is level enough', score }
    : { accept: false, reason: 'it still has winning chances', score };
}
