// Evaluation — spec 9.2. These are the weights the reference AI used for every
// result in spec 6, so changing one invalidates those baselines: run
// `pnpm sim` before and after, and say what moved.
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
// Distance is king distance to the NEAREST square of the relevant goal or
// corner, which is what makes the 2x2 Corner variant work. Neutral pieces are
// ignored; the search sees their captures anyway.

import { EMPTY, SQUARE_COUNT, decodePiece, isSealed, other, permanentMask } from '@sps/engine';
import type { GameState, Side } from '@sps/engine';
import { distanceTables } from './tables.js';

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

/** No piece of a side left: 9 is one past the longest real king distance, 8. */
const NO_RUNNER = 9;

interface SideTerms {
  pieces: number;
  permanent: number;
  nearest: number;
  advancement: number;
  permanentHome: number;
}

/** From the point of view of the side to move. */
export function evaluate(state: GameState, keepTerms: boolean): number {
  const me = state.turn;
  const them = other(me);
  const { board, variant } = state;
  const tables = distanceTables(variant);
  const permanent = permanentMask(state);

  const terms: Record<Side, SideTerms> = {
    blue: { pieces: 0, permanent: 0, nearest: NO_RUNNER, advancement: 0, permanentHome: 0 },
    red: { pieces: 0, permanent: 0, nearest: NO_RUNNER, advancement: 0, permanentHome: 0 },
  };

  for (let square = 0; square < SQUARE_COUNT; square++) {
    const code = board[square]!;
    if (code === EMPTY) continue;

    const owner = decodePiece(code)!.owner;
    if (owner === 'neutral') continue;

    const side = terms[owner];
    side.pieces++;

    const toGoal = tables.toGoal[owner][square]!;
    if (toGoal < side.nearest) side.nearest = toGoal;
    side.advancement += (9 - toGoal) ** 2;

    if (permanent[square]) {
      side.permanent++;
      side.permanentHome += 8 - tables.toHome[owner][square]!;
    }
  }

  const mine = terms[me];
  const theirs = terms[them];

  let score =
    WEIGHTS.material * (mine.pieces - theirs.pieces) +
    WEIGHTS.permanent * (mine.permanent - theirs.permanent) +
    WEIGHTS.nearestDistance * (theirs.nearest - mine.nearest) +
    WEIGHTS.advancement * (mine.advancement - theirs.advancement);

  if (keepTerms) {
    // A corner can only be sealed by a permanent piece, and the counts above
    // already say whether one exists — so most nodes skip the search entirely.
    if (mine.permanent > 0 && isSealed(state, me)) score += WEIGHTS.sealed;
    if (theirs.permanent > 0 && isSealed(state, them)) score -= WEIGHTS.sealed;
    score += WEIGHTS.permanentHome * (mine.permanentHome - theirs.permanentHome);
  }

  return score;
}
