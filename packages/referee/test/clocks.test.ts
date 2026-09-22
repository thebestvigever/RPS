import { describe, expect, it } from 'vitest';
import { UNLIMITED, createClock, delayed, fischer, startTurn } from '@sps/match';
import { FIRST_MOVE_MS, flagDeadline, gameRecord, liveClock, nextWakeAt } from '../src/index.js';
import { TOKENS, only, playMoves, seated, table } from './harness.js';

const MINUTE = 60_000;

describe('when the flag falls', () => {
  it('is exact for a plain clock', () => {
    const clock = startTurn(createClock(fischer(3, 2)), 'blue', 1_000);
    expect(flagDeadline(clock, 1_000)).toBe(1_000 + 3 * MINUTE);
    // Time passing does not move the deadline; it only moves `now` towards it.
    expect(flagDeadline(clock, 100_000)).toBe(1_000 + 3 * MINUTE);
  });

  it('accounts for a delay the player has not used yet', () => {
    // A simple delay waits five seconds before the clock starts counting, so a
    // one-minute clock actually falls at sixty-five seconds.
    for (const kind of ['simple', 'bronstein'] as const) {
      const clock = startTurn(createClock(delayed(1, 5, kind)), 'blue', 0);
      expect(flagDeadline(clock, 0)).toBe(65_000);
      // Halfway through the delay, the answer is the same wall-clock instant.
      expect(flagDeadline(clock, 2_000)).toBe(65_000);
    }
  });

  it('never falls on an unlimited clock, or one nobody is on', () => {
    expect(flagDeadline(startTurn(createClock(UNLIMITED), 'blue', 0), 0)).toBe(null);
    expect(flagDeadline(createClock(fischer(3, 2)), 0)).toBe(null);
  });
});

describe('the room runs the clock', () => {
  it('knows when to wake, and ends the game when it does', () => {
    const t = seated({ control: fischer(1, 0) });
    playMoves(t, 2);
    // Blue used a second on move one, so their minute now runs out at 61s.
    expect(nextWakeAt(t.room, 2_000)).toBe(61_000);

    t.alarm(61_000);
    const [result] = only(t.drain('red-1'), 'result');
    expect(result?.result).toEqual({ winner: 'red', reason: 'flag' });
    expect(result?.clocks.blue).toBe(0);
    expect(nextWakeAt(t.room, 61_000)).toBe(null);
  });

  it('gives the flag to a move that arrives too late', () => {
    const t = seated({ control: fischer(1, 0) });
    playMoves(t, 2);
    t.drain('blue-1');
    // Blue plays a perfectly legal move — four seconds after their time ran out.
    t.send('blue-1', { t: 'move', ply: 2, move: t.legal() }, 66_000);

    const seen = t.drain('blue-1');
    expect(only(seen, 'moved')).toEqual([]);
    expect(only(seen, 'result')[0]?.result).toEqual({ winner: 'red', reason: 'flag' });
    expect(t.room.state.moves).toHaveLength(2);
  });

  it('moves the wake-up on as each turn starts', () => {
    const t = seated({ control: fischer(1, 0) });
    // Blue takes five seconds; Red's minute now runs from there.
    t.send('blue-1', { t: 'move', ply: 0, move: t.legal() }, 5_000);
    expect(nextWakeAt(t.room, 5_000)).toBe(65_000);
    expect(nextWakeAt(t.room, 30_000)).toBe(65_000);

    t.send('red-1', { t: 'move', ply: 1, move: t.legal() }, 20_000);
    // Blue is back on the clock with the 55 seconds they had left.
    expect(nextWakeAt(t.room, 20_000)).toBe(20_000 + 55_000);
  });

  it('charges the mover and adds the increment, once per move', () => {
    const t = seated({ control: fischer(3, 2) });
    t.send('blue-1', { t: 'move', ply: 0, move: t.legal() }, 5_000);
    const [moved] = only(t.drain('red-1'), 'moved');
    expect(moved?.clocks.blue).toBe(3 * MINUTE - 5_000 + 2_000);
    expect(moved?.clocks.red).toBe(3 * MINUTE);
    expect(moved?.clocks.running).toBe('red');
  });

  it('writes the clock into the record, per move and per gift', () => {
    const t = seated({ control: fischer(3, 2) });
    playMoves(t, 4);
    t.send('blue-1', { t: 'gift' }, 10_000);

    const record = gameRecord(t.room);
    expect(record.clock?.control).toBe('3+2');
    expect(record.clock?.remainingMs).toHaveLength(4);
    expect(record.clock?.gifts).toEqual([{ ply: 4, from: 'blue', to: 'red', ms: 15_000 }]);
  });
});

