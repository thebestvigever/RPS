// Move generation — spec 7.4.
//
// Moves are emitted in origin-square order, then destination-square order, which
// the fixtures and replays rely on. NEIGHBOURS is already ascending, and squares
// are walked 0..80, so the order falls out of the loops.

import { NEIGHBOURS, SQUARE_COUNT } from './board.js';
import { EMPTY, beats, decodePiece } from './pieces.js';
import type { GameState, Move, MoveInput } from './types.js';

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

    const beaten = beats(piece.type);

    for (const to of NEIGHBOURS[from]!) {
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

