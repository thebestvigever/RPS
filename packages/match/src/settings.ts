// Display settings — spec 10.5 and 10.11, plus Zen.
//
// Every aid is on by default, as the spec asks, and each is switchable. Zen
// hides the lot without forgetting what the player chose: turning it off should
// give them back the board they had, not the defaults.

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
  /** Board and clocks only: hides the panels, move list and every aid. */
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

const NO_AIDS: Aids = {
  typeCounts: false,
  threatLines: false,
  raceMeter: false,
  permanentPieces: false,
  keepLock: false,
  dangerMarks: false,
  hint: false,
};

/**
 * What the board should actually show. Zen overrides the aids for as long as it
 * is on; it does not overwrite them, so switching it off restores the player's
 * own choices rather than the defaults.
 */
export function visibleAids(settings: DisplaySettings): Aids {
  return settings.zen ? NO_AIDS : settings.aids;
}
