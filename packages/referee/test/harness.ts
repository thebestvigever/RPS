// A room, two sockets and a notepad.
//
// The referee is a reducer, so a "server" for testing purposes is a few lines:
// hold the current room, hand every delivery's messages to the right inboxes,
// and let the test say what time it is. Nothing here is a mock — it is the same
// loop `apps/server` runs, minus the network.

import { getVariant, legalMoves, moveToText } from '@sps/engine';
import type { Side, VariantId } from '@sps/engine';
import type { TimeControl } from '@sps/match';
import { fischer } from '@sps/match';

import type { Delivery, Room, ServerMessage } from '../src/index.js';
import { close, createRoom, open, receive, recipients, wake } from '../src/index.js';

export const TOKENS = { blue: 'blue-token-aaaa', red: 'red-token-bbbb' } as const;

export interface TableOptions {
  variant?: VariantId;
  control?: TimeControl;
  mode?: 'online-casual' | 'rated';
  now?: number;
}

export function table(options: TableOptions = {}) {
  let room: Room = createRoom({
    matchId: 'match-one',
    mode: options.mode ?? 'online-casual',
    variant: getVariant(options.variant ?? 'original'),
    control: options.control ?? fischer(3, 2),
    tokens: { ...TOKENS },
    now: options.now ?? 0,
  });

  const inboxes = new Map<string, ServerMessage[]>();
  const hangups: Array<{ id: string; code: number; reason: string }> = [];

  const inbox = (id: string): ServerMessage[] => {
    const existing = inboxes.get(id);
    if (existing) return existing;
    const fresh: ServerMessage[] = [];
    inboxes.set(id, fresh);
    return fresh;
  };

  function deliver(delivery: Delivery): void {
    room = delivery.room;
    for (const outbound of delivery.out) {
      for (const id of recipients(room, outbound.audience)) {
        inbox(id).push(outbound.message);
      }
    }
    for (const hangup of delivery.close) hangups.push(hangup);
  }

  return {
    get room(): Room {
      return room;
    },
    get hangups() {
      return hangups;
    },
    connect(id: string, now = 0): void {
      room = open(room, id, now);
      inbox(id);
    },
    send(id: string, message: unknown, now = 0): void {
      deliver(receive(room, id, JSON.stringify(message), now));
    },
    /** A frame that never went through JSON.stringify — junk off the wire. */
    sendRaw(id: string, raw: unknown, now = 0): void {
      deliver(receive(room, id, raw, now));
    },
    disconnect(id: string, now = 0): void {
      deliver(close(room, id, now));
    },
    alarm(now: number): void {
      deliver(wake(room, now));
    },
    /** Everything `id` has been sent since the last drain. */
    drain(id: string): ServerMessage[] {
      const messages = inbox(id).slice();
      inboxes.set(id, []);
      return messages;
    },
    seen(id: string): ServerMessage[] {
      return inbox(id).slice();
    },
    /** A legal move for whoever is to move, in the notation the room expects. */
    legal(index = 0): string {
      const moves = legalMoves(room.game);
      const move = moves[index % Math.max(1, moves.length)];
      if (!move) throw new Error('there are no legal moves in this position');
      return moveToText(room.game, move);
    },
  };
}

export type Table = ReturnType<typeof table>;

/** Both players joined and said hello: the usual starting point. */
export function seated(options: TableOptions = {}): Table {
  const t = table(options);
  t.connect('blue-1', 0);
  t.connect('red-1', 0);
  t.send('blue-1', { t: 'hello', matchId: 'match-one', token: TOKENS.blue, lastPly: 0, name: 'Vig' }, 0);
  t.send('red-1', { t: 'hello', matchId: 'match-one', token: TOKENS.red, lastPly: 0, name: 'Ada' }, 0);
  t.drain('blue-1');
  t.drain('red-1');
  return t;
}

/**
 * Play `count` moves alternately from wherever the position is.
 *
 * The choice is spread across the legal list rather than always taking the
 * first move, which would shuffle one piece back and forth and end the game by
 * repetition inside a dozen plies. It is still arithmetic, not randomness — the
 * same sequence every run, as everything else in this repo is.
 */
export function playMoves(t: Table, count: number, from = 0, step = 1000): number {
  let now = from;
  for (let i = 0; i < count; i++) {
    if (t.room.game.result) throw new Error(`the game ended after ${i} of ${count} moves`);
    const side: Side = t.room.game.turn;
    const id = side === 'blue' ? 'blue-1' : 'red-1';
    now += step;
    t.send(id, { t: 'move', ply: t.room.game.ply, move: t.legal(i * 7 + 1) }, now);
  }
  return now;
}

export function only<T extends ServerMessage['t']>(
  messages: ServerMessage[],
  type: T,
): Array<Extract<ServerMessage, { t: T }>> {
  return messages.filter((message): message is Extract<ServerMessage, { t: T }> => message.t === type);
}
