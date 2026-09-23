// Spec 10.10: "The board is exposed as a grid of labelled cells (e5, Blue
// Scissors)." The SVG board is one `role="img"` (docs/VISUAL_SYSTEM.md,
// M3a) rather than a grid of focusable cells, so a screen-reader user gets
// that labelling from a visually-hidden live region that names whichever
// square the keyboard cursor is actually on — read by Game.tsx and
// Tutorial.tsx alike, so the two screens describe a square the same way.

import { EMPTY, decodePiece, squareName } from '@sps/engine';
import type { GameState, Square } from '@sps/engine';
import { pieceTypeName, sideName } from '@sps/board';

export function describeSquare(state: GameState, square: Square): string {
  const code = state.board[square]!;
  if (code === EMPTY) return `${squareName(square)}, empty`;
  const piece = decodePiece(code)!;
  const owner = piece.owner === 'neutral' ? 'Neutral' : sideName(piece.owner);
  return `${squareName(square)}, ${owner} ${pieceTypeName(piece.type)}`;
}
