// Capture motion — docs/VISUAL_SYSTEM.md 6, spec 3b/3c of the handoff.
//
// Pure lookup: (captorType, capturedType) -> which of the three motions plays.
// Never stored, never a setting — derived from the capture every time, the
// same way the ownership render mode is derived from square size rather than
// chosen. The actual animation (DOM transforms, timing) is apps/web's job,
// because this package has no DOM; what belongs here is the ONE fact every
// caller needs to agree on: which matchup gets which name.

import type { PieceType } from '@sps/engine';

export type MotionKind = 'crush' | 'cut' | 'wrap';

const MOTION_BY_MATCHUP: Record<PieceType, MotionKind> = {
  // captor's type -> motion. Legal captures are exactly beats(captorType) ===
  // capturedType, so the captor's type alone determines the motion.
  rock: 'crush', // Rock x Scissors
  scissors: 'cut', // Scissors x Paper
  paper: 'wrap', // Paper x Rock
};

export function captureMotion(captorType: PieceType): MotionKind {
  return MOTION_BY_MATCHUP[captorType];
}

/** Milestone timings, in ms — README 3b/3c. One motion per matchup is 200ms
 * total; the game-ending overlay layers four more steps on top. */
export const MOTION_MS = {
  capture: 200,
  slide: 150,
  endingFlash: 90,
  endingDissolve: 260,
  endingRing: 400,
  endingOverlayDelay: 600,
} as const;
