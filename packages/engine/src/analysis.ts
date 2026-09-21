// Derived facts the interface and the AI both need — spec 2.10 and 7.6.

import { NEIGHBOURS, SQUARE_COUNT, distance } from './board.js';
import { tallySides } from './fen.js';
import { goalSquares, homeSquares } from './goals.js';
import { EMPTY, decodePiece, other, predatorOf } from './pieces.js';
import type { GameState, Owner, PieceType, Side, Square } from './types.js';

/**
 * Which owner holds which types, as a 3x3 lookup. Built once per query so that
 * permanence is O(1) per piece rather than a board scan — `isSealed` asks for
 * every square, and the AI asks for every node.
 */
type Presence = Record<Owner, Record<PieceType, boolean>>;

function presenceOf(board: Int8Array): Presence {
  const presence: Presence = {
    blue: { rock: false, paper: false, scissors: false },
    red: { rock: false, paper: false, scissors: false },
    neutral: { rock: false, paper: false, scissors: false },
  };
  for (let square = 0; square < SQUARE_COUNT; square++) {
    const code = board[square]!;
    if (code === EMPTY) continue;
    const piece = decodePiece(code)!;
    presence[piece.owner][piece.type] = true;
  }
  return presence;
}

function permanentGiven(presence: Presence, owner: Owner, type: PieceType): boolean {
  const predator = predatorOf(type);
  if (owner === 'neutral') {
    // Either side may capture a neutral their type beats (4.2.4).
    return !presence.blue[predator] && !presence.red[predator];
  }
  // The opponent's own pieces, or a neutral they fire at you — a neutral you
  // use can't take your own pieces, so your own neutrals are no threat (4.2.3).
  return !presence[other(owner)][predator] && !presence.neutral[predator];
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
export function isPermanent(state: GameState, square: Square): boolean {
  assertSquare(square);
  const code = state.board[square]!;
  if (code === EMPTY) return false;
  const piece = decodePiece(code)!;
  return permanentGiven(presenceOf(state.board), piece.owner, piece.type);
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
export function isSealed(state: GameState, side: Side): boolean {
  const { board, variant } = state;
  const attacker = other(side);
  const presence = presenceOf(board);

  const wall = new Uint8Array(SQUARE_COUNT);
  const seen = new Uint8Array(SQUARE_COUNT);
  const queue: Square[] = [];

  for (let square = 0; square < SQUARE_COUNT; square++) {
    const code = board[square]!;
    if (code === EMPTY) continue;
    const piece = decodePiece(code)!;
    if (piece.owner === side) {
      if (permanentGiven(presence, side, piece.type)) wall[square] = 1;
    } else if (piece.owner === attacker) {
      seen[square] = 1;
      queue.push(square);
    }
  }

  // Nothing to seal against.
  if (queue.length === 0) return false;

  const goals = homeSquares(variant, side);

  for (let head = 0; head < queue.length; head++) {
    const square = queue[head]!;
    if (goals.includes(square)) return false;

    for (const next of NEIGHBOURS[square]!) {
      if (seen[next] || wall[next]) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }

  return true;
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
