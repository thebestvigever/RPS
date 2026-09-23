// The browser's side of the room, tested the way the room itself is: as a
// reducer, with no socket and no DOM.

import { describe, expect, it } from 'vitest';
import { remainingAt } from '@sps/match';
import { fischer, UNLIMITED } from '@sps/match';
import type { ServerMessage } from '@sps/referee';
import {
  applyServerMessage,
  claimableAtLocal,
  clockFromServer,
  initialMatch,
  opponentAway,
  phaseOf,
} from '../src/match-client.js';
import type { MatchState } from '../src/match-client.js';

const clocks = (blue: number, red: number, running: 'blue' | 'red' | null, serverTime: number) => ({
  blue,
  red,
  running,
  serverTime,
});

const welcome = (over: Partial<Extract<ServerMessage, { t: 'welcome' }>> = {}): ServerMessage => ({
  t: 'welcome',
  matchId: 'm1',
  you: 'blue',
  record: {
    game: 'stone-paper-scissors',
    rulesVersion: 1,
    variant: 'original',
    start: '9/4PR3/4SPR2/5SPR1/1ps3SP1/1rps5/2rps4/3rp4/9 blue',
    moves: [],
    result: null,
    clock: { control: '10+5', initialMs: 600_000, incrementMs: 5_000, remainingMs: [] },
  },
  clocks: clocks(600_000, 600_000, null, 1_000),
  presence: { blue: 'online', red: 'away', claimableAt: { blue: null, red: null }, serverTime: 1_000 },
  offer: null,
  names: { blue: null, red: null },
  mode: 'online-casual',
  startedAt: null,
  ...over,
});

const apply = (state: MatchState, message: ServerMessage, at = 1_000) =>
  applyServerMessage(state, message, at);

describe('what the room tells this browser', () => {
  it('starts out knowing nothing', () => {
    expect(phaseOf(initialMatch('m1'))).toBe('connecting');
  });

  it('waits for an opponent, then plays', () => {
    let state = apply(initialMatch('m1'), welcome());
    expect(phaseOf(state)).toBe('waiting');
    expect(state.you).toBe('blue');
    expect(state.control).toEqual({ id: '10+5', initialMs: 600_000, incrementMs: 5_000 });

    state = apply(state, {
      t: 'started',
      clocks: clocks(600_000, 600_000, 'blue', 5_000),
      startedAt: 5_000,
    });
    expect(phaseOf(state)).toBe('playing');
    expect(state.clocks?.running).toBe('blue');
  });

  it('takes moves in order, and takes the same move twice without doubling it', () => {
    let state = apply(initialMatch('m1'), welcome({ startedAt: 1_000 }));
    const moved = (ply: number, move: string): ServerMessage => ({
      t: 'moved',
      ply,
      move,
      events: [],
      clocks: clocks(599_000, 600_000, 'red', 2_000 + ply),
    });

    state = apply(state, moved(1, 'Pb5-b6'));
    state = apply(state, moved(2, 'Ph5-h4'));
    // A catch-up after a reconnect redelivers what this client already has.
    state = apply(state, moved(2, 'Ph5-h4'));
    expect(state.moves).toEqual(['Pb5-b6', 'Ph5-h4']);
  });

  it('shortens the game when the room says a takeback was agreed', () => {
    let state = apply(initialMatch('m1'), welcome({ startedAt: 1_000 }));
    for (const [ply, move] of [
      [1, 'Pb5-b6'],
      [2, 'Ph5-h4'],
      [3, 'Pb6-b7'],
    ] as const) {
      state = apply(state, { t: 'moved', ply, move, events: [], clocks: clocks(1, 1, 'red', ply) });
    }
    state = apply(state, { t: 'took-back', ply: 2, clocks: clocks(1, 1, 'blue', 9) });
    expect(state.moves).toEqual(['Pb5-b6', 'Ph5-h4']);
    expect(state.clockHistory).toHaveLength(2);
  });

  it('keeps the newest clock reading, not the last one to arrive', () => {
    // Catching up delivers historical clocks after the welcome's live one.
    // Every view carries its own serverTime, and that is what sorts them out.
    let state = apply(initialMatch('m1'), welcome({ startedAt: 1_000 }), 1_000);
    state = apply(state, { t: 'pong', serverTime: 9_000, at: null }, 9_000);
    const before = state.clocks;
    state = apply(
      state,
      { t: 'moved', ply: 1, move: 'Pb5-b6', events: [], clocks: clocks(1, 1, 'red', 500) },
      9_100,
    );
    expect(state.clocks).toBe(before);
    // The move itself still landed; only the stale clock was ignored.
    expect(state.moves).toEqual(['Pb5-b6']);
  });

  it('remembers a result, and a pending offer, and forgets the offer when it settles', () => {
    let state = apply(initialMatch('m1'), welcome({ startedAt: 1_000 }));
    state = apply(state, { t: 'draw-offered', by: 'red' });
    expect(state.offer).toEqual({ kind: 'draw', by: 'red' });

    state = apply(state, {
      t: 'result',
      result: { winner: 'blue', reason: 'abandoned' },
      clocks: clocks(1, 1, null, 20_000),
    });
    expect(state.offer).toBe(null);
    expect(phaseOf(state)).toBe('over');
  });

  it('gives up on a link that opens nothing, and not on an ordinary refusal', () => {
    let state = apply(initialMatch('m1'), welcome());
    state = apply(state, { t: 'error', code: 'not-allowed', reason: 'not yet' });
    expect(state.fatal).toBe(null);
    expect(state.notice).toBe('not yet');

    state = apply(state, { t: 'error', code: 'bad-token', reason: 'that link does not open a seat' });
    expect(state.fatal).toBe('that link does not open a seat');
  });
});