describe('the first move', () => {
  it('aborts a game nobody starts within thirty seconds', () => {
    const t = seated();
    expect(nextWakeAt(t.room, 0)).toBe(FIRST_MOVE_MS);

    t.alarm(FIRST_MOVE_MS - 1);
    expect(t.room.game.result).toBe(null);

    t.alarm(FIRST_MOVE_MS);
    // Aborted, not lost: nobody has played anything, so there is no game to
    // lose (ADDENDUM-CLOCKS 2 — "counts for nothing").
    expect(only(t.drain('blue-1'), 'result')[0]?.result).toEqual({
      winner: null,
      reason: 'aborted',
    });
  });

  it('is late if it arrives late, whatever the sender thinks', () => {
    const t = seated();
    t.send('blue-1', { t: 'move', ply: 0, move: t.legal() }, FIRST_MOVE_MS + 100);

    const seen = t.drain('blue-1');
    expect(only(seen, 'moved')).toEqual([]);
    expect(only(seen, 'result')[0]?.result).toEqual({ winner: null, reason: 'aborted' });
  });

  it('stops mattering the moment somebody moves', () => {
    const t = seated();
    playMoves(t, 1);
    t.alarm(FIRST_MOVE_MS + 5_000);
    expect(t.room.game.result).toBe(null);
    expect(t.room.state.moves).toHaveLength(1);
  });

  it('does not start until the second player is there', () => {
    // A match sitting on an unopened invite link has no clock of any kind
    // running against it.
    const t = table();
    t.connect('blue-1');
    t.send('blue-1', { t: 'hello', matchId: 'match-one', token: TOKENS.blue, lastPly: 0 }, 0);
    t.alarm(FIRST_MOVE_MS + 60_000);
    expect(t.room.game.result).toBe(null);
    expect(nextWakeAt(t.room, 0)).toBe(null);
  });
});

describe('giving time away', () => {
  it('does not leave an offer standing when the clock ends the game', () => {
    const t = seated({ control: fischer(1, 0) });
    t.send('blue-1', { t: 'takeback-offer' }, 1_000);
    t.alarm(61_000);
    expect(t.room.state.offers.pending).toBe(null);
    t.send('red-1', { t: 'takeback-accept' }, 62_000);
    expect(only(t.drain('red-1'), 'error')[0]?.reason).toBe('the game is over');
    expect(t.room.game.ply).toBe(0);
  });


  it('hands the opponent fifteen seconds in a casual game', () => {
    const t = seated({ control: fischer(3, 2) });
    t.send('blue-1', { t: 'gift' }, 4_000);

    const [gifted] = only(t.drain('red-1'), 'gifted');
    expect(gifted).toMatchObject({ from: 'blue', to: 'red', ms: 15_000 });
    expect(gifted?.clocks.red).toBe(3 * MINUTE + 15_000);
    // And it is the opponent who gained, not the giver.
    expect(gifted?.clocks.blue).toBe(3 * MINUTE - 4_000);
  });

  it('is refused in a rated game, where it would be a way to buy a result', () => {
    const t = seated({ mode: 'rated', control: fischer(3, 2) });
    t.send('blue-1', { t: 'gift' }, 4_000);
    expect(only(t.drain('blue-1'), 'error')[0]?.code).toBe('not-allowed');
    expect(liveClock(t.room.state).gifts).toEqual([]);
  });

  it('is refused when there is no clock to add to', () => {
    const t = seated({ control: UNLIMITED });
    t.send('blue-1', { t: 'gift' }, 4_000);
    expect(only(t.drain('blue-1'), 'error')[0]?.reason).toBe('there is no clock to add to');
    // An unlimited clock never falls, but the first move is still on a timer.
    expect(nextWakeAt(t.room, 4_000)).toBe(FIRST_MOVE_MS);
    playMoves(t, 1);
    expect(nextWakeAt(t.room, 4_000)).toBe(null);
  });
});
