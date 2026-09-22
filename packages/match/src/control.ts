// Whose pieces this device may move.
//
// This is a MODE question, which is why it lives here beside the offer, gift
// and premove policies rather than as an expression inside the board
// component. It was an expression inside the board component, and it was
// wrong: pass-and-play is one person playing BOTH sides (spec 10.1), but the
// interface tracked a single `humanSide` that was hardcoded to Blue whenever
// there was no computer — so the moment Blue moved, nothing was selectable
// and the game could not be continued.
//
// The clock still passed to Red, so it looked like a board that had stopped
// responding rather than one that disagreed with itself about who was
// playing. Nothing type-checked it, and nothing could: both sides of the
// comparison were valid `Side`s.

import type { Side } from '@sps/engine';
import type { MatchMode } from './offers.js';

/**
 * May the person at this device move `side`'s pieces?
 *
 * `humanSide` is which side they are playing, and is meaningless in
 * pass-and-play — the mode answers first, before the side is even consulted.
 */
export function controlsSide(mode: MatchMode, side: Side, humanSide: Side): boolean {
  return mode === 'pass-and-play' || side === humanSide;
}
