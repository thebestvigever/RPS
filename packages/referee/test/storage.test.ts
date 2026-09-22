import { describe, expect, it } from 'vitest';
import { toFen } from '@sps/engine';
import { UNLIMITED, fischer, remainingAt } from '@sps/match';
import {
  SnapshotError,
  clocksView,
  gameRecord,
  liveClock,
  loadRoom,
  nextWakeAt,
  open,
  receive,
  saveRoom,
} from '../src/index.js';
import type { RoomSnapshot } from '../src/index.js';
import { TOKENS, playMoves, seated } from './harness.js';

/** Through JSON and back — the trip the Durable Object's storage actually makes. */
const roundTrip = (snapshot: RoomSnapshot): RoomSnapshot =>
  JSON.parse(JSON.stringify(snapshot)) as RoomSnapshot;

describe('waking up with nothing but storage', () => {
  it('comes back as the same room', () => {
    const t = seated({ control: fischer(3, 2) });
    playMoves(t, 5);
    t.send('blue-1', { t: 'gift' }, 20_000);
    t.send('red-1', { t: 'draw-offer' }, 21_000);

    const before = t.room;
    const after = loadRoom(roundTrip(saveRoom(before)));

    expect(after.state.moves).toEqual(before.state.moves);
    expect(toFen(after.game)).toBe(toFen(before.game));
    expect(after.game.turn).toBe(before.game.turn);
    expect(after.game.ply).toBe(before.game.ply);
    expect(after.state.seats).toEqual(before.state.seats);
    expect(after.state.startedAt).toBe(before.state.startedAt);
    expect(after.state.away).toEqual(before.state.away);
    expect(after.state.offers.pending).toEqual({ kind: 'draw', by: 'red', atPly: 5 });
    expect(after.state.offers.policy).toEqual(before.state.offers.policy);
    expect(clocksView(liveClock(after.state), 25_000)).toEqual(
      clocksView(liveClock(before.state), 25_000),
    );
    expect(nextWakeAt(after, 25_000)).toBe(nextWakeAt(before, 25_000));
    expect(gameRecord(after)).toEqual(gameRecord(before));

    // The sockets do not come back, and must not: a woken room re-registers
    // whatever is still connected.
    expect(after.connections.size).toBe(0);
  });

  it('carries on being played', () => {
    const t = seated();
    playMoves(t, 4);
    let room = loadRoom(roundTrip(saveRoom(t.room)));

    room = open(room, 'blue-2', 30_000);
    const greeted = receive(
      room,
      'blue-2',
      JSON.stringify({ t: 'hello', matchId: 'match-one', token: TOKENS.blue, lastPly: 4 }),
      30_000,
    );
    room = greeted.room;
    const move = gameRecord(room).moves.length;
    expect(move).toBe(4);

    const played = receive(
      room,
      'blue-2',
      JSON.stringify({ t: 'move', ply: 4, move: 'Pb5-b6' }),
      31_000,
    );
    // Whether that particular move is legal is the engine's business; what
    // matters here is that the restored room answered as a referee rather than
    // as an empty object.
    const answers = played.out.map((outbound) => outbound.message.t);
    expect(answers.some((t) => t === 'moved' || t === 'rejected')).toBe(true);
  });

  it('remembers an ending that the moves alone do not imply', () => {
    const t = seated();
    playMoves(t, 3);
    t.send('red-1', { t: 'resign' }, 10_000);

    const after = loadRoom(roundTrip(saveRoom(t.room)));
    expect(after.game.result).toEqual({ winner: 'blue', reason: 'resign' });
    expect(nextWakeAt(after, 11_000)).toBe(null);
  });

  it('keeps an unlimited clock unlimited, which JSON alone would not', () => {
    const t = seated({ control: UNLIMITED });
    playMoves(t, 2);

    const saved = roundTrip(saveRoom(t.room));
    expect(saved.clocks[0]?.remainingMs.blue).toBe(null);

    const after = loadRoom(saved);
    expect(remainingAt(liveClock(after.state), 'blue', 99_999)).toBe(Infinity);
    expect(clocksView(liveClock(after.state), 99_999).blue).toBe(null);
    expect(gameRecord(after).clock).toBeUndefined();
  });

  it('refuses a snapshot written by a version it does not know', () => {
    const t = seated();
    const saved = { ...roundTrip(saveRoom(t.room)), v: 2 } as unknown as RoomSnapshot;
    expect(() => loadRoom(saved)).toThrow(SnapshotError);
  });

  it('survives a save after every single move, which is what the room actually does', () => {
    const t = seated({ control: fischer(3, 2) });
    let now = 0;
    for (let i = 0; i < 6; i++) {
      now = playMoves(t, 1, now);
      const reloaded = loadRoom(roundTrip(saveRoom(t.room)));
      expect(reloaded.state.moves).toEqual(t.room.state.moves);
      expect(toFen(reloaded.game)).toBe(toFen(t.room.game));
      expect(clocksView(liveClock(reloaded.state), now)).toEqual(
        clocksView(liveClock(t.room.state), now),
      );
    }

    const record = gameRecord(t.room);
    expect(record.moves).toHaveLength(6);
    expect(record.clock?.remainingMs).toHaveLength(6);
  });
});
