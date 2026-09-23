// Display settings — spec 10.5 and 10.11, plus Zen.
//
// Every aid is on by default, as the spec asks, and each is switchable. Zen
// quiets the board without forgetting what the player chose: turning it off
// should give them back the board they had, not the defaults. What it leaves
// standing is `ZEN_AIDS` below.

export interface Aids {
  /** Rock, Paper and Scissors counts in each panel. */
  typeCounts: boolean;
  /** Arrows to and from the pieces a selected piece can take, or be taken by. */
  threatLines: boolean;
  /** "Nearest runner: 4 moves" — smallest king distance to the goal. */
  raceMeter: boolean;
  /** A shield on any piece that can no longer be captured. */
  permanentPieces: boolean;
  /** A lock on a corner that has become unreachable. */
  keepLock: boolean;
  /** Warning marks on destinations where the moving piece could be taken. */
  dangerMarks: boolean;
  /** Suggested move, against Easy or Medium only (9.5). */
  hint: boolean;
}

export interface DisplaySettings {
  aids: Aids;
  /**
   * The quiet board: clocks and type counts stay, names and the move list go,
   * and every aid but the counts is hidden (`ZEN_AIDS`).
   */
  zen: boolean;
  coordinates: boolean;
  sound: boolean;
  /** Pass-and-play only, and off by default (10.2). */
  flipEachTurn: boolean;
  /** Warn before committing a drag, for people playing on a phone. */
  confirmMoves: boolean;
}

export const DEFAULT_SETTINGS: DisplaySettings = {
  aids: {
    typeCounts: true,
    threatLines: true,
    raceMeter: true,
    permanentPieces: true,
    keepLock: true,
    dangerMarks: true,
    hint: true,
  },
  zen: false,
  coordinates: true,
  sound: true,
  flipEachTurn: false,
  confirmMoves: false,
};

/**
 * What Zen leaves on.
 *
 * Type counts survive, and every other aid does not — Vig's call, and it
 * changes what the addendum first specified ("hides every aid"). The reason
 * is that Zen is meant to be a *quiet* board rather than a *bare* one: the
 * counts are the one aid that is not advice. Threat lines, the race meter,
 * shields, the Keep lock, danger marks and the hint all tell you what to
 * think about the position; the counts only say what is on it, which you can
 * get by looking at the board and counting. Hiding them makes the player do
 * clerical work, not deeper thinking, so Zen keeps them next to the clock.
 */
const ZEN_AIDS: Aids = {
  typeCounts: true,
  threatLines: false,
  raceMeter: false,
  permanentPieces: false,
  keepLock: false,
  dangerMarks: false,
  hint: false,
};

/**
 * What Hard hides — Vig's call on spec 14.5 (BUILD_PLAN.md's M6 open
 * question). Not just the hint, which §9.5 already restricts to Easy and
 * Medium: every advisory aid. A player who chose Hard chose to be tested
 * without the board doing the reading for them. Same shape as `ZEN_AIDS`,
 * and the same reasoning — type counts report the position rather than
 * advising on it, so they survive.
 */
const HARD_AIDS: Aids = { ...ZEN_AIDS };

/**
 * What the board should actually show. Zen overrides the aids for as long as it
 * is on; it does not overwrite them, so switching it off restores the player's
 * own choices rather than the defaults. Playing a Hard computer applies the
 * same kind of override on top, independently of Zen.
 *
 * Neither ever turns an aid ON that the player had chosen to hide — both are
 * quieting passes over their own settings, so an off count stays off.
 */
export function visibleAids(settings: DisplaySettings, hardOpponent = false): Aids {
  const aids = settings.zen
    ? { ...ZEN_AIDS, typeCounts: ZEN_AIDS.typeCounts && settings.aids.typeCounts }
    : settings.aids;
  if (!hardOpponent) return aids;
  return { ...HARD_AIDS, typeCounts: HARD_AIDS.typeCounts && aids.typeCounts };
}
