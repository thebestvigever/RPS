// Player-facing vocabulary that depends only on rules, not on layout — spec
// 10.4's illegal-target reasons ("Paper beats Rock", "Same type — can't
// capture") and the notation type names they're built from. Kept here rather
// than in apps/web because the wording is specified by the rules spec, the
// same way moveToText's grammar is — an app that speaks a different language
// still wants these strings.

import { beats, other } from '@sps/engine';
import type { PieceType, Side } from '@sps/engine';

const DISPLAY_NAME: Record<PieceType, string> = {
  rock: 'Rock',
  paper: 'Paper',
  scissors: 'Scissors',
};

export function pieceTypeName(type: PieceType): string {
  return DISPLAY_NAME[type];
}

/** "Rocks", "Papers" — but "Scissors", not "Scissorss" (spec 10.5's panel copy). */
function pluralTypeName(type: PieceType): string {
  return type === 'scissors' ? DISPLAY_NAME.scissors : `${DISPLAY_NAME[type]}s`;
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

/**
 * The type-count aid's "consequence spelled out" (spec 10.5): "Red has no
 * Paper left — Blue's Rocks are permanent." `outSide`/`outType` are whose
 * count just hit zero — the permanent beneficiary is always the OTHER side,
 * holding the type that `outType` used to prey on (`beats(outType)`), since
 * a side's own pieces were never what threatened its own type.
 *
 * This is the two-side rule the spec's example gives; it does not account
 * for a surviving neutral of the same type (4.2), which can keep the
 * opponent's piece capturable even after both sides' own count reaches
 * zero. Callers should gate this on the engine's own `isPermanent` for a
 * piece of that type, not on the count alone.
 */
export function permanentPieceText(outSide: Side, outType: PieceType, names?: SideNames): string {
  const permanentSide = other(outSide);
  const permanentType = beats(outType);
  return `${sideName(outSide, names)} has no ${pieceTypeName(outType)} left — ${sideName(permanentSide, names)}'s ${pluralTypeName(permanentType)} are permanent`;
}

/** The Keep's panel line (spec 7.6, 10.5): "Blue's corner is sealed — Red can't win by the corner." */
export function keepLockText(sealedSide: Side, names?: SideNames): string {
  return `${sideName(sealedSide, names)}'s corner is sealed — ${sideName(other(sealedSide), names)} can't win by the corner`;
}

/** The race meter's panel line (spec 10.5): "Nearest runner: 4 moves." `distance` is `nearestRunner`'s own return, including its `Infinity` for a side with nothing left. */
export function raceMeterText(distance: number): string {
  if (!Number.isFinite(distance)) return 'Nearest runner: none left';
  return `Nearest runner: ${distance} move${distance === 1 ? '' : 's'}`;
}
