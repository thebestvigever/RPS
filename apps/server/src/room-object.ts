// One Durable Object per match — spec 13.2.
//
// Everything that decides anything lives in `@sps/referee`. This class is the
// four things a referee cannot be pure about:
//
//   1. Sockets. Accepted with WebSocket Hibernation, so a room with two people
//      thinking costs nothing while nobody is typing.
//   2. Storage. The snapshot is written after every change, because a
//      hibernating object's memory is gone when it wakes and the record is the
//      only thing that was ever the truth (spec 8.3).
//   3. Alarms, not timers. A sleeping room still has to notice a flag falling.
//   4. Identity across a nap. Hibernation keeps the sockets and loses the
//      variables, so each socket carries its own seat in its attachment.
//
// Messages are handled one at a time by the platform, which is the property
// the whole design rests on: two moves can never race (spec 13.2).

import type {
  OnlineMode,
  Room,
  RoomSnapshot,
  SeatId,
  ServerMessage,
} from '@sps/referee';
import {
  CLOSE,
  close as closeConnection,
  createRoom,
  gameRecord,
  loadRoom,
  nextWakeAt,
  open,
  receive,
  recipients,
  reopen,
  saveRoom,
  wake,
} from '@sps/referee';
import type { Delivery } from '@sps/referee';
import { getVariant } from '@sps/engine';
import type { Side, VariantId } from '@sps/engine';
import { presetById } from '@sps/match';

export interface Env {
  ROOMS: DurableObjectNamespace;
  /** Where the web app lives, for the links a new match hands back. */
  APP_ORIGIN?: string;
  ALLOWED_ORIGIN?: string;
}

/** What the room writes down. One key: a room is one thing. */
const SNAPSHOT_KEY = 'room';

/**
 * A match nobody ever joined is litter, and it is the only thing here safe to
 * throw away: a match that was PLAYED is a record, and spec 13.5 wants to give
 * it a permanent page. So an unstarted room is swept a day later and a finished
 * one is kept until there is somewhere to archive it to.
 */
const ABANDON_SWEEP_MS = 24 * 60 * 60 * 1000;

interface Attachment {
  id: string;
  seat: SeatId;
  greeted: boolean;
}

export interface InitBody {
  matchId: string;
  mode: OnlineMode;
  variant: VariantId;
  control: string;
  tokens: Record<Side, string>;
}

export class MatchRoom implements DurableObject {
  private room: Room | null = null;

  // `env` is part of the platform's constructor signature and this object has
  // no use for it: everything it needs is in its own storage.
  constructor(
    private readonly ctx: DurableObjectState,
    _env: Env,
  ) {
    // Nothing is served until the room is back in memory, sockets and all.
    void this.ctx.blockConcurrencyWhile(async () => {
      await this.restore();
    });
  }

  private async restore(): Promise<void> {
    const snapshot = await this.ctx.storage.get<RoomSnapshot>(SNAPSHOT_KEY);
    if (!snapshot) return;

    let room = loadRoom(snapshot);
    const now = Date.now();

    // The sockets survived the nap; what the room knew about them did not.
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment | null;
      if (!attachment) continue;
      room = reopen(room, attachment.id, attachment.seat, attachment.greeted, now);
    }

    this.room = room;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/init') return this.init(request);
    if (url.pathname === '/summary') return this.summary();
    if ((request.headers.get('upgrade') ?? '').toLowerCase() === 'websocket') {
      return this.accept();
    }

