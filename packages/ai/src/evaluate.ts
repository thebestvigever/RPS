// Evaluation — spec 9.2, extended by docs/engine/02-EVALUATION.md Term 1.
//
// score  = 100  * (my pieces - their pieces)
//        +  70  * (my permanent pieces - their permanent pieces)
//        +  28  * (their nearest distance to goal - my nearest distance to goal)
//        + 0.35 * ( sum over my pieces (9 - d)^2 - sum over theirs (9 - d)^2 )
//        + threat term, always on — see below
//
// Keep terms (on at Medium and Hard):
//        + 3000 if my corner is sealed, - 3000 if theirs is
//        +  6   * (8 - d) for each of my permanent pieces, d = distance to my own corner
//        -  6   * (8 - d) for each of their permanent pieces
//
// Distance is king distance to the NEAREST square of the relevant goal or
// corner, which is what makes the 2x2 Corner variant work. Neutral pieces are
// still ignored as PIECES (they own nothing to protect), but they count as
// attackers and defenders below, same as spec 4.2 lets them capture either side.
//
// §9 is not normative (only §2-5 are — CLAUDE.md), so these weights are free to
// change, but they produced every result in §6: run `pnpm sim` before and after
// changing one, and say what moved.
//
// --- The threat term (docs/engine/02-EVALUATION.md Term 1) ---
//
// None of the terms above ever look at an adjacent square, so a piece one move
// from being captured for free scored exactly the same as a safe one — the
// engine had `threatenedBy`/`defendersOf` since the interface's threat-lines
// aid (spec 10.5, M6) and the AI never called either. docs/engine/01-DIAGNOSIS.md
// measured the cost: Hard left a piece hanging for free on 32.7% of its moves,
// and ignored an existing free threat 74% of the time it already had one.
//
// For each of a side's own (non-neutral) pieces that is attacked
// (`threatenedBy` non-empty) and has no guard (`defendersOf` empty), that is a
// "hanging" piece — worth close to a full piece, since the opponent has first
// claim on it once it's their move. An attacked piece that IS guarded is
// "contested" — an exchange is available, roughly even, worth much less. Only
// one piece can be lost or exchanged per turn, so a second simultaneous
// instance is discounted rather than added again in full — see `riskOf`.
//
// The result is symmetric ("mine minus theirs", like every other term here),
// which is what keeps the antisymmetry test in evaluate.test.ts holding for it
// exactly as it does for material or distance. It does NOT try to price who
// gets to act first — that is what letting quiescence search evasions (spec
// 9.1, docs/engine/03-SEARCH.md §5) is for; this term only prices the raw fact
// that a piece is undefended, so the search has a reason to look for the move
// that fixes it.

import {
  EMPTY,
  SQUARE_COUNT,
  countsOf,
  decodePiece,
  defendersOf,
  isPermanentType,
  isSealed,
  other,
  threatenedBy,
} from '@sps/engine';
import type { Counts, GameState, Side } from '@sps/engine';
import { distanceTables } from './tables.js';

export const WEIGHTS = {
  material: 100,
  permanent: 70,
  nearestDistance: 28,
  advancement: 0.35,
  sealed: 3000,
  permanentHome: 6,
  // A hanging piece is worth almost a full piece: the opponent has first
  // claim on it, and the search corrects this once it finds the rescue.
  hanging: 85,
  hangingExtra: 20,
  // An attacked-but-guarded piece is a live, roughly-even exchange — real, but
  // nowhere near a hanging piece.
  contested: 15,
  contestedExtra: 4,
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
  hanging: number;
  contested: number;
}

/**
 * `first` for one instance, `+ extra` for each additional one — you can only
 * save or trade one piece per turn, so a second simultaneous threat is real
 * but heavily discounted rather than counted again in full.
 */
function riskOf(count: number, first: number, extra: number): number {
  return count === 0 ? 0 : first + (count - 1) * extra;
}

/**
 * From the point of view of the side to move.
 *
 * `counts` defaults to a fresh scan for callers with nothing better; the
 * search maintains it incrementally in `make`/`unmake` and passes it in, so
 * that permanence — nine integers, either zero or not — never costs a board
 * scan or a `Uint8Array(81)` allocation here (docs/engine/04-SPEED.md §1).
 */
export function evaluate(
  state: GameState,
  keepTerms: boolean,
  counts: Counts = countsOf(state.board),
): number {
  const me = state.turn;
  const them = other(me);
  const { board, variant } = state;
  const tables = distanceTables(variant);

  const terms: Record<Side, SideTerms> = {
    blue: { pieces: 0, permanent: 0, nearest: NO_RUNNER, advancement: 0, permanentHome: 0, hanging: 0, contested: 0 },
    red: { pieces: 0, permanent: 0, nearest: NO_RUNNER, advancement: 0, permanentHome: 0, hanging: 0, contested: 0 },
  };

  for (let square = 0; square < SQUARE_COUNT; square++) {
    const code = board[square]!;
    if (code === EMPTY) continue;

    const piece = decodePiece(code)!;
    const owner = piece.owner;
    if (owner === 'neutral') continue;

    const side = terms[owner];
    side.pieces++;

    const toGoal = tables.toGoal[owner][square]!;
    if (toGoal < side.nearest) side.nearest = toGoal;
    side.advancement += (9 - toGoal) ** 2;

    if (isPermanentType(counts, owner, piece.type)) {
      side.permanent++;
      side.permanentHome += 8 - tables.toHome[owner][square]!;
    }

    // A permanent piece has no predator anywhere on the board, so
    // `threatenedBy` is already guaranteed empty for it — nothing extra to
    // check here for that case.
    if (threatenedBy(state, square).length > 0) {
      if (defendersOf(state, square).length > 0) side.contested++;
      else side.hanging++;
    }
  }

  const mine = terms[me];
  const theirs = terms[them];

  const mineRisk =
    riskOf(mine.hanging, WEIGHTS.hanging, WEIGHTS.hangingExtra) +
    riskOf(mine.contested, WEIGHTS.contested, WEIGHTS.contestedExtra);
  const theirsRisk =
    riskOf(theirs.hanging, WEIGHTS.hanging, WEIGHTS.hangingExtra) +
    riskOf(theirs.contested, WEIGHTS.contested, WEIGHTS.contestedExtra);

  let score =
    WEIGHTS.material * (mine.pieces - theirs.pieces) +
    WEIGHTS.permanent * (mine.permanent - theirs.permanent) +
    WEIGHTS.nearestDistance * (theirs.nearest - mine.nearest) +
    WEIGHTS.advancement * (mine.advancement - theirs.advancement) +
    (theirsRisk - mineRisk);

  if (keepTerms) {
    // A corner can only be sealed by a permanent piece, and the counts above
    // already say whether one exists — so most nodes skip the search entirely.
    if (mine.permanent > 0 && isSealed(state, me, counts)) score += WEIGHTS.sealed;
    if (theirs.permanent > 0 && isSealed(state, them, counts)) score -= WEIGHTS.sealed;
    score += WEIGHTS.permanentHome * (mine.permanentHome - theirs.permanentHome);
  }

  return score;
}
