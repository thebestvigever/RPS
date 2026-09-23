// Move generation — spec 7.4.
//
// Moves are emitted in origin-square order, then destination-square order, which
// the fixtures and replays rely on. NEIGHBOURS is already ascending, and squares
// are walked 0..80, so the order falls out of the loops.

import { NEIGHBOUR_FLAT, NEIGHBOUR_OFFSETS, SQUARE_COUNT } from './board.js';
import { EMPTY, beats, decodePiece } from './pieces.js';
import type { PieceLists } from './pieceList.js';
import type { GameState, Move, Side, Square } from './types.js';
import type { MoveInput } from './types.js';

/**
 * Every move a single piece on `from` can make, appended to `moves` — the one
 * place the rules of §2.6/4.2.2-4.2.3 are written down. Both `legalMoves`
 * (walks every square) and `movesFromPieceLists` (walks only the mover's own
 * squares, docs/engine/04-SPEED.md §2) call this, so there is exactly one
 * implementation to keep in sync with the spec.
 */
function pushMovesFrom(
  moves: Move[],
  board: Int8Array,
  from: Square,
  me: Side,
  usableNeutral: boolean,
): void {
  const code = board[from]!;
  const piece = decodePiece(code)!;
  const beaten = beats(piece.type);

  const end = NEIGHBOUR_OFFSETS[from + 1]!;
  for (let i = NEIGHBOUR_OFFSETS[from]!; i < end; i++) {
    const to = NEIGHBOUR_FLAT[i]!;
    const targetCode = board[to]!;

    if (targetCode === EMPTY) {
      // A neutral never walks (4.2.2).
      if (usableNeutral) continue;
      moves.push({ from, to, piece, captured: null });
      continue;
    }

    const target = decodePiece(targetCode)!;

    // Your own piece; or, for a neutral, another neutral (4.2.3).
    if (target.owner === piece.owner) continue;

    // A neutral you use can't capture your own pieces (4.2.3).
    if (usableNeutral && target.owner === me) continue;

    // Anything else is legal only if this type beats it. Same type, or a
    // target that beats the mover, is illegal (2.6).
    if (target.type === beaten) {
      moves.push({ from, to, piece, captured: target });
    }
  }
}

export function legalMoves(state: GameState): Move[] {
  if (state.result) return [];

  const { board, turn: me, variant } = state;
  const neutralsPlay = variant.neutrals !== false;
  const moves: Move[] = [];

  for (let from = 0; from < SQUARE_COUNT; from++) {
    const code = board[from]!;
    if (code === EMPTY) continue;

    const piece = decodePiece(code)!;
    const mine = piece.owner === me;
    const usableNeutral = piece.owner === 'neutral' && neutralsPlay;
    if (!mine && !usableNeutral) continue;

    pushMovesFrom(moves, board, from, me, usableNeutral);
  }

  return moves;
}

/**
 * Same legal moves as `legalMoves`, as a set, but found by walking a piece
 * list instead of all 81 squares (docs/engine/04-SPEED.md §2) — for a caller
 * that already maintains one incrementally, such as the AI search's hot path.
 * `packages/engine/test/pieceList.test.ts` asserts this agrees with
 * `legalMoves` on every fixture and perft position, so there is still only
 * one set of rules, just two ways to walk up to them.
 *
 * The move order is not the same as `legalMoves` (square-ascending) — it
 * follows the piece list's own order, which changes under swap-removal. No
 * caller may rely on `legalMoves`'s order from this function; use
 * `legalMoves` itself when that matters (fixtures, replays, notation).
 */
export function movesFromPieceLists(state: GameState, lists: PieceLists): Move[] {
  if (state.result) return [];

  const { board, turn: me, variant } = state;
  const neutralsPlay = variant.neutrals !== false;
  const moves: Move[] = [];

  const mine = lists.squares[me];
  const mineCount = lists.count[me];
  for (let i = 0; i < mineCount; i++) {
    pushMovesFrom(moves, board, mine[i]!, me, false);
  }

  if (neutralsPlay) {
    const neutrals = lists.squares.neutral;
    const neutralCount = lists.count.neutral;
    for (let i = 0; i < neutralCount; i++) {
      pushMovesFrom(moves, board, neutrals[i]!, me, true);
    }
  }

  return moves;
}

export function isLegal(state: GameState, move: MoveInput): boolean {
  return findLegalMove(state, move) !== null;
}

/** The full Move for a from/to pair, or null when it isn't legal here. */
export function findLegalMove(state: GameState, move: MoveInput): Move | null {
  for (const candidate of legalMoves(state)) {
    if (candidate.from === move.from && candidate.to === move.to) return candidate;
  }
  return null;
}

