import { describe, expect, it } from 'vitest';
import { fischer } from '@sps/match';
import { AWAY_CLAIM_MS, CLOSE, flagDeadline, liveClock, nextWakeAt } from '../src/index.js';
import { TOKENS, only, playMoves, seated } from './harness.js';

const hello = (lastPly: number, token = TOKENS.red) => ({
  t: 'hello',
  matchId: 'match-one',
  token,
  lastPly,
});

describe('wifi dies', () => {
  it('tells the other player, and keeps the clock running', () => {
    const t = seated({ control: fischer(3, 2) });
    t.disconnect('red-1', 10_000);

    expect(only(t.drain('blue-1'), 'presence')[0]).toEqual({
      t: 'presence',
      blue: 'online',
      red: 'away',
    });
    // Spec 13.2: a disconnected player's clock keeps running. Blue is still on
    // the clock and nothing about Red leaving has paused it.
    expect(flagDeadline(liveClock(t.room.state), 10_000)).toBe(3 * 60_000);
    // The room wakes at the earlier of the two things that can happen on their
    // own — here, Red becoming claimable a minute from now.
    expect(nextWakeAt(t.room, 10_000)).toBe(10_000 + AWAY_CLAIM_MS);
  });

  it('carries on where it left off, with the moves that were missed', () => {
    const t = seated();
    playMoves(t, 2);
    t.disconnect('red-1', 5_000);
    t.drain('blue-1');

    // Blue plays on while Red is away.
    t.send('blue-1', { t: 'move', ply: 2, move: t.legal() }, 6_000);

    t.connect('red-2', 9_000);
    t.send('red-2', hello(2), 9_000);

    const seen = t.drain('red-2');
    const [welcome] = only(seen, 'welcome');
    expect(welcome?.you).toBe('red');
    // The welcome carries the whole record; the catch-up carries the events
    // for the plies this client slept through, and only those.
    expect(welcome?.record.moves).toHaveLength(3);
    const caught = only(seen, 'moved');
    expect(caught).toHaveLength(1);
    expect(caught[0]?.ply).toBe(3);
    expect(caught[0]?.events[0]).toMatchObject({ type: 'move' });
    // Historical clocks are marked as such by their own serverTime.
    expect(caught[0]?.clocks.serverTime).toBe(6_000);
    expect(welcome?.clocks.serverTime).toBe(9_000);

    expect(only(t.drain('blue-1'), 'presence')[0]).toEqual({
      t: 'presence',
      blue: 'online',
      red: 'online',
    });
  });

  it('sends the whole game to a client that has nothing', () => {
    const t = seated();
    playMoves(t, 4);
    t.connect('watcher', 9_000);
    t.send('watcher', { t: 'hello', matchId: 'match-one', token: null, lastPly: 0 }, 9_000);
    expect(only(t.drain('watcher'), 'moved').map((m) => m.ply)).toEqual([1, 2, 3, 4]);
  });

  it('hangs up the half-dead socket when the same token comes back', () => {
    const t = seated();
    playMoves(t, 2);
    // Red's connection never closed — it just stopped working.
    t.connect('red-2', 8_000);
    t.send('red-2', hello(2), 8_000);

    expect(t.hangups).toEqual([
      { id: 'red-1', code: CLOSE.superseded, reason: 'reconnected elsewhere' },
    ]);
    expect(t.room.connections.has('red-1')).toBe(false);
    // And the seat never went away, so nobody was ever marked absent.
    expect(t.room.state.away.red).toBe(null);
  });

  it('does not mark a seat away while another of its sockets is open', () => {
    const t = seated();
    t.connect('red-2', 1_000);
    t.send('red-2', hello(0), 1_000);
    t.drain('blue-1');
    // The superseded socket closing later must not report Red as gone.
    t.disconnect('red-1', 2_000);
    expect(t.drain('blue-1')).toEqual([]);
    expect(t.room.state.away.red).toBe(null);
  });
});

describe('walking away', () => {
  it('lets the opponent claim after sixty seconds, and not before', () => {
    const t = seated();
    playMoves(t, 2);
    t.disconnect('red-1', 10_000);
    t.drain('blue-1');

    t.send('blue-1', { t: 'claim' }, 10_000 + AWAY_CLAIM_MS - 1);
    expect(only(t.drain('blue-1'), 'error')[0]?.reason).toBe(
      'your opponent has not been away long enough',
    );
    expect(t.room.game.result).toBe(null);

    t.send('blue-1', { t: 'claim' }, 10_000 + AWAY_CLAIM_MS);
    expect(only(t.drain('blue-1'), 'result')[0]?.result).toEqual({
      winner: 'blue',
      reason: 'resign',
    });
  });

  it('wakes the room when the claim becomes possible', () => {
    const t = seated();
    t.disconnect('red-1', 10_000);
    expect(nextWakeAt(t.room, 10_000)).toBe(10_000 + AWAY_CLAIM_MS);
  });

  it('is not a way out of a rated game', () => {
    const t = seated({ mode: 'rated' });
    playMoves(t, 2);
    t.disconnect('red-1', 10_000);
    t.send('blue-1', { t: 'claim' }, 100_000);
    expect(only(t.drain('blue-1'), 'error')[0]?.reason).toBe(
      'a rated game is decided by the clock, not by claiming',
    );
  });

  it('forgets the absence the moment the player is back', () => {
    const t = seated();
    t.disconnect('red-1', 10_000);
    t.connect('red-2', 20_000);
    t.send('red-2', hello(0), 20_000);
    t.send('blue-1', { t: 'claim' }, 100_000);
    expect(only(t.drain('blue-1'), 'error')[0]?.reason).toBe(
      'your opponent has not been away long enough',
    );
  });
});
