// Spec 10.7: the game-over overlay shows "moves played, captures each side,
// and which types were wiped out and when". All three come off the event
// stream, never off a board diff (spec 7.7) — the "when" is not recoverable
// from two boards at all.

import { describe, expect, it } from 'vitest';
import { fromFen, replay } from '../src/game.js';
import { applyMove } from '../src/game.js';
import { parseMove } from '../src/notation.js';
import { summarise } from '../src/summary.js';
import { VARIANTS } from '../src/variants.js';
import type { GameEvent } from '../src/types.js';

describe('summarise', () => {
  it('counts nothing for a game nobody has moved in', () => {
    expect(summarise([])).toEqual({
      plies: 0,
      captures: { blue: 0, red: 0 },
      neutralCaptures: 0,
      extinctions: [],
    });
  });

  it('counts a capture against the captor, and records the extinction it caused', () => {
    // Tutorial puzzle 2 (spec 10.9): Blue's Rock takes Red's only Scissors.
    const state = fromFen('9/9/9/3PRS3/4r4/9/9/9/9 blue', VARIANTS.original);
    const { events } = applyMove(state, parseMove(state, 'Re5xf6'));
    const summary = summarise([events]);

    expect(summary.plies).toBe(1);
    expect(summary.captures).toEqual({ blue: 1, red: 0 });
    expect(summary.extinctions).toEqual([{ side: 'red', pieceType: 'scissors', ply: 1 }]);
  });

  it('numbers extinctions by the ply they happened on', () => {
    const events: GameEvent[][] = [
      [{ type: 'move', from: 0, to: 1, piece: { owner: 'blue', type: 'rock' } }],
      [{ type: 'type-extinct', side: 'red', pieceType: 'paper' }],
      [{ type: 'type-extinct', side: 'blue', pieceType: 'rock' }],
    ];
    expect(summarise(events).extinctions).toEqual([
      { side: 'red', pieceType: 'paper', ply: 2 },
      { side: 'blue', pieceType: 'rock', ply: 3 },
    ]);
  });

  it('counts a neutral capture apart rather than crediting a side', () => {
    // A neutral piece belongs to nobody (spec 4.2), so `by.owner` cannot say
    // who benefited — and guessing would quietly inflate one side's count.
    const events: GameEvent[][] = [
      [
        {
          type: 'capture',
          at: 40,
          captured: { owner: 'red', type: 'rock' },
          by: { owner: 'neutral', type: 'paper' },
        },
      ],
    ];
    const summary = summarise(events);
    expect(summary.neutralCaptures).toBe(1);
    expect(summary.captures).toEqual({ blue: 0, red: 0 });
  });

  it('agrees with a real replay', () => {
    const moves = ['Sd4-d5', 'Se7-d6', 'Rc3-c2'];
    const { events } = replay(VARIANTS.original, moves);
    const summary = summarise(events);
    expect(summary.plies).toBe(moves.length);
    expect(summary.captures).toEqual({ blue: 0, red: 0 });
  });
});
