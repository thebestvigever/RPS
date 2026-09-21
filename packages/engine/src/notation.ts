// Move notation — spec 8.1.
//
// Grammar: [n]<Type><from><sep><to>[#]
//   n      present only when a neutral piece is used (Neutrals variant)
//   <Type> R, P or S — the type of the piece that moves
//   <sep>  `-` for a plain move, `x` for a capture
//   #      the move reaches the goal and wins
//
// Examples: Sd4-e5 · Pc4xd5 · nRe5xf6 · Sh8xi9#
//
// Moves are unambiguous from <from> and <to> alone; the type letter and `n` are
// for people and for validation.

import { parseSquare, squareName } from './board.js';
import { IllegalMoveError, NotationError } from './errors.js';
import { isGoalSquare } from './goals.js';
import { findLegalMove } from './moves.js';
import type { GameState, Move, PieceType } from './types.js';

const MOVE_RE = /^(n?)([RPS])([a-i][1-9])([-x])([a-i][1-9])(#?)$/;

const LETTER_BY_TYPE: Record<PieceType, string> = {
  rock: 'R',
  paper: 'P',
  scissors: 'S',
};

const TYPE_BY_LETTER: Record<string, PieceType> = {
  R: 'rock',
  P: 'paper',
  S: 'scissors',
};

/** Does this move end the game by reaching the goal? A neutral never can (4.2.5). */
function isWinning(state: GameState, move: Move): boolean {
  return (
    move.piece.owner !== 'neutral' &&
    isGoalSquare(state.variant, move.piece.owner, move.to)
  );
}

export function moveToText(state: GameState, move: Move): string {
  const neutral = move.piece.owner === 'neutral' ? 'n' : '';
  const type = LETTER_BY_TYPE[move.piece.type];
  const separator = move.captured ? 'x' : '-';
  const win = isWinning(state, move) ? '#' : '';
  return `${neutral}${type}${squareName(move.from)}${separator}${squareName(move.to)}${win}`;
}

/**
 * Parses move text against a position. Rejects text that doesn't match the
 * grammar, text whose type letter or `n` prefix disagrees with the board, and
 * moves that aren't legal here.
 *
 * The separator and `#` are derived, so they are checked too: writing `-` for a
 * capture is a notation error, not a silently accepted move.
 */
export function parseMove(state: GameState, text: string): Move {
  const parts = MOVE_RE.exec(text.trim());
  if (!parts) {
    throw new NotationError(`"${text}" is not a move — expected [n]<Type><from><sep><to>[#]`);
  }

  const [, neutral, letter, fromName, separator, toName, win] = parts as unknown as [
    string, string, string, string, string, string, string,
  ];

  const from = parseSquare(fromName);
  const to = parseSquare(toName);

  const move = findLegalMove(state, { from, to });
  if (!move) {
    throw new IllegalMoveError(`"${text}" is not legal for ${state.turn} in this position`);
  }

  const wantNeutral = neutral === 'n';
  const isNeutral = move.piece.owner === 'neutral';
  if (wantNeutral !== isNeutral) {
    throw new NotationError(
      isNeutral
        ? `"${text}" moves the neutral ${move.piece.type} — write it as n${text}`
        : `"${text}" is marked as a neutral move, but ${fromName} holds a ${state.turn} ${move.piece.type}`,
    );
  }

  const declared = TYPE_BY_LETTER[letter]!;
  if (declared !== move.piece.type) {
    throw new NotationError(
      `"${text}" says ${declared}, but ${fromName} holds a ${move.piece.type}`,
    );
  }

  const shouldCapture = move.captured !== null;
  if ((separator === 'x') !== shouldCapture) {
    throw new NotationError(
      shouldCapture
        ? `"${text}" is a capture — write ${fromName}x${toName}`
        : `"${text}" captures nothing — write ${fromName}-${toName}`,
    );
  }

  const shouldWin = isWinning(state, move);
  if ((win === '#') !== shouldWin) {
    throw new NotationError(
      shouldWin
        ? `"${text}" reaches the goal and wins — mark it with #`
        : `"${text}" is marked as winning, but ${toName} is not a goal square for ${state.turn}`,
    );
  }

  return move;
}
