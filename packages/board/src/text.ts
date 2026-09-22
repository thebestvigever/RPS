// Player-facing vocabulary that depends only on rules, not on layout — spec
// 10.4's illegal-target reasons ("Paper beats Rock", "Same type — can't
// capture") and the notation type names they're built from. Kept here rather
// than in apps/web because the wording is specified by the rules spec, the
// same way moveToText's grammar is — an app that speaks a different language
// still wants these strings.

import { beats } from '@sps/engine';
import type { PieceType, Side } from '@sps/engine';

const DISPLAY_NAME: Record<PieceType, string> = {
  rock: 'Rock',
  paper: 'Paper',
  scissors: 'Scissors',
};

export function pieceTypeName(type: PieceType): string {
  return DISPLAY_NAME[type];
}

const SIDE_NAME: Record<Side, string> = { blue: 'Blue', red: 'Red' };

/** Pass-and-play's optional player names (App's name fields), keyed by side. A missing or blank entry falls back to the colour name. */
export type SideNames = Partial<Record<Side, string>>;

export function sideName(side: Side, names?: SideNames): string {
  return names?.[side]?.trim() || SIDE_NAME[side];
}

/**
 * Spec 10.4: selecting a neutral piece explains itself in the status line —
 * either the capture it's lined up (its type beats exactly one other, so the
 * victim's type is never ambiguous) or why nothing happened. `hasCapture`
 * comes from the legal-move list already computed for the turn, not
 * recomputed here — this is wording, not rules.
 */
export function neutralSelectionText(
  type: PieceType,
  opponentSide: Side,
  hasCapture: boolean,
  names?: SideNames,
): string {
  if (!hasCapture) return 'Neutrals only move to capture';
  return `Using the neutral ${pieceTypeName(type)} — capture a ${sideName(opponentSide, names)} ${pieceTypeName(beats(type))}`;
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
