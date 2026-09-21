// Perft — spec 11.3. The number of distinct move sequences of length n from a
// position. A move that ends the game counts at its own depth and isn't
// expanded; repetition and the move limit are ignored.
//
// This walks the board with make/unmake rather than `applyMove`, which the spec
// sanctions for search (7.2): allocating a fresh Int8Array and Map for two
// million nodes would make the depth-4 numbers untestable. It uses the same
// `legalMoves` the engine uses, which is the thing under test.

import { isGoalSquare, legalMoves, other } from '../src/index.js';
import type { GameState, Move } from '../src/index.js';

function perftFrom(state: GameState, moves: Move[], depth: number): number {
  if (depth === 1) return moves.length;

  const { board, variant, turn: mover } = state;
  const childTurn = other(mover);
  let total = 0;

  for (const move of moves) {
    // Reaching the goal ends the game: count it, don't expand it. A neutral
    // move can never do this (4.2.5).
    if (move.piece.owner !== 'neutral' && isGoalSquare(variant, mover, move.to)) {
      total += 1;
      continue;
    }

    const captured = board[move.to]!;
    board[move.to] = board[move.from]!;
    board[move.from] = 0;

    const child: GameState = { ...state, board, turn: childTurn };
    const replies = legalMoves(child);
    // No reply means the game ended here too.
    total += replies.length === 0 ? 1 : perftFrom(child, replies, depth - 1);

    board[move.from] = board[move.to]!;
    board[move.to] = captured;
  }

  return total;
}

export function perft(state: GameState, depth: number): number {
  if (depth <= 0) return 1;
  return perftFrom(state, legalMoves(state), depth);
}
