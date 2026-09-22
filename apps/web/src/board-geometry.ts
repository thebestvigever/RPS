// Pointer position -> board square. Pure arithmetic (spec 10.2's board is
// always a square 9x9 grid), kept separate from Game.tsx so the click/drag/
// keyboard state machine isn't tangled up with pixel math.

import { FILES, RANKS, colOf, rowOf, toIndex } from '@sps/engine';
import type { Square } from '@sps/engine';

export interface BoardRect {
  left: number;
  top: number;
  size: number; // the rendered board's width in CSS px (square, so also its height)
}

/** Null when the point falls outside the board. */
export function squareAt(rect: BoardRect, clientX: number, clientY: number): Square | null {
  const squarePx = rect.size / FILES;
  const col = Math.floor((clientX - rect.left) / squarePx);
  const row = Math.floor((clientY - rect.top) / squarePx);
  if (col < 0 || col >= FILES || row < 0 || row >= RANKS) return null;
  return toIndex(row, col);
}

export function clampSquare(square: Square, deltaRow: number, deltaCol: number): Square {
  const row = Math.min(RANKS - 1, Math.max(0, rowOf(square) + deltaRow));
  const col = Math.min(FILES - 1, Math.max(0, colOf(square) + deltaCol));
  return toIndex(row, col);
}

/** Pixel offset from `to` back to `from` — what a slide-in animation starts at. */
export function slideOffsetPx(from: Square, to: Square, squarePx: number): { dx: number; dy: number } {
  return {
    dx: (colOf(from) - colOf(to)) * squarePx,
    dy: (rowOf(from) - rowOf(to)) * squarePx,
  };
}
