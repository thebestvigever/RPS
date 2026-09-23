// Evaluation — spec 9.2, extended by docs/engine/02-EVALUATION.md Terms 1-6.
//
// score  = 100  * (my pieces - their pieces)
//        +  70  * (my permanent pieces - their permanent pieces)
//        + raceMargin(mine, theirs)                     — Term 2(b), see below
//        + 0.35 * ( sum over my pieces (9 - d)^2 - sum over theirs (9 - d)^2 )
//        + threat term, always on                       — Term 1
//        + extinctionPressure(mine, theirs)              — Term 3
//        + mobility term, always on                      — Term 4
//        + cover term, always on                          — Term 5
//        ± unstoppable-runner bonus, always on            — Term 2(a)
//
// Keep terms (on at Medium and Hard):
//        + 3000 if my corner is sealed, - 3000 if theirs is
//        +  6   * (8 - d) for each of my permanent pieces, d = distance to my own corner
//        -  6   * (8 - d) for each of their permanent pieces
//        + cornerOccupancy(mine, theirs)                  — Term 6(b)
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
// `threatenedBy` already treats an adjacent neutral predator as a threat, so a
// neutral Paper sitting next to a Rock is priced as a real threat here without
// any extra code (Term 6's "let it see neutrals," nearly free exactly as
// predicted — `defendersOf` never counts a neutral as a defender, since a
// neutral takes no side, which is also already correct as written).
//
// The result is symmetric ("mine minus theirs", like every other term here),
// which is what keeps the antisymmetry test in evaluate.test.ts holding for it
// exactly as it does for material or distance. It does NOT try to price who
// gets to act first — that is what letting quiescence search evasions (spec
// 9.1, docs/engine/03-SEARCH.md §5) is for; this term only prices the raw fact
// that a piece is undefended, so the search has a reason to look for the move
// that fixes it.
//
// --- Why nothing here ever prices "since it's my move" (Terms 2 and 6) ---
//
// `evaluate()` is called with `me = state.turn`, so within any ONE call there
// is no way to tell "opponent to move" from "my move" for a fixed side — that
// distinction only exists by comparing two calls a ply apart, which is exactly
// what negamax's own sign-flip already does. Term 1's original design tried to
// bake a "they get to act first" discount into the hanging-piece weights and it
// broke evaluate.test.ts's antisymmetry check (`evaluate(pos) ===
// -evaluate(flip(pos))`, flipping only `turn`): a flat adjustment added
// identically inside both calls does not flip sign the way a `mine - theirs`
// quantity does, only cancels out if it's zero. The same trap catches two
// things the doc asks for that are NOT already board-relative differences:
//
//   - Term 2(b)'s literal `margin × (9 − myDistance)` — `myDistance` alone is
//     not a "mine minus theirs" quantity, so a term shaped around it doesn't
//     flip sign correctly (verified algebraically, not just by the test).
//     `Math.min(mine, theirs)` in its place IS symmetric under the swap — the
//     leading runner's own distance is what makes a race urgent, whichever
//     side leads it — and produces the same "worth more when the race is
//     short" shape the doc wants.
//   - Term 6's flat tempo bonus ("~10 for the side to move") — added
//     identically in both calls, it is not a function of the board at all, so
//     no `mine - theirs` framing can carry it. Left out entirely; a genuine
//     tempo edge already shows up as "my move options get evaluated one ply
//     deeper," which is what the search itself is for.
//
// Term 2(a)'s unstoppable-runner detector avoids this by being a pure function
// of the board and `side` alone — no notion of whose actual turn it is, so it
// stays conservative (per the doc's own instruction) rather than trying to
// thread a tempo adjustment through it too.

import {
  beats,
  countsOf,
  decodePiece,
  defendersOf,
  distance,
  EMPTY,
  goalSquares,
  isPermanentType,
  isSealed,
  NEIGHBOURS,
  other,
  PIECE_TYPES,
  pieceListsOf,
  threatenedBy,
} from '@sps/engine';
import type { Counts, GameState, PieceLists, Side } from '@sps/engine';
import { distanceTables } from './tables.js';
import type { DistanceTables } from './tables.js';

