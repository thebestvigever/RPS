// The M1 rule-test checklist — spec 11.1 asks for one test per row of the 2.6
// table, per rule in 4.2, and per ending in 2.7-2.9. Written out as todos so the
// shape of M1 is visible in the test report rather than in a document.

import { describe, it } from 'vitest';

describe('what can move where (spec 2.6)', () => {
  it.todo('an empty destination is legal');
  it.todo('a destination holding your own piece is illegal');
  it.todo('an enemy piece your type beats is a legal capture');
  it.todo('an enemy piece of the same type is illegal');
  it.todo('an enemy piece that beats your type is illegal');
  it.todo('a captured piece is gone for the rest of the game');
  it.todo('capturing is never compulsory');
});

describe('winning by the corner (spec 2.7)', () => {
  it.todo('stepping onto an empty goal square wins');
  it.todo('capturing onto an occupied goal square wins');
  it.todo('a player may move onto their own corner');
  it.todo('a loaded position with a side already on its goal is marked over');
  it.todo('the corner check beats the no-moves check when a move triggers both');
});

describe('losing and drawing (spec 2.8-2.9)', () => {
  it.todo('the side to move with no legal move loses, reason no-moves');
  it.todo('a side with no pieces left loses, reason no-moves');
  it.todo('the third occurrence of a position draws, counting the start position');
  it.todo('the 300th ply with no result draws, reason move-limit');
  it.todo('resigning ends the game for the resigning side');
});

describe('neutral pieces (spec 4.2)', () => {
  it.todo('4.2.1 a neutral may be moved only to capture an adjacent enemy piece it beats');
  it.todo('4.2.2 a neutral never moves to an empty square');
  it.todo('4.2.3 a neutral you use cannot capture your own pieces');
  it.todo('4.2.3 a neutral can never capture another neutral');
  it.todo('4.2.4 either player may capture a neutral their type beats');
  it.todo('4.2.5 a neutral on a goal square wins nothing for anyone');
  it.todo('4.2.6 a neutral on a goal square blocks it until captured');
  it.todo('4.2.7 using a neutral counts for repetition and the move limit');
  it.todo('4.2.8 a player with only a neutral capture available is not out of moves');
  it.todo('4.2.9 a neutral of the predator type keeps enemy pieces non-permanent');
});

describe('the Keep (spec 2.10, 7.6)', () => {
  it.todo('a piece is permanent once the opponent has lost its predator type');
  it.todo('a neutral of the predator type stops a piece being permanent');
  it.todo('isSealed is true for a permanent piece parked on the corner');
  it.todo('isSealed is false while an attacker has an unblocked path to the goal');
  it.todo('isSealed is false when the attacker has no pieces');
  it.todo('a seal disappears when its pieces move away');
  it.todo('the engine never special-cases the Keep — it emerges from 2.6-2.7');
});

describe('events (spec 7.5, 7.7)', () => {
  it.todo('emits move, then capture, then type-extinct, then sealed, then game-over');
  it.todo('emits type-extinct exactly once, when the count reaches zero');
});
