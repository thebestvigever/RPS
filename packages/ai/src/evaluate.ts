// Evaluation — spec 9.2. These are the weights the reference AI used for every
// result in spec 6, so changing one invalidates those baselines: re-run the
// self-play harness (tools/sim) before and after.
//
// score  = 100  * (my pieces - their pieces)
//        +  70  * (my permanent pieces - their permanent pieces)
//        +  28  * (their nearest distance to goal - my nearest distance to goal)
//        + 0.35 * ( sum over my pieces (9 - d)^2 - sum over theirs (9 - d)^2 )
//
// Keep terms (on at Medium and Hard):
//        + 3000 if my corner is sealed, - 3000 if theirs is
//        +  6   * (8 - d) for each of my permanent pieces, d = distance to my own corner
//        -  6   * (8 - d) for each of their permanent pieces
//
// Distance is king distance to the NEAREST square of the relevant goal or corner
// (which is what makes the 2x2 Corner variant work). Neutral pieces are ignored;
// the search sees their captures anyway.

import { NotImplementedError } from '@sps/engine';
import type { GameState } from '@sps/engine';

export const WEIGHTS = {
  material: 100,
  permanent: 70,
  nearestDistance: 28,
  advancement: 0.35,
  sealed: 3000,
  permanentHome: 6,
} as const;

/** A win is +1,000,000 - ply and a loss -1,000,000 + ply, so the AI prefers
 *  faster wins and slower losses; a draw is 0 (spec 9.1). */
export const WIN_SCORE = 1_000_000;

export function terminalScore(kind: 'win' | 'loss' | 'draw', ply: number): number {
  if (kind === 'draw') return 0;
  return kind === 'win' ? WIN_SCORE - ply : -WIN_SCORE + ply;
}

/** From the point of view of the side to move. */
export function evaluate(_state: GameState, _keepTerms: boolean): number {
  throw new NotImplementedError('evaluate', '9.2');
}