export const WEIGHTS = {
  material: 100,
  permanent: 70,
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
  // Term 2(b): the race margin, non-linear — see `raceMargin` below.
  raceMargin: 5,
  // Term 2(a): a conservatively-detected unstoppable runner. Large enough to
  // dominate every other term (a real, close-to-certain win is worth far more
  // than any positional consideration) but well under both WIN_SCORE and
  // search.ts's mate-score threshold (WIN_SCORE - 10_000), so it can never be
  // mistaken for an actual terminal score by the transposition table.
  unstoppable: 50_000,
  // Term 3: extinguishing a scarce enemy type is worth what its death frees —
  // see `extinctionPressure`. `scarcityOne`/`scarcityTwo` are the curve
  // (doc: "scarcity(1) large, scarcity(2) modest, scarcity(3+) ≈ 0"), not
  // themselves point values, so they are unitless multipliers on `permanent`.
  scarcityOne: 1,
  scarcityTwo: 0.3,
  // Term 4: a steep penalty as a side's rough mobility proxy (empty squares
  // next to its own pieces, summed — the cheap stand-in the doc allows for a
  // real move count) drops toward smothered. Squared, so it bites hard only
  // once it's close (§2.8: no legal move is a loss, not a draw, here).
  smotherThreshold: 4,
  smother: 40,
  // Term 5: a piece with a friendly defender is worth a little more, and more
  // still if that defender sits between it and home — a defender in front is
  // real but doesn't protect the retreat the way a rearward one does.
  coverForward: 4,
  coverRearward: 10,
  // Term 6(b): an ordinary (non-permanent) piece parked on the home corner
  // still has to be captured before anyone can enter it (spec 2.7) — real,
  // just nowhere near what a permanent seal is worth.
  cornerOccupancy: 100,
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
  /** Term 4's rough mobility proxy: empty squares next to this side's pieces. */
  mobility: number;
  /** Term 5: this side's own cover value, already weighted forward/rearward. */
  cover: number;
  /** Term 6(b): non-permanent pieces of this side sitting on its own corner. */
  cornerOccupants: number;
}

function freshTerms(): SideTerms {
  return {
    pieces: 0,
    permanent: 0,
    nearest: NO_RUNNER,
    advancement: 0,
    permanentHome: 0,
    hanging: 0,
    contested: 0,
    mobility: 0,
    cover: 0,
    cornerOccupants: 0,
  };
}

