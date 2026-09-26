// Derived facts the interface and the AI both need — spec 2.10 and 7.6.

import { NEIGHBOUR_FLAT, NEIGHBOUR_OFFSETS, SQUARE_COUNT, distance } from './board.js';
import { tallySides } from './fen.js';
import { goalSquares, homeSquares } from './goals.js';
import { legalMoves } from './moves.js';
import { EMPTY, beats, decodePiece, other, predatorOf } from './pieces.js';
import type { GameState, Move, Owner, PieceType, Side, Square } from './types.js';

/**
 * How many of each type each owner holds, as a 3x3 table. Permanence is a
 * question about whether a count is zero, not about where any piece sits, so
 * this is the whole input `permanentGiven` needs — nine integers instead of an
 * 81-square scan. `countsOf` builds the table by scanning the board once;
 * callers that already track it incrementally (the AI search, `make`/`unmake`
 * one line each) skip that scan entirely and pass their own.
 */
export type Counts = Record<Owner, Record<PieceType, number>>;

export function countsOf(board: Int8Array): Counts {
  const counts: Counts = {
    blue: { rock: 0, paper: 0, scissors: 0 },
    red: { rock: 0, paper: 0, scissors: 0 },
    neutral: { rock: 0, paper: 0, scissors: 0 },
  };
  for (let square = 0; square < SQUARE_COUNT; square++) {
    const code = board[square]!;
    if (code === EMPTY) continue;
    const piece = decodePiece(code)!;
    counts[piece.owner][piece.type]++;
  }
  return counts;
}

/**
 * Is a piece of this owner and type permanent, given a type census? The
 * per-piece form of `permanentMask`, for a caller walking its own pieces (the
 * AI's evaluation, per docs/engine/04-SPEED.md §1) that would rather ask this
 * directly than have a whole-board mask built and allocated for it.
 */
export function isPermanentType(counts: Counts, owner: Owner, type: PieceType): boolean {
  return permanentGiven(counts, owner, type);
}

function permanentGiven(counts: Counts, owner: Owner, type: PieceType): boolean {
  const predator = predatorOf(type);
  if (owner === 'neutral') {
    // Either side may capture a neutral their type beats (4.2.4).
    return counts.blue[predator] === 0 && counts.red[predator] === 0;
  }
  // The opponent's own pieces, or a neutral they fire at you — a neutral you
  // use can't take your own pieces, so your own neutrals are no threat (4.2.3).
  return counts[other(owner)][predator] === 0 && counts.neutral[predator] === 0;
}

/**
 * Permanence for every square in one pass: 1 where a piece can no longer be
 * captured, 0 elsewhere. The bulk form of `isPermanent`, for callers that need
 * the whole board — the AI's evaluation asks on every node (9.2).
 *
 * `counts` defaults to a fresh scan for callers with nothing better; a caller
 * that already maintains counts incrementally should pass them and skip that
 * scan (docs/engine/04-SPEED.md §1).
 */
export function permanentMask(state: GameState, counts: Counts = countsOf(state.board)): Uint8Array {
  const { board } = state;
  const mask = new Uint8Array(SQUARE_COUNT);

  for (let square = 0; square < SQUARE_COUNT; square++) {
    const code = board[square]!;
    if (code === EMPTY) continue;
    const piece = decodePiece(code)!;
    if (permanentGiven(counts, piece.owner, piece.type)) mask[square] = 1;
  }

  return mask;
}

export function typeCounts(state: GameState): Record<Side, Record<PieceType, number>> {
  return tallySides(state.board);
}

function assertSquare(square: Square): void {
  if (!Number.isInteger(square) || square < 0 || square >= SQUARE_COUNT) {
    throw new Error(`Not a square index: ${square}`);
  }
}

/**
 * A piece is permanent when nothing left on the board can capture it (2.10):
 * the opponent holds no piece of its predator type, and no neutral of that type
 * remains. An empty square is not permanent.
 */
export function isPermanent(
  state: GameState,
  square: Square,
  counts: Counts = countsOf(state.board),
): boolean {
  assertSquare(square);
  const code = state.board[square]!;
  if (code === EMPTY) return false;
  const piece = decodePiece(code)!;
  return permanentGiven(counts, piece.owner, piece.type);
}

