// Derived facts the interface and the AI both need — spec 2.10 and 7.6.
//
// A piece is PERMANENT when the opponent has no pieces of its predator type left
// (and, in Neutrals, no neutral of its predator type is left on the board).
//
// isSealed(state, defender):                           spec 7.6
//   attacker = other(defender)
//   goal = variant.goals[attacker]                     the defender's corner square(s)
//   wall = squares holding a permanent defender piece
//   frontier = every square holding an attacker piece
//   breadth-first search from frontier over king moves, never entering a wall square
//   if the search reaches any goal square that is not a wall square: return false
//   return true                                        (also false if the attacker has no pieces)
//
// This treats the attacker's own pieces and the defender's non-permanent pieces as
// passable, because they can move or be captured. At most 81 squares.
//
// A seal lasts only as long as its pieces stay put: re-check after every move
// rather than remembering it.

import { NotImplementedError } from './errors.js';
import type { GameState, PieceType, Side, Square } from './types.js';

export function typeCounts(
  _state: GameState,
): Record<Side, Record<PieceType, number>> {
  throw new NotImplementedError('typeCounts', '7.3');
}

export function isPermanent(_state: GameState, _square: Square): boolean {
  throw new NotImplementedError('isPermanent', '2.10');
}

export function isSealed(_state: GameState, _side: Side): boolean {
  throw new NotImplementedError('isSealed', '7.6');
}

/** King distance to the owner's nearest goal square. Backs the race meter (10.5). */
export function distanceToGoal(_state: GameState, _square: Square): number {
  throw new NotImplementedError('distanceToGoal', '7.3');
}