describe('the opponent leaving', () => {
  it('reads the claim deadline in local time, however wrong this clock is', () => {
    // The browser's clock is a minute ahead of the server's. The room sends an
    // instant, not a countdown, so the deadline lands in the right place
    // anyway — which is the whole reason it sends an instant.
    const state = apply(
      initialMatch('m1'),
      {
        t: 'presence',
        blue: 'online',
        red: 'away',
        claimableAt: { blue: null, red: 160_000 },
        serverTime: 100_000,
      },
      40_000,
    );
    expect(opponentAway(state, 'blue')).toBe(true);
    expect(state.skewMs).toBe(60_000);
    // 60s after the local moment the message arrived, not 160s after it.
    expect(claimableAtLocal(state, 'blue')).toBe(100_000);
    expect(claimableAtLocal(state, 'red')).toBe(null);
  });
});

describe('the room owns the clock', () => {
  it('reads as the same clock the rest of the app draws', () => {
    const clock = clockFromServer(fischer(10, 5), clocks(120_000, 95_000, 'red', 5_000), 5_000);
    expect(remainingAt(clock, 'blue', 5_000)).toBe(120_000);
    expect(remainingAt(clock, 'red', 5_000)).toBe(95_000);
    // Red is the one being counted down.
    expect(remainingAt(clock, 'red', 15_000)).toBe(85_000);
    expect(remainingAt(clock, 'blue', 15_000)).toBe(120_000);
  });

  it('reads an unlimited game as unlimited rather than as zero', () => {
    const clock = clockFromServer(UNLIMITED, clocks(null, null, 'blue', 0), 0);
    expect(remainingAt(clock, 'blue', 999_999)).toBe(Infinity);
  });

  it('carries the gifts, so the game-over summary can say who gave what', () => {
    const clock = clockFromServer(fischer(3, 2), clocks(1, 1, 'blue', 0), 0, [
      { ply: 4, from: 'blue', to: 'red', ms: 15_000 },
    ]);
    expect(clock.gifts).toEqual([{ ply: 4, from: 'blue', to: 'red', ms: 15_000 }]);
  });
});
