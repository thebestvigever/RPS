import { beforeAll, describe, expect, it } from 'vitest';
import { CLOSE } from '@sps/referee';
import { MatchRoom } from '../src/room-object.js';
import type { Env, InitBody } from '../src/room-object.js';
import { FakeState, installRuntimeGlobals } from './runtime.js';
import type { FakeSocket } from './runtime.js';

beforeAll(() => {
  installRuntimeGlobals();
});

const TOKENS = { blue: 'blue-token-aaaa', red: 'red-token-bbbb' };

const init: InitBody = {
  matchId: 'match-one12',
  mode: 'online-casual',
  variant: 'original',
  control: '3+2',
  tokens: TOKENS,
};

const env = {} as Env;

/** A room object over a fresh state, initialised and ready. */
async function opened(): Promise<{ state: FakeState; room: MatchRoom }> {
  const state = new FakeState();
  const room = new MatchRoom(state as unknown as DurableObjectState, env);
  await state.ready;
  await room.fetch(
    new Request('https://room/init', { method: 'POST', body: JSON.stringify(init) }),
  );
  return { state, room };
}

async function connect(state: FakeState, room: MatchRoom): Promise<FakeSocket> {
  await room.fetch(new Request('https://room/ws', { headers: { upgrade: 'websocket' } }));
  const socket = state.accepted[state.accepted.length - 1];
  if (!socket) throw new Error('no socket was accepted');
  return socket;
}

const hello = (token: string | null, lastPly = 0) =>
  JSON.stringify({ t: 'hello', matchId: init.matchId, token, lastPly });

/** Both players connected and seated — the state most tests start from. */
async function playing(): Promise<{ state: FakeState; room: MatchRoom; blue: FakeSocket; red: FakeSocket }> {
  const { state, room } = await opened();
  const blue = await connect(state, room);
  await room.webSocketMessage(blue as unknown as WebSocket, hello(TOKENS.blue));
  const red = await connect(state, room);
  await room.webSocketMessage(red as unknown as WebSocket, hello(TOKENS.red));
  blue.drain();
  red.drain();
  return { state, room, blue, red };
}