function resetTerms(terms: SideTerms): void {
  terms.pieces = 0;
  terms.permanent = 0;
  terms.nearest = NO_RUNNER;
  terms.advancement = 0;
  terms.permanentHome = 0;
  terms.hanging = 0;
  terms.contested = 0;
  terms.mobility = 0;
  terms.cover = 0;
  terms.cornerOccupants = 0;
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
 * Term 5 — cover (docs/engine/02-EVALUATION.md): what one defended piece is
 * worth, weighted by direction. `pieceToHome` and `defenderToHomes` are king
 * distances to the piece's own side's corner (`tables.toHome`); a defender
 * closer to home than the piece it's guarding sits between the piece and the
 * corner — the "respect the layers" case the doc names, worth more than a
 * defender out in front, which is real cover but doesn't protect the retreat.
 * A pure function of distances (not squares) so it can be unit tested without
 * a board: a FEN that moves the defender to compare forward against rearward
 * also moves its own advancement and race contribution, which swamps the
 * much smaller cover difference being tested.
 */
export function coverBonus(pieceToHome: number, defenderToHomes: readonly number[]): number {
  if (defenderToHomes.length === 0) return 0;
  const rearward = defenderToHomes.some((d) => d < pieceToHome);
  return rearward ? WEIGHTS.coverRearward : WEIGHTS.coverForward;
}

/**
 * Term 2(b) — a non-linear race margin (docs/engine/02-EVALUATION.md): worth
 * far more when the leading runner is close to home than when it's far out,
 * because a long race has time to go wrong.
 *
 * `Math.min(mine, theirs)` — the LEADING runner's distance, whichever side is
 * ahead — rather than the doc's literal `myDistance`, which is not a
 * `mine - theirs` quantity and breaks antisymmetry (see the file header). If
 * I'm ahead, the leader is mine and this correctly amplifies my lead as it
 * gets close; if they're ahead, the leader is theirs and it amplifies the
 * (already negative) danger the same way.
 */
// Exported alongside the pure derivations below (not just used internally):
// they are formulas the doc calls "derivable, not a guess," and a direct unit
// test of the formula is more robust than reverse-engineering a FEN that
// isolates one term from everything else `evaluate()` also computes.
export function raceMargin(mine: number, theirs: number): number {
  return WEIGHTS.raceMargin * (theirs - mine) * (9 - Math.min(mine, theirs));
}

/**
 * `scarcity(1)` large, `scarcity(2)` modest, `scarcity(3+)` ≈ 0 — an already
 * extinct type (`count === 0`) has no *pressure* left to price: that piece's
 * permanence already shows up in the ordinary `permanent` term.
 */
export function scarcity(count: number): number {
  if (count === 1) return WEIGHTS.scarcityOne;
  if (count === 2) return WEIGHTS.scarcityTwo;
  return 0;
}

/**
 * Term 3 — extinction economics (docs/engine/02-EVALUATION.md): the pressure
 * `attacker` is putting on `defender`'s scarce types, derived rather than
 * guessed — killing `defender`'s last piece of type `t` frees every
 * `attacker` piece of type `beats(t)` to become permanent (§2.10), and that is
 * exactly what the ordinary `permanent` bonus already prices, so this is
 * `permanent` again, scaled by how close each type already is to extinct.
 * Mirrored the same way at the call site: the pressure I put on their scarce
 * types, minus the pressure they put on mine.
 */
export function extinctionPressure(attacker: Counts[Side], defender: Counts[Side]): number {
  let pressure = 0;
  for (const type of PIECE_TYPES) {
    pressure += scarcity(defender[type]) * WEIGHTS.permanent * attacker[beats(type)];
  }
  return pressure;
}

/**
 * Term 2(a) — a hard, conservative "unstoppable runner" detector
 * (docs/engine/02-EVALUATION.md): returns a win-sized score, not a bonus, when
 * one of `side`'s permanent pieces cannot be stopped from reaching an
 * assailable goal square before any enemy piece can reach the goal region at
 * all. Deliberately blind to whose turn it actually is (see the file header) —
 * conservative in the doc's sense too, since that only ever makes MORE enemy
 * pieces count as able to interfere, never fewer.
 *
 * "Permanent" already rules out condition 1 (cannot be captured at all) more
 * strongly than the doc's alternative half of it ("no enemy piece of its
 * predator type can reach a square adjacent to its remaining path"), which
 * this does not attempt — path-blocking is a search question, and a false
 * "unstoppable" here is a thrown game (the doc's own warning), so it is
 * simpler and safer to require the strong condition outright.
 */
function hasUnstoppableRunner(state: GameState, side: Side, counts: Counts, lists: PieceLists): boolean {
  const { board, variant } = state;
  const goals = goalSquares(variant, side);
  const squares = lists.squares[side];
  const count = lists.count[side];

  let myDistance = Infinity;
  for (let i = 0; i < count; i++) {
    const square = squares[i]!;
    const type = decodePiece(board[square]!)!.type;
    if (!isPermanentType(counts, side, type)) continue;

    for (const goal of goals) {
      const occupantCode = board[goal]!;
      if (occupantCode !== EMPTY) {
        const occupant = decodePiece(occupantCode)!;
        if (occupant.owner === side) continue; // blocked by our own piece
        if (occupant.type !== beats(type)) continue; // can't capture onto it
      }
      const d = distance(square, goal);
      if (d < myDistance) myDistance = d;
    }
  }
  if (myDistance === Infinity) return false;

  const enemy = other(side);
  const enemySquares = lists.squares[enemy];
  const enemyCount = lists.count[enemy];
  for (let i = 0; i < enemyCount; i++) {
    const enemySquare = enemySquares[i]!;
    for (const goal of goals) {
      if (distance(enemySquare, goal) <= myDistance) return false;
    }
  }

  return true;
}

/**
 * From the point of view of the side to move.
 *
 * `counts`, `lists`, `tables` and `scratch` all default to something built
 * fresh for a caller with nothing better; the search maintains the first two
 * incrementally in `make`/`unmake`, computes `tables` once per `chooseMove`
 * call rather than on a `WeakMap` per node, and reuses one `scratch` pair of
 * side terms across the whole search instead of two object literals per node
 * (docs/engine/04-SPEED.md §1, §2, §5). Walking `lists` instead of all 81
 * squares also means an empty square is never visited, so there is no longer
 * a neutral-piece check in the loop below — a piece list only ever holds
 * `blue` and `red` squares here.
 */
export function evaluate(
  state: GameState,
  keepTerms: boolean,
  counts: Counts = countsOf(state.board),
  lists: PieceLists = pieceListsOf(state.board),
  tables: DistanceTables = distanceTables(state.variant),
  scratch: Record<Side, SideTerms> = { blue: freshTerms(), red: freshTerms() },
): number {
  const me = state.turn;
  const them = other(me);
  const { board } = state;

  resetTerms(scratch.blue);
  resetTerms(scratch.red);
  const terms = scratch;

  for (const owner of ['blue', 'red'] as const) {
    const squares = lists.squares[owner];
    const count = lists.count[owner];
    const side = terms[owner];

    for (let i = 0; i < count; i++) {
      const square = squares[i]!;
      const type = decodePiece(board[square]!)!.type;
      side.pieces++;

      const toGoal = tables.toGoal[owner][square]!;
      if (toGoal < side.nearest) side.nearest = toGoal;
      side.advancement += (9 - toGoal) ** 2;

      const toHome = tables.toHome[owner][square]!;
      if (isPermanentType(counts, owner, type)) {
        side.permanent++;
        side.permanentHome += 8 - toHome;
      } else if (toHome === 0) {
        // Term 6(b): parked on the home corner itself, but not permanent —
        // still has to be captured before anyone can enter (spec 2.7).
        side.cornerOccupants++;
      }

      // Term 4: how many of this piece's neighbours are empty, summed over
      // the side — the cheap proxy the doc allows in place of a real move
      // count, which would mean generating moves a second time.
      const neighbours = NEIGHBOURS[square]!;
      for (const neighbour of neighbours) {
        if (board[neighbour] === EMPTY) side.mobility++;
      }

      // A permanent piece has no predator anywhere on the board, so
      // `threatenedBy` is already guaranteed empty for it — nothing extra to
      // check here for that case.
      const defenders = defendersOf(state, square);
      if (threatenedBy(state, square).length > 0) {
        if (defenders.length > 0) side.contested++;
        else side.hanging++;
      }

      // Term 5: cover — see `coverBonus`.
      if (defenders.length > 0) {
        side.cover += coverBonus(
          toHome,
          defenders.map((d) => tables.toHome[owner][d]!),
        );
      }
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

  const mineSmother =
    mine.mobility < WEIGHTS.smotherThreshold
      ? WEIGHTS.smother * (WEIGHTS.smotherThreshold - mine.mobility) ** 2
      : 0;
  const theirsSmother =
    theirs.mobility < WEIGHTS.smotherThreshold
      ? WEIGHTS.smother * (WEIGHTS.smotherThreshold - theirs.mobility) ** 2
      : 0;

  let score =
    WEIGHTS.material * (mine.pieces - theirs.pieces) +
    WEIGHTS.permanent * (mine.permanent - theirs.permanent) +
    raceMargin(mine.nearest, theirs.nearest) +
    WEIGHTS.advancement * (mine.advancement - theirs.advancement) +
    (theirsRisk - mineRisk) +
    (extinctionPressure(counts[me], counts[them]) - extinctionPressure(counts[them], counts[me])) +
    (theirsSmother - mineSmother) +
    (mine.cover - theirs.cover);

  if (hasUnstoppableRunner(state, me, counts, lists)) score += WEIGHTS.unstoppable;
  if (hasUnstoppableRunner(state, them, counts, lists)) score -= WEIGHTS.unstoppable;

  if (keepTerms) {
    // A corner can only be sealed by a permanent piece, and the counts above
    // already say whether one exists — so most nodes skip the search entirely.
    if (mine.permanent > 0 && isSealed(state, me, counts)) score += WEIGHTS.sealed;
    if (theirs.permanent > 0 && isSealed(state, them, counts)) score -= WEIGHTS.sealed;
    score += WEIGHTS.permanentHome * (mine.permanentHome - theirs.permanentHome);
    score += WEIGHTS.cornerOccupancy * (mine.cornerOccupants - theirs.cornerOccupants);
  }

  return score;
}
