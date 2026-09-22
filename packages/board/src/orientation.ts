// Board orientation — spec 10.2: "your own corner sits bottom-left. Playing Red
// against the computer rotates the board 180°."
//
// The engine's square numbering never rotates: a1 is square 72 whichever way
// the board is being looked at, and every rule, event and move string stays in
// those absolute terms. Orientation is a display mapping and nothing else.
//
// It lives in its own module, rather than inline in the renderer, because
// apps/web needs the SAME mapping read backwards: a pointer lands on a screen
// cell that has to become a Square, and an arrow key moves the cursor in
// SCREEN directions rather than board ones. Two implementations of that would
// disagree the first time one of them was touched — and they would disagree
// silently, as a click landing on the wrong square, which no type checks.

import { FILES, RANKS, colOf, rowOf, toIndex } from '@sps/engine';
import type { Side, Square } from '@sps/engine';

/** Whose own corner sits bottom-left. Blue is spec 10.2's default. */
export type Orientation = Side;

/** A position on screen: row 0 is the top row drawn, col 0 the leftmost. */
export interface Cell {
  row: number;
  col: number;
}

export const DEFAULT_ORIENTATION: Orientation = 'blue';

export function displayCell(square: Square, orientation: Orientation): Cell {
  const row = rowOf(square);
  const col = colOf(square);
  if (orientation === DEFAULT_ORIENTATION) return { row, col };
  return { row: RANKS - 1 - row, col: FILES - 1 - col };
}

/**
 * The inverse of `displayCell`. A 180° turn happens to be its own inverse, so
 * the two bodies are the same arithmetic — they are kept as separate named
 * functions anyway, because the call sites mean different things and because
 * an orientation that is NOT an involution (a quarter turn for a side-on
 * layout, say) would have to change both, rather than silently working in one
 * direction and returning the wrong square in the other.
 */
export function squareAtCell(row: number, col: number, orientation: Orientation): Square {
  if (orientation === DEFAULT_ORIENTATION) return toIndex(row, col);
  return toIndex(RANKS - 1 - row, FILES - 1 - col);
}