describe('a match in a Durable Object', () => {
  it('is written down the moment it exists', async () => {
    const { state, room } = await opened();
    expect(state.storage.size).toBe(1);

    const summary = (await (await room.fetch(new Request('https://room/summary'))).json()) as {
      matchId: string;
      seatsTaken: { blue: boolean; red: boolean };
    };
    expect(summary.matchId).toBe(init.matchId);
    expect(summary.seatsTaken).toEqual({ blue: false, red: false });
  });

  it('refuses to be initialised twice', async () => {
    const { room } = await opened();
    const second = await room.fetch(
      new Request('https://room/init', { method: 'POST', body: JSON.stringify(init) }),
    );
    expect(second.status).toBe(409);
  });

  it('seats a socket and remembers the seat on the socket itself', async () => {
    const { state, room } = await opened();
    const blue = await connect(state, room);
    await room.webSocketMessage(blue as unknown as WebSocket, hello(TOKENS.blue));

    const [welcome] = blue.messages();
    expect(welcome?.['t']).toBe('welcome');
    expect(welcome?.['you']).toBe('blue');
    // This is what survives hibernation, and the only thing that does.
    expect(blue.deserializeAttachment()).toMatchObject({ seat: 'blue', greeted: true });
  });

  it('plays a move to everybody and sets an alarm for the clock', async () => {
    const { state, room, blue, red } = await playing();
    await room.webSocketMessage(
      blue as unknown as WebSocket,
      JSON.stringify({ t: 'move', ply: 0, move: 'Pb5-b6' }),
    );

    for (const socket of [blue, red]) {
      const moved = socket.drain().find((message) => message['t'] === 'moved');
      expect(moved).toMatchObject({ ply: 1, move: 'Pb5-b6' });
    }

    // Red is now on a three-minute clock, so the room has to be awake by then.
    const alarm = state.storage.alarm;
    expect(alarm).not.toBe(null);
    expect(alarm! - Date.now()).toBeGreaterThan(170_000);
    expect(alarm! - Date.now()).toBeLessThanOrEqual(3 * 60_000 + 2_000);
  });

  it('wakes up with its variables gone and carries on refereeing', async () => {
    const { state, room, blue, red } = await playing();
    await room.webSocketMessage(
      blue as unknown as WebSocket,
      JSON.stringify({ t: 'move', ply: 0, move: 'Pb5-b6' }),
    );
    blue.drain();
    red.drain();

    // Hibernation: the object is evicted, its sockets are not. A new instance
    // over the same state is exactly what comes back.
    const woken = new MatchRoom(state as unknown as DurableObjectState, env);
    await state.ready;

    // Red never says hello again — the seat came back off the socket.
    await woken.webSocketMessage(red as unknown as WebSocket, JSON.stringify({ t: 'ping', at: 7 }));
    expect(red.drain().some((message) => message['t'] === 'pong')).toBe(true);

    await woken.webSocketMessage(
      red as unknown as WebSocket,
      JSON.stringify({ t: 'move', ply: 1, move: 'Ph5-h4' }),
    );
    const moved = blue.drain().find((message) => message['t'] === 'moved');
    expect(moved).toMatchObject({ ply: 2 });
  });

  it('tells the other player when a socket goes, and hangs up the stale half on return', async () => {
    const { state, room, blue, red } = await playing();

    await room.webSocketClose(red as unknown as WebSocket);
    expect(blue.drain()).toContainEqual({ t: 'presence', blue: 'online', red: 'away' });

    const red2 = await connect(state, room);
    await room.webSocketMessage(red2 as unknown as WebSocket, hello(TOKENS.red));
    expect(blue.drain()).toContainEqual({ t: 'presence', blue: 'online', red: 'online' });

    // And a third socket on the same token supersedes the second.
    const red3 = await connect(state, room);
    await room.webSocketMessage(red3 as unknown as WebSocket, hello(TOKENS.red));
    expect(red2.closed).toEqual({ code: CLOSE.superseded, reason: 'reconnected elsewhere' });
  });

  it('hangs up a bad token', async () => {
    const { state, room } = await opened();
    const stranger = await connect(state, room);
    await room.webSocketMessage(stranger as unknown as WebSocket, hello('some-other-token'));

    expect(stranger.messages()[0]).toMatchObject({ t: 'error', code: 'bad-token' });
    expect(stranger.closed?.code).toBe(CLOSE.badToken);
  });

  it('ends the game itself when the alarm finds a fallen flag', async () => {
    const { state, room, blue, red } = await playing();
    const original = Date.now;
    try {
      // Four minutes later: Blue's three are gone and nobody has moved.
      Date.now = () => original() + 4 * 60_000;
      await room.alarm();
    } finally {
      Date.now = original;
    }

    for (const socket of [blue, red]) {
      expect(socket.drain()).toContainEqual(
        expect.objectContaining({ t: 'result', result: { winner: 'red', reason: 'flag' } }),
      );
    }
    // Nothing left to wake up for.
    expect(state.storage.alarm).toBe(null);
  });

  it('sweeps a match nobody ever joined, and keeps one that was played', async () => {
    const { state, room } = await opened();
    const original = Date.now;
    try {
      Date.now = () => original() + 25 * 60 * 60 * 1000;
      await room.alarm();
    } finally {
      Date.now = original;
    }
    expect(state.storage.size).toBe(0);

    const played = await playing();
    const wasPlayed = Date.now;
    try {
      Date.now = () => wasPlayed() + 25 * 60 * 60 * 1000;
      await played.room.alarm();
    } finally {
      Date.now = wasPlayed;
    }
    expect(played.state.storage.size).toBe(1);
  });
});
