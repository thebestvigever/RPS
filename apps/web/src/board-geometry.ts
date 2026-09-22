// Pointer position -> board square, and arrow key -> next square. Pure
// arithmetic (spec 10.2's board is always a square 9x9 grid), kept separate
// from Game.tsx so the click/drag/keyboard state machine isn't tangled up with
// pixel math.
//
// Everything here works in SCREEN space and converts at the edges, using
// @sps/board's own `displayCell`/`squareAtCell` rather than a second copy of
// the rotation. That matters more than it looks: once the board can be turned
// around (spec 10.2), a click is at a screen cell and has to come back as an
// absolute Square, and "up" means one row up the SCREEN, not one rank up the
// board. Two implementations of that would disagree silently, as taps landing
// on the wrong square — which nothing type-checks and no unit test of the
// renderer would see.

import { FILES, RANKS } from '@sps/engine';
import type { Square } from '@sps/engine';
import { displayCell, squareAtCell } from '@sps/board';
import type { Orientation } from '@sps/board';

export interface BoardRect {
  left: number;
  top: number;
  size: number; // the rendered board's width in CSS px (square, so also its height)
}

/** Null when the point falls outside the board. */
export function squareAt(
  rect: BoardRect,
  clientX: number,
  clientY: number,
  orientation: Orientation,
): Square | null {
  const squarePx = rect.size / FILES;
  const col = Math.floor((clientX - rect.left) / squarePx);
  const row = Math.floor((clientY - rect.top) / squarePx);
  if (col < 0 || col >= FILES || row < 0 || row >= RANKS) return null;
  return squareAtCell(row, col, orientation);
}

/**
 * The square one step from `square` in a SCREEN direction, stopping at the
 * edge. Spec 10.4's arrow keys move a cursor across what the player can see,
 * so a Red-playing human pressing Up moves the cursor up the screen — which
 * is down the board in the engine's absolute numbering.
 */
export function clampSquare(
  square: Square,
  deltaRow: number,
  deltaCol: number,
  orientation: Orientation,
): Square {
  const cell = displayCell(square, orientation);
  const row = Math.min(RANKS - 1, Math.max(0, cell.row + deltaRow));
  const col = Math.min(FILES - 1, Math.max(0, cell.col + deltaCol));
  return squareAtCell(row, col, orientation);
}

/** Pixel offset from `to` back to `from` — what a slide-in animation starts at. */
export function slideOffsetPx(
  from: Square,
  to: Square,
  squarePx: number,
  orientation: Orientation,
): { dx: number; dy: number } {
  const start = displayCell(from, orientation);
  const end = displayCell(to, orientation);
  return {
    dx: (start.col - end.col) * squarePx,
    dy: (start.row - end.row) * squarePx,
  };
}
