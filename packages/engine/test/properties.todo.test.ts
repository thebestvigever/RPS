// Property tests over random legal move sequences in every variant — spec 11.4.
// fast-check is already a dependency; these turn on with M1.

import { describe, it } from 'vitest';

describe('invariants over random legal play (spec 11.4)', () => {
  it.todo('every square holds at most one piece, and piece counts never increase');
  it.todo('every move legalMoves returns is accepted by applyMove');
  it.todo('every move legalMoves does not return is rejected by applyMove');
  it.todo('a finished game has no legal moves, and applyMove on it throws');
  it.todo('fromFen(toFen(state)) reproduces the state');
  it.todo('parseMove(moveToText(m)) reproduces the move');
  it.todo('replay(variant, moves) reproduces the state reached move by move');
  it.todo('a neutral never moves to an empty square');
  it.todo('a neutral never captures its user’s pieces or another neutral');
  it.todo('a neutral never produces a corner result');
  it.todo('isSealed is never true while an attacker has an unblocked king path to the goal');
});

describe('simulation checks (spec 11.5)', () => {
  it.todo('1,000 random-vs-random games per variant all end by a result or the move limit');
  it.todo('no invariant breaks across those games');
});