    return new Response('not found', { status: 404 });
  }

  /** Called by the Worker, and reachable no other way: a stub is not a URL. */
  private async init(request: Request): Promise<Response> {
    if (this.room) {
      return new Response(JSON.stringify({ error: 'that match already exists' }), { status: 409 });
    }

    const body = (await request.json()) as InitBody;
    const room = createRoom({
      matchId: body.matchId,
      mode: body.mode,
      variant: getVariant(body.variant),
      control: presetById(body.control),
      tokens: body.tokens,
      now: Date.now(),
    });

    this.room = room;
    await this.ctx.storage.put(SNAPSHOT_KEY, saveRoom(room));
    await this.ctx.storage.setAlarm(Date.now() + ABANDON_SWEEP_MS);

    return new Response(JSON.stringify({ matchId: body.matchId }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  }

  /** Enough to render a join page without taking a seat. */
  private summary(): Response {
    if (!this.room) return new Response(JSON.stringify({ error: 'no such match' }), { status: 404 });
    const { state } = this.room;

    return new Response(
      JSON.stringify({
        matchId: state.matchId,
        variant: state.variant.id,
        control: { id: state.control.id, name: state.control.name },
        mode: state.mode,
        seatsTaken: {
          blue: state.seats.blue.claimedAt !== null,
          red: state.seats.red.claimedAt !== null,
        },
        names: { blue: state.seats.blue.name, red: state.seats.red.name },
        plies: this.room.game.ply,
        result: this.room.game.result,
        record: this.room.game.result ? gameRecord(this.room) : undefined,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  private accept(): Response {
    if (!this.room) return new Response('no such match', { status: 404 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const id = crypto.randomUUID();

    // Hibernation: the runtime holds the socket, not this object, so the room
    // can be evicted between moves and the connection still be here on the way
    // back. The tag is how a socket is found again by connection id.
    this.ctx.acceptWebSocket(server, [id]);
    server.serializeAttachment({ id, seat: 'spectator', greeted: false } satisfies Attachment);

    this.room = open(this.room, id, Date.now());

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = socket.deserializeAttachment() as Attachment | null;
    if (!attachment || !this.room) {
      socket.close(CLOSE.protocol, 'this socket is not in a room');
      return;
    }

    const now = Date.now();
    await this.apply(receive(this.room, attachment.id, message, now), now);
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as Attachment | null;
    if (!attachment || !this.room) return;

    const now = Date.now();
    await this.apply(closeConnection(this.room, attachment.id, now), now);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  async alarm(): Promise<void> {
    const now = Date.now();

    if (this.shouldSweep(now)) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }

    if (!this.room) return;
    await this.apply(wake(this.room, now), now);
  }

  private shouldSweep(now: number): boolean {
    if (!this.room) return false;
    const { state } = this.room;
    return (
      state.startedAt === null &&
      state.moves.length === 0 &&
      this.ctx.getWebSockets().length === 0 &&
      now - state.createdAt >= ABANDON_SWEEP_MS
    );
  }

  /**
   * Send, hang up, save, and set the next alarm — in that order, and after
   * every single message. Saving after every change is spec 13.2's own
   * instruction, and the reason is not caution: an object that wakes with
   * yesterday's moves would be a referee that forgot the game.
   */
  private async apply(delivery: Delivery, now: number): Promise<void> {
    this.room = delivery.room;

    for (const outbound of delivery.out) {
      const payload = JSON.stringify(outbound.message);
      for (const id of recipients(this.room, outbound.audience)) {
        this.send(id, payload);
      }
    }

    for (const { id, code, reason } of delivery.close) {
      for (const socket of this.ctx.getWebSockets(id)) socket.close(code, reason);
    }

    this.syncAttachments();

    await this.ctx.storage.put(SNAPSHOT_KEY, saveRoom(this.room));
    await this.scheduleNext(now);
  }

  private send(id: string, payload: string): void {
    for (const socket of this.ctx.getWebSockets(id)) {
      try {
        socket.send(payload);
      } catch {
        // A socket that has gone without saying so. `webSocketClose` will
        // follow; there is nothing useful to do about it here.
      }
    }
  }

  /** The seat a socket has just taken has to outlive this object's memory. */
  private syncAttachments(): void {
    if (!this.room) return;

    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment | null;
      if (!attachment) continue;
      const connection = this.room.connections.get(attachment.id);
      if (!connection) continue;
      if (connection.seat === attachment.seat && connection.greeted === attachment.greeted) continue;
      socket.serializeAttachment({
        id: attachment.id,
        seat: connection.seat,
        greeted: connection.greeted,
      } satisfies Attachment);
    }
  }

  private async scheduleNext(now: number): Promise<void> {
    if (!this.room) return;

    const referee = nextWakeAt(this.room, now);
    const sweep = this.room.state.startedAt === null ? this.room.state.createdAt + ABANDON_SWEEP_MS : null;
    const candidates = [referee, sweep].filter((at): at is number => at !== null);

    if (candidates.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    await this.ctx.storage.setAlarm(Math.max(now + 1, Math.min(...candidates)));
  }
}

/** Only used by the tests that check a message is what it says it is. */
export type { ServerMessage };