/**
 * Is `side`'s corner unreachable by the opponent? — the Keep (7.6).
 *
 * Breadth-first from every attacker piece over king moves, never entering a
 * square held by a permanent defender piece. If the search reaches a goal square
 * that is not itself part of that wall, the corner is open.
 *
 * The attacker's own pieces and the defender's non-permanent pieces are treated
 * as passable, because they can move or be captured. A seal lasts only as long
 * as its pieces stay put, so this is re-checked after every move rather than
 * remembered.
 */
export function isSealed(
  state: GameState,
  side: Side,
  counts: Counts = countsOf(state.board),
): boolean {
  const { board, variant } = state;
  const attacker = other(side);

  const wall = new Uint8Array(SQUARE_COUNT);
  const seen = new Uint8Array(SQUARE_COUNT);
  const queue: Square[] = [];
  let wallSize = 0;

  for (let square = 0; square < SQUARE_COUNT; square++) {
    const code = board[square]!;
    if (code === EMPTY) continue;
    const piece = decodePiece(code)!;
    if (piece.owner === side) {
      if (permanentGiven(counts, side, piece.type)) {
        wall[square] = 1;
        wallSize++;
      }
    } else if (piece.owner === attacker) {
      seen[square] = 1;
      queue.push(square);
    }
  }

  // Nothing to seal against.
  if (queue.length === 0) return false;

  // With no permanent defender there is no wall, so the search would reach
  // every square including the goal. Skipping the walk here is what keeps this
  // cheap enough to call on every node of a search — most positions have no
  // permanent piece at all.
  if (wallSize === 0) return false;

  const goals = homeSquares(variant, side);

  for (let head = 0; head < queue.length; head++) {
    const square = queue[head]!;
    if (goals.includes(square)) return false;

    const end = NEIGHBOUR_OFFSETS[square + 1]!;
    for (let i = NEIGHBOUR_OFFSETS[square]!; i < end; i++) {
      const next = NEIGHBOUR_FLAT[i]!;
      if (seen[next] || wall[next]) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }

  return true;
}

/**
 * Can `side` still have a sealed corner once it has moved?
 *
 * `isSealed` is a snapshot, and there is no passing in this game (2.4). So a
 * Keep held by a single piece standing on the corner is not safe at all: if it
 * is that side's only piece, their turn forces them off it and the corner opens.
 * A seal can be broken by zugzwang, not merely abandoned.
 *
 * That is why a sealed corner never means "the opponent cannot win", and why
 * anything reasoning about a settled game — a draw offer, a result on time —
 * has to ask this rather than `isSealed`.
 *
 * Looks one ply ahead, for the side to move. A side being squeezed out of a
 * seal over several moves is a search question, not a static one.
 */
export function canHoldSeal(state: GameState, side: Side): boolean {
  if (!isSealed(state, side)) return false;
  // Not their turn: nothing is forcing them off it right now.
  if (state.turn !== side) return true;

  const moves = legalMoves(state);
  if (moves.length === 0) return false;

  const board = Int8Array.from(state.board);
  const probe: GameState = { ...state, board };

  for (const move of moves) {
    const captured = board[move.to]!;
    board[move.to] = board[move.from]!;
    board[move.from] = EMPTY;
    const held = isSealed(probe, side);
    board[move.from] = board[move.to]!;
    board[move.to] = captured;
    if (held) return true;
  }

  return false;
}

/**
 * King distance from `square` to the nearest square of its owner's goal — the
 * opponent's corner. Backs the race meter (10.5) and the evaluation (9.2).
 */
export function distanceToGoal(state: GameState, square: Square): number {
  assertSquare(square);
  const code = state.board[square]!;
  if (code === EMPTY) throw new Error(`No piece on square ${square}`);

  const piece = decodePiece(code)!;
  if (piece.owner === 'neutral') {
    throw new Error('A neutral piece has no goal — neutrals never win (4.2.5)');
  }

  let nearest = Infinity;
  for (const goal of goalSquares(state.variant, piece.owner)) {
    nearest = Math.min(nearest, distance(square, goal));
  }
  return nearest;
}

/** That side's smallest king distance to its goal, ignoring blockers ("at best"). */
export function nearestRunner(state: GameState, side: Side): number {
  let nearest = Infinity;
  for (let square = 0; square < SQUARE_COUNT; square++) {
    const code = state.board[square]!;
    if (code === EMPTY) continue;
    if (decodePiece(code)!.owner !== side) continue;
    nearest = Math.min(nearest, distanceToGoal(state, square));
  }
  return nearest;
}

/**
 * Which square holds that side's nearest runner — the race meter's "hovering
 * highlights the runner" (10.5). Ties break on the lower square index, which
 * is arbitrary but deterministic: two runners tied for nearest is a real
 * position (the starting one has all ten), and the meter can only highlight
 * one square at a time.
 */
export function nearestRunnerSquare(state: GameState, side: Side): Square | null {
  let nearest = Infinity;
  let runner: Square | null = null;
  for (let square = 0; square < SQUARE_COUNT; square++) {
    const code = state.board[square]!;
    if (code === EMPTY) continue;
    if (decodePiece(code)!.owner !== side) continue;
    const d = distanceToGoal(state, square);
    if (d < nearest) {
      nearest = d;
      runner = square;
    }
  }
  return runner;
}

/**
 * Adjacent squares holding a piece that beats the one on `square` — the
 * incoming half of the threat-lines aid (10.5): "from adjacent enemy pieces
 * that can capture it." Structural, not a function of whose turn it is: a
 * piece standing next to its predator is a genuine threat whether the
 * predator's side can act on it this instant or on its next turn, and both
 * matter to the player deciding whether to leave a piece where it is.
 *
 * Ownership is the only legality check that belongs here. `to`-side capture
 * rules (a neutral can't take the side using it, can't take another neutral)
 * all collapse to "different owner, and that owner's type beats this one" —
 * the same test `legalMoves` applies, just without needing whose move it is.
 */
export function threatenedBy(state: GameState, square: Square): Square[] {
  assertSquare(square);
  const code = state.board[square]!;
  if (code === EMPTY) return [];
  const piece = decodePiece(code)!;
  const predator = predatorOf(piece.type);

  const threats: Square[] = [];
  const end = NEIGHBOUR_OFFSETS[square + 1]!;
  for (let i = NEIGHBOUR_OFFSETS[square]!; i < end; i++) {
    const neighbour = NEIGHBOUR_FLAT[i]!;
    const neighbourCode = state.board[neighbour]!;
    if (neighbourCode === EMPTY) continue;
    const attacker = decodePiece(neighbourCode)!;
    if (attacker.owner === piece.owner) continue;
    if (attacker.type === predator) threats.push(neighbour);
  }
  return threats;
}

/**
 * Adjacent squares holding a FRIENDLY piece that would recapture on `square`
 * if its occupant were just captured — the defence half of the threat-lines
 * picture, and the fact `02-EVALUATION.md`'s threat term is built on.
 *
 * By the cycle identity `predator(predator(t)) === beats(t)`
 * (docs/engine/02-EVALUATION.md): a piece is guarded by a friendly piece of
 * the type it itself beats. Your Scissors are guarded by your Paper, your
 * Paper by your Rock, your Rock by your Scissors — because whatever attacks
 * your Rock must be Paper, and Scissors is exactly what beats Paper back.
 * Structural, like `threatenedBy`: not a function of whose turn it is.
 */
export function defendersOf(state: GameState, square: Square): Square[] {
  assertSquare(square);
  const code = state.board[square]!;
  if (code === EMPTY) return [];
  const piece = decodePiece(code)!;
  const guard = beats(piece.type);

  const defenders: Square[] = [];
  const end = NEIGHBOUR_OFFSETS[square + 1]!;
  for (let i = NEIGHBOUR_OFFSETS[square]!; i < end; i++) {
    const neighbour = NEIGHBOUR_FLAT[i]!;
    const neighbourCode = state.board[neighbour]!;
    if (neighbourCode === EMPTY) continue;
    const friend = decodePiece(neighbourCode)!;
    if (friend.owner !== piece.owner) continue;
    if (friend.type === guard) defenders.push(neighbour);
  }
  return defenders;
}

/**
 * Static exchange evaluation for `square`, from `perspective`'s side of it
 * (docs/engine/02-EVALUATION.md Term 1, "left on the table," and needed by
 * Term 3 and `03-SEARCH.md` §5-6 for capture ordering) — the net pieces
 * `perspective` ends up up (positive) or down (negative) if captures on
 * `square` keep happening for as long as one is available. A caller ordering
 * a candidate capture move passes the mover's own side.
 *
 * Chess SEE sorts attackers by value and recaptures with the cheapest; here
 * every piece is worth the same and only *type* decides who may capture, so
 * the walk is simpler: whoever sits on `square` can be taken only by the one
 * type that beats them (`predatorOf`), and by the cycle identity
 * `predator(predator(t)) === beats(t)`, the piece that just captured is in
 * turn exactly the type its OWN side defends with — so the sequence is a walk
 * around the three-way cycle, occupant-type in the same order every time,
 * alternating whichever side has a piece adjacent to capture next. It
 * terminates in at most a handful of steps: each step consumes one of
 * `square`'s (at most 8) neighbours, and none is reused.
 *
 * This always plays every available capture through to the end rather than
 * letting either side choose to stop partway — a real player might decline a
 * losing recapture, which a full minimax-over-the-sequence would model. The
 * doc asks for the simpler walk ("it terminates in at most a handful of
 * steps, and it is genuinely simpler than chess's version"), so this
 * overstates how bad a walk can get for whichever side would rationally have
 * stopped early — a caller that only needs the *sign* (good/bad capture, per
 * `03-SEARCH.md` §5-6) is unaffected by that in the common case, since a
 * side never walks into a chain that starts by losing material for free.
 *
 * A neutral piece is not material for either side (spec 4.2.5, and
 * `evaluate()` never counts one as a piece), so capturing or losing one
 * contributes nothing to the total — including the very first step, when
 * `square` itself holds a neutral, which is also the one case where the walk
 * cannot tell which side's piece struck first if both could have: that first
 * step is free for `perspective` either way, so it does not need to know.
 */
export function exchangeOn(state: GameState, square: Square, perspective: Side): number {
  assertSquare(square);
  const code = state.board[square]!;
  if (code === EMPTY) return 0;

  const used = new Uint8Array(SQUARE_COUNT);
  let occupant = decodePiece(code)!;
  let net = 0;

  for (;;) {
    const neededType = predatorOf(occupant.type);
    let attacker: Square = -1;

    const end = NEIGHBOUR_OFFSETS[square + 1]!;
    for (let i = NEIGHBOUR_OFFSETS[square]!; i < end; i++) {
      const neighbour = NEIGHBOUR_FLAT[i]!;
      if (used[neighbour]) continue;
      const neighbourCode = state.board[neighbour]!;
      if (neighbourCode === EMPTY) continue;
      const piece = decodePiece(neighbourCode)!;
      if (piece.owner === occupant.owner) continue;
      if (piece.type !== neededType) continue;
      attacker = neighbour;
      break;
    }

    if (attacker < 0) break;
    used[attacker] = 1;

    if (occupant.owner === perspective) net -= 1;
    else if (occupant.owner !== 'neutral') net += 1;

    occupant = decodePiece(state.board[attacker]!)!;
  }

  return net;
}

/**
 * Adjacent squares this piece could capture — the outgoing half of the
 * threat-lines aid (10.5): "arrows to adjacent enemy pieces it can capture
 * now." A normal piece's own captures don't depend on whose turn it is —
 * ownership and type are the only tests `legalMoves` itself applies to them.
 * A neutral is the one case that does: 4.2.3 says it can't take the side
 * using it, and "using it" only means something for the side to move, so a
 * hovered or selected neutral is read as though `state.turn` were the one
 * using it — the only side that actually could, right now. The probe swap
 * below only ever fires for that case, or for looking at the OPPONENT's own
 * piece (hovering it asks "what would this capture on its turn").
 */
export function capturesFrom(state: GameState, square: Square): Square[] {
  assertSquare(square);
  const code = state.board[square]!;
  if (code === EMPTY) return [];
  const piece = decodePiece(code)!;
  const mover = piece.owner === 'neutral' ? state.turn : piece.owner;
  const probe = mover === state.turn ? state : { ...state, turn: mover };
  return legalMoves(probe)
    .filter((move) => move.from === square && move.captured != null)
    .map((move) => move.to);
}

/**
 * Would `square` be threatened after `move` is played — the danger-marks aid
 * (10.5): a warning on a destination where the moving piece could be taken
 * right back. Plays the move on a scratch board (never touching `state`) and
 * asks `threatenedBy` of the piece's new square; a move that wins the game
 * outright has nothing left to threaten it.
 */
export function dangerAfter(state: GameState, move: Move): boolean {
  const board = Int8Array.from(state.board);
  board[move.to] = board[move.from]!;
  board[move.from] = EMPTY;
  return threatenedBy({ ...state, board }, move.to).length > 0;
}
