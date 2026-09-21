// Pieces, the cycle, and board encoding — spec 2.2 and 7.2.

import type { Owner, Piece, PieceType, Side } from './types.js';

export const PIECE_TYPES: readonly PieceType[] = ['rock', 'paper', 'scissors'];
export const SIDES: readonly Side[] = ['blue', 'red'];

const OWNER_CODE: Record<Owner, number> = { blue: 0, red: 1, neutral: 2 };
const TYPE_CODE: Record<PieceType, number> = { rock: 0, paper: 1, scissors: 2 };
const OWNER_BY_CODE: readonly Owner[] = ['blue', 'red', 'neutral'];
const TYPE_BY_CODE: readonly PieceType[] = ['rock', 'paper', 'scissors'];

/** Rock beats Scissors, Scissors beat Paper, Paper beats Rock. */
const BEATS: Record<PieceType, PieceType> = {
  rock: 'scissors',
  scissors: 'paper',
  paper: 'rock',
};

/** The type that beats this one: Paper preys on Rock, Rock on Scissors, Scissors on Paper. */
const PREDATOR: Record<PieceType, PieceType> = {
  rock: 'paper',
  scissors: 'rock',
  paper: 'scissors',
};

export function beats(type: PieceType): PieceType {
  return BEATS[type];
}

export function predatorOf(type: PieceType): PieceType {
  return PREDATOR[type];
}

export function other(side: Side): Side {
  return side === 'blue' ? 'red' : 'blue';
}

export const EMPTY = 0;

/** owner * 4 + type + 1 (spec 7.2). */
export function encodePiece(piece: Piece): number {
  return OWNER_CODE[piece.owner] * 4 + TYPE_CODE[piece.type] + 1;
}

/** Returns null for an empty cell. Throws on a code no piece maps to. */
export function decodePiece(code: number): Piece | null {
  if (code === EMPTY) return null;
  const zeroBased = code - 1;
  const owner = OWNER_BY_CODE[Math.floor(zeroBased / 4)];
  const type = TYPE_BY_CODE[zeroBased % 4];
  if (!owner || !type) throw new Error(`Not a piece code: ${code}`);
  return { owner, type };
}
