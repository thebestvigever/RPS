// Player-facing vocabulary that depends only on rules, not on layout — spec
// 10.4's illegal-target reasons ("Paper beats Rock", "Same type — can't
// capture") and the notation type names they're built from. Kept here rather
// than in apps/web because the wording is specified by the rules spec, the
// same way moveToText's grammar is — an app that speaks a different language
// still wants these strings.

import type { PieceType } from '@sps/engine';

const DISPLAY_NAME: Record<PieceType, string> = {
  rock: 'Rock',
  paper: 'Paper',
  scissors: 'Scissors',
};

export function pieceTypeName(type: PieceType): string {
  return DISPLAY_NAME[type];
}

/**
 * Why `attacker` can't capture `defender` here — spec 10.4's two named cases.
 * Only meaningful when the move actually is illegal for one of these reasons
 * (same type, or the defender beats the attacker); a legal capture has no
 * reason to explain.
 */
export function illegalCaptureReason(attacker: PieceType, defender: PieceType): string {
  if (attacker === defender) return "Same type — can't capture";
  return `${pieceTypeName(defender)} beats ${pieceTypeName(attacker)}`;
}
