// Move notation — spec 8.1.
//
// Grammar: [n]<Type><from><sep><to>[#]
//   n      present only when a neutral piece is used (Neutrals variant)
//   <Type> R, P or S -- the type of the piece that moves
//   <sep>  `-` for a plain move, `x` for a capture
//   #      the move reaches the goal and wins
//
// Examples: Sd4-e5 - Pc4xd5 - nRe5xf6 - Sh8xi9#
//
// M1. Moves are unambiguous from <from> and <to> alone; the type letter and `n`
// are for people and for validation. parseMove MUST reject text whose type or
// `n` does not match the board.

import { NotImplementedError } from './errors.js';
import type { GameState, Move } from './types.js';

export function moveToText(_state: GameState, _move: Move): string {
  throw new NotImplementedError('moveToText', '8.1');
}

export function parseMove(_state: GameState, _text: string): Move {
  throw new NotImplementedError('parseMove', '8.1');
}
