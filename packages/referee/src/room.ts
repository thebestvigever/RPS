// The referee — spec 13.2's "one server-authoritative room per match".
//
// Players send the move they want; the room checks it with the same engine
// package the browser runs, applies it, and broadcasts the events to both
// players and any spectators. Nothing a client says is taken on trust: not the
// legality of a move, not whose turn it is, not what the clocks read, not even
// that the game is still going.
//
// It is a reducer, not a server. It owns no socket, opens no storage and never
// asks what time it is — every entry point is handed the connection, the
// message and `now`, and hands back the next room plus the messages to send.
// That is deliberate and it is the same discipline as the engine (spec 7.1)
// and the clock (ADDENDUM-CLOCKS 1): the Durable Object in `apps/server` is
// then a thin shell around this, and everything interesting can be tested in
// milliseconds without a network.
//
// The move list is the source of truth (spec 8.3). The room keeps a `GameState`
// beside it purely as a cache, produced only by `replay` on load or by
// `applyMove` on the way past, so the two can never drift.

import type {
  GameRecord,
  GameResult,
  GameState,
  Side,
  VariantConfig,
} from '@sps/engine';
import {
  abortGame,
  agreeDraw,
  applyMove,
  createGame,
  flag,
  other,
  parseMove,
  replay,
  resign,
} from '@sps/engine';
import type { ClockState, OfferKind, OfferState, TimeControl } from '@sps/match';
import {
  GIFT_MS,
  GIFT_POLICIES,
  OFFER_POLICIES,
  accept,
  canAbort,
  canGive,
  canOffer,
  clockRecord,
  createClock,
  createOffers,
  decline,
  flaggedAt,
  giveTime,
  offer,
  onMove,
  press,
  rewind,
  startTurn,
  stop,
  tick,
  withdraw,
} from '@sps/match';

import type { Bucket } from './limiter.js';
import { charge, createBucket } from './limiter.js';
import type { AwaySince } from './presence.js';
import { canClaimAway, claimableAt, presenceView } from './presence.js';
import type {
  ClientMessage,
  ErrorCode,
  SeatId,
  ServerMessage,
} from './protocol.js';
import { parseClientMessage } from './protocol.js';
import type { Seats } from './seats.js';
import { bothClaimed, claim, createSeats, seatFor } from './seats.js';
import { clocksView, flagDeadline } from './timing.js';

/** The two modes a room can run. `packages/match` knows two more, both on-device. */
export type OnlineMode = 'online-casual' | 'rated';

export interface Connection {
  id: string;
  seat: SeatId;
  /** False until `hello`; nothing else is answered before it. */
  greeted: boolean;
  bucket: Bucket;
  openedAt: number;
}

/** Everything about a match that has to survive the room falling asleep. */
export interface RoomState {
  matchId: string;
  mode: OnlineMode;
  variant: VariantConfig;
  control: TimeControl;
  seats: Seats;
  /** The source of truth. Everything else here is either about it or beside it. */
  moves: string[];
  createdAt: number;
  /** When both seats were taken and the clock started, or null. */
  startedAt: number | null;
  away: AwaySince;
  offers: OfferState;
  /** `clocks[n]` is the clock with n moves played, so it is one longer than `moves`. */
  clocks: ClockState[];
}

export interface Room {
  state: RoomState;
  /** Derived from `state.moves`; never edited in place. */
  game: GameState;
  /** Live, and never persisted: on waking, the shell re-registers its sockets. */
  connections: Map<string, Connection>;
}

export type Audience =
  | { to: 'all' }
  | { to: 'connection'; id: string }
  | { to: 'others'; id: string };

export interface Outbound {
  audience: Audience;
  message: ServerMessage;
}

/** Application close codes (4000–4999 are ours to define). */
export const CLOSE = {
  /** A token this match never issued, or a `hello` for another match. */
  badToken: 4001,
  /** The same token turned up on a newer connection; this one is the stale half. */
  superseded: 4002,
  /** Something a client cannot recover from by trying again. */
  protocol: 4003,
} as const;

export interface Delivery {
  room: Room;
  out: Outbound[];
  close: Array<{ id: string; code: number; reason: string }>;
}

const all = (message: ServerMessage): Outbound => ({ audience: { to: 'all' }, message });
const to = (id: string, message: ServerMessage): Outbound => ({
  audience: { to: 'connection', id },
  message,
});
const others = (id: string, message: ServerMessage): Outbound => ({
  audience: { to: 'others', id },
  message,
});

const quiet = (room: Room): Delivery => ({ room, out: [], close: [] });

/**
 * Which connections an `Outbound` is for. The shell owns the sockets, so it
 * has to resolve this — and so does every test, which is why it lives here
 * rather than being written out twice and drifting.
 *
 * A broadcast reaches only connections that have said hello. A socket that has
 * not identified itself is not yet in the audience of anything.
 */
export function recipients(room: Room, audience: Audience): string[] {
  if (audience.to === 'connection') {
    return room.connections.has(audience.id) ? [audience.id] : [];
  }
  const greeted = [...room.connections.values()].filter((connection) => connection.greeted);
  const ids = greeted.map((connection) => connection.id);
  return audience.to === 'all' ? ids : ids.filter((id) => id !== audience.id);
}

const errorOut = (id: string, code: ErrorCode, reason: string): Outbound =>
  to(id, { t: 'error', code, reason });

/** The clock as it stands: the last snapshot, one per move plus the start. */
export function liveClock(state: RoomState): ClockState {
  const clock = state.clocks[state.clocks.length - 1];
  if (!clock) throw new Error('a room always has at least its starting clock');
  return clock;
}

function replaceClock(state: RoomState, clock: ClockState): RoomState {
  const clocks = state.clocks.slice(0, -1);
  clocks.push(clock);
  return { ...state, clocks };
}

function pushClock(state: RoomState, clock: ClockState): RoomState {
  return { ...state, clocks: [...state.clocks, clock] };
}

export interface RoomOptions {
  matchId: string;
  mode: OnlineMode;
  variant: VariantConfig;
  control: TimeControl;
  /** Generated by the caller: this package has no randomness of its own. */
  tokens: Record<Side, string>;
  now: number;
}

export function createRoom(options: RoomOptions): Room {
  const state: RoomState = {
    matchId: options.matchId,
    mode: options.mode,
    variant: options.variant,
    control: options.control,
    seats: createSeats(options.tokens),
    moves: [],
    createdAt: options.now,
    startedAt: null,
    // Nobody has connected, so both sides are away and the sixty-second clock
    // is already running on each. A match nobody opens goes stale by itself.
    away: { blue: options.now, red: options.now },
    offers: createOffers(OFFER_POLICIES[options.mode]),
    clocks: [createClock(options.control)],
  };

  return { state, game: createGame(options.variant), connections: new Map() };
}

/**
 * Rebuild the live room from persisted state. `result` is passed separately
 * because a game that ended by resignation, agreement, the clock or an abort
 * is not implied by its moves — `replay` cannot know about any of them.
 */
export function restoreRoom(state: RoomState, result: GameResult | null): Room {
  const { state: replayed } = replay(state.variant, state.moves);
  const game = replayed.result || !result ? replayed : { ...replayed, result };
  return { state, game, connections: new Map() };
}

/** Spec 8.3's record: what a client is welcomed with and what an archive keeps. */
export function gameRecord(room: Room): GameRecord {
  const { state, game } = room;
  const clock = clockRecord(state.clocks);

  return {
    game: 'stone-paper-scissors',
    rulesVersion: 1,
    variant: state.variant.id,
    start: state.variant.start,
    players: {
      blue: state.seats.blue.name ?? 'anonymous',
      red: state.seats.red.name ?? 'anonymous',
    },
    moves: [...state.moves],
    result: game.result,
    ...(state.startedAt === null
      ? {}
      : { startedAt: new Date(state.startedAt).toISOString() }),
    ...(clock ? { clock } : {}),
  };
}

/**
 * When the room next needs waking, or null if it can sleep until somebody
 * speaks. Two things happen on their own: a clock falls, and a player becomes
 * claimable after sixty seconds away (spec 13.2).
 *
 * The second is not a result — the room only wakes so it can tell the player
 * who stayed that the button is now live.
 */
export function nextWakeAt(room: Room, now: number): number | null {
  if (room.game.result) return null;

  const deadlines: number[] = [];
  // `now` is a parameter for the same reason it is everywhere else here, and
  // for one that bites: the deadline is invariant in `now` only from the
  // current turn's start onwards. Handing this the time the GAME started would
  // be right for the first move and quietly early for every move after it.
  const flagAt = flagDeadline(liveClock(room.state), now);
  if (flagAt !== null) deadlines.push(flagAt);

  if (room.state.mode === 'online-casual') {
    for (const side of ['blue', 'red'] as const) {
      const at = claimableAt(room.state.away, side);
      if (at !== null) deadlines.push(at);
    }
  }

  return deadlines.length === 0 ? null : Math.min(...deadlines);
}

/** A new socket, before it has said anything. Spectator until a `hello` says otherwise. */
export function open(room: Room, id: string, now: number): Room {
  const connections = new Map(room.connections);
  connections.set(id, { id, seat: 'spectator', greeted: false, bucket: createBucket(now), openedAt: now });
  return { ...room, connections };
}

/**
 * Re-register a socket that outlived the room's memory.
 *
 * A hibernating Durable Object loses everything it was holding, but not its
 * sockets — so on waking it has to say who each one was. The seat comes back
 * from what the shell stored on the socket itself; the rate limiter's bucket
 * does not, and starts full, which is the forgiving way round.
 */
export function reopen(room: Room, id: string, seat: SeatId, greeted: boolean, now: number): Room {
  const connections = new Map(room.connections);
  connections.set(id, { id, seat, greeted, bucket: createBucket(now), openedAt: now });
  return { ...room, connections };
}

function seatedConnections(room: Room, side: Side): Connection[] {
  return [...room.connections.values()].filter(
    (connection) => connection.greeted && connection.seat === side,
  );
}

/** A socket went away. The clock keeps running — see `presence.ts`. */
export function close(room: Room, id: string, now: number): Delivery {
  const connection = room.connections.get(id);
  if (!connection) return quiet(room);

  const connections = new Map(room.connections);
  connections.delete(id);
  let next: Room = { ...room, connections };

  if (connection.seat === 'spectator' || !connection.greeted) return quiet(next);

  const side = connection.seat;
  if (seatedConnections(next, side).length > 0) return quiet(next);

  const away: AwaySince = { ...next.state.away, [side]: now };
  next = { ...next, state: { ...next.state, away } };

  return { room: next, out: [all({ t: 'presence', ...presenceView(away) })], close: [] };
}

// ---------------------------------------------------------------------------
// Endings
// ---------------------------------------------------------------------------

/**
 * Stop the clock and announce the result. Used for every ending that is not a
 * move: resignation, agreement, the clock falling, an abort, a claim.
 */
function settle(room: Room, game: GameState, now: number): Delivery {
  const stopped = stop(liveClock(room.state), now);
  // A pending offer dies with the game. Leaving one standing would let a draw
  // offered before a resignation be "accepted" afterwards — and accepting a
  // takeback would try to un-end a finished game.
  const state = {
    ...replaceClock(room.state, stopped),
    offers: { ...room.state.offers, pending: null },
  };
  const next: Room = { ...room, state, game };
  const result = game.result;
  if (!result) throw new Error('settle needs a finished game');

  return {
    room: next,
    out: [all({ t: 'result', result, clocks: clocksView(stopped, now) })],
    close: [],
  };
}

/**
 * Has the running clock fallen? Checked before anything a player asks for, so
 * a move that arrives after the flag loses to the flag — the server's receipt
 * time is the only honest timestamp in the system.
 */
function enforceFlag(room: Room, now: number): Delivery | null {
  if (room.game.result || room.state.startedAt === null) return null;

  const clock = liveClock(room.state);
  const fallen = flaggedAt(clock, now);
  if (!fallen) return null;

  const ticked = tick(clock, now);
  const state = {
    ...replaceClock(room.state, ticked),
    offers: { ...room.state.offers, pending: null },
  };
  const game = flag(room.game, fallen);
  const result = game.result;
  if (!result) throw new Error('flag always sets a result');

  return {
    room: { ...room, state, game },
    out: [all({ t: 'result', result, clocks: clocksView(ticked, now) })],
    close: [],
  };
}

/**
 * The alarm. Nothing here is driven by a message: a clock falls whether or not
 * anyone is watching, which is exactly why the server owns it.
 */
export function wake(room: Room, now: number): Delivery {
  return enforceFlag(room, now) ?? quiet(room);
}

// ---------------------------------------------------------------------------
// Catching up
// ---------------------------------------------------------------------------

/**
 * The `moved` messages a client is missing, replayed from the move list.
 *
 * The interface animates and announces from events, never by diffing boards
 * (CLAUDE.md), so a reconnecting client needs the events it slept through and
 * not just the moves. They come from `replay`, which is the same function that
 * produced them the first time.
 *
 * The clocks are historical: what each move left behind. `ClocksView.serverTime`
 * is what tells them apart from the live reading in the welcome.
 */
function catchUp(room: Room, from: number, now: number): ServerMessage[] {
  const { state } = room;
  const start = Math.max(0, Math.min(from, state.moves.length));
  if (start >= state.moves.length) return [];

  const { events } = replay(state.variant, state.moves);
  const messages: ServerMessage[] = [];

  for (let ply = start; ply < state.moves.length; ply++) {
    const clock = state.clocks[ply + 1];
    const at = clock?.since ?? now;
    messages.push({
      t: 'moved',
      ply: ply + 1,
      move: state.moves[ply]!,
      events: events[ply] ?? [],
      clocks: clock ? clocksView(clock, at) : clocksView(liveClock(state), now),
    });
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** The one door in. Raw frames only — `receive` does the parsing itself. */
export function receive(room: Room, id: string, raw: unknown, now: number): Delivery {
  const connection = room.connections.get(id);
  if (!connection) return quiet(room);

  const charged = charge(connection.bucket, now);
  const withBucket = (bucket: Bucket, next: Room = room): Room => {
    const connections = new Map(next.connections);
    const current = connections.get(id);
    if (current) connections.set(id, { ...current, bucket });
    return { ...next, connections };
  };

  if (!charged.ok) {
    const limited = withBucket(charged.bucket);
    return charged.warn
      ? {
          room: limited,
          out: [errorOut(id, 'rate-limited', 'too many messages — slow down')],
          close: [],
        }
      : quiet(limited);
  }

  const parsed = parseClientMessage(raw);
  const room1 = withBucket(charged.bucket);
  if (!parsed.ok) {
    return { room: room1, out: [errorOut(id, 'bad-message', parsed.reason)], close: [] };
  }

  const message = parsed.message;
  const seen = room1.connections.get(id)!;

  if (message.t === 'hello') return hello(room1, seen, message, now);

  if (!seen.greeted) {
    return {
      room: room1,
      out: [errorOut(id, 'hello-required', 'say hello first')],
      close: [{ id, code: CLOSE.protocol, reason: 'hello required' }],
    };
  }

  if (message.t === 'ping') {
    return {
      room: room1,
      out: [to(id, { t: 'pong', serverTime: now, at: message.at })],
      close: [],
    };
  }

  // Everything below is a player's to do, and a clock that has already fallen
  // decides the game before any of it.
  const flagged = enforceFlag(room1, now);
  if (flagged) return flagged;

  if (seen.seat === 'spectator') {
    return {
      room: room1,
      out: [errorOut(id, 'spectator', 'you are watching this game, not playing it')],
      close: [],
    };
  }

  const side = seen.seat;

  switch (message.t) {
    case 'move':
      return play(room1, id, side, message.ply, message.move, now);
    case 'resign':
      return end(room1, id, (game) => resign(game, side), now);
    case 'abort':
      return abort(room1, id, now);
    case 'claim':
      return claimWin(room1, id, side, now);
    case 'gift':
      return gift(room1, id, side, now);
    case 'draw-offer':
      return makeOffer(room1, id, side, 'draw', now);
    case 'draw-accept':
      return acceptOffer(room1, id, side, 'draw', now);
    case 'draw-decline':
      return answerOffer(room1, id, side, 'draw', 'decline');
    case 'draw-withdraw':
      return answerOffer(room1, id, side, 'draw', 'withdraw');
    case 'takeback-offer':
      return makeOffer(room1, id, side, 'takeback', now);
    case 'takeback-accept':
      return acceptOffer(room1, id, side, 'takeback', now);
    case 'takeback-decline':
      return answerOffer(room1, id, side, 'takeback', 'decline');
    case 'takeback-withdraw':
      return answerOffer(room1, id, side, 'takeback', 'withdraw');
    default:
      return { room: room1, out: [errorOut(id, 'bad-message', 'unknown message')], close: [] };
  }
}

function welcomeFor(room: Room, seat: SeatId, now: number): ServerMessage {
  const { state } = room;
  const pending = state.offers.pending;

  return {
    t: 'welcome',
    matchId: state.matchId,
    you: seat,
    record: gameRecord(room),
    clocks: clocksView(liveClock(state), now),
    presence: presenceView(state.away),
    offer:
      pending && pending.kind !== 'rematch'
        ? { kind: pending.kind as 'draw' | 'takeback', by: pending.by }
        : null,
    names: { blue: state.seats.blue.name, red: state.seats.red.name },
    mode: state.mode,
  };
}

function hello(
  room: Room,
  connection: Connection,
  message: Extract<ClientMessage, { t: 'hello' }>,
  now: number,
): Delivery {
  const id = connection.id;

  if (connection.greeted) {
    return { room, out: [errorOut(id, 'already-said-hello', 'you are already here')], close: [] };
  }

  if (message.matchId !== room.state.matchId) {
    return {
      room,
      out: [errorOut(id, 'wrong-match', 'this room is a different match')],
      close: [{ id, code: CLOSE.badToken, reason: 'wrong match' }],
    };
  }

  const side = seatFor(room.state.seats, message.token);

  // A token this match never issued is refused rather than quietly demoted to
  // a spectator: a stale or mistyped link should say so, not seat somebody in
  // the audience of their own game.
  if (message.token !== null && side === null) {
    return {
      room,
      out: [errorOut(id, 'bad-token', 'that link does not open a seat in this match')],
      close: [{ id, code: CLOSE.badToken, reason: 'unknown token' }],
    };
  }

  const seat: SeatId = side ?? 'spectator';
  const connections = new Map(room.connections);
  connections.set(id, { ...connection, seat, greeted: true });

  const close: Delivery['close'] = [];
  let state = room.state;
  const out: Outbound[] = [];

  if (side !== null) {
    // The same token on a second socket is the same player coming back — a
    // phone that slept, a tab reopened, a connection that died without
    // closing. The older half is hung up rather than left to receive a game
    // it is no longer part of.
    for (const stale of seatedConnections(room, side)) {
      connections.delete(stale.id);
      close.push({ id: stale.id, code: CLOSE.superseded, reason: 'reconnected elsewhere' });
    }

    state = {
      ...state,
      seats: claim(state.seats, side, message.name, now),
      away: { ...state.away, [side]: null },
    };
  }

  let next: Room = { ...room, state, connections };

  // Both seats taken: the game begins and the first clock starts. Until then
  // nothing ticks — a match waiting for its second player is not yet a game.
  const starting = bothClaimed(state.seats) && state.startedAt === null && !next.game.result;
  if (starting) {
    const started = startTurn(liveClock(state), next.game.turn, now);
    next = {
      ...next,
      state: { ...replaceClock(next.state, started), startedAt: now },
    };
  }

  out.push(to(id, welcomeFor(next, seat, now)));
  for (const caught of catchUp(next, message.lastPly, now)) out.push(to(id, caught));

  if (side !== null) {
    out.push(others(id, { t: 'presence', ...presenceView(next.state.away) }));
  }
  if (starting) {
    out.push(others(id, { t: 'started', clocks: clocksView(liveClock(next.state), now) }));
  }

  return { room: next, out, close };
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

function rejected(room: Room, id: string, ply: number, reason: string): Delivery {
  return { room, out: [to(id, { t: 'rejected', ply, reason })], close: [] };
}

function play(
  room: Room,
  id: string,
  side: Side,
  ply: number,
  text: string,
  now: number,
): Delivery {
  const { state, game } = room;

  if (game.result) return rejected(room, id, ply, 'the game is over');
  if (state.startedAt === null) return rejected(room, id, ply, 'the game has not started');

  // Idempotency, spec 13.2: a move carries the ply it is meant for, and the
  // room rejects stale or duplicate plies. A client that resends after a
  // flaky moment gets its answer back rather than a second move on the board,
  // and gets the plies it missed while it was gone.
  if (ply !== game.ply) {
    const out: Outbound[] = [
      to(id, {
        t: 'rejected',
        ply,
        reason: ply < game.ply ? 'that ply has already been played' : 'that ply has not been reached',
      }),
    ];
    for (const caught of catchUp(room, ply, now)) out.push(to(id, caught));
    return { room, out, close: [] };
  }

  if (game.turn !== side) return rejected(room, id, ply, 'it is not your turn');

  let applied;
  try {
    const move = parseMove(game, text);
    applied = applyMove(game, move);
  } catch (error) {
    return rejected(room, id, ply, error instanceof Error ? error.message : 'illegal move');
  }

  // A move answers a pending offer: you played on, so you declined (or, if it
  // was yours, you thought better of it).
  const pending = state.offers.pending;
  const offers = onMove(state.offers);
  const out: Outbound[] = [];
  if (pending && pending.kind !== 'rematch') {
    out.push(
      all(
        pending.by === side
          ? ({ t: `${pending.kind}-withdrawn`, by: side } as ServerMessage)
          : ({ t: `${pending.kind}-declined`, by: side } as ServerMessage),
      ),
    );
  }

  const pressed = press(liveClock(state), now);
  const finished = applied.state.result !== null;
  const clock = finished ? stop(pressed, now) : pressed;

  const nextState: RoomState = {
    ...pushClock(state, clock),
    moves: [...state.moves, text],
    offers,
  };
  const next: Room = { ...room, state: nextState, game: applied.state };

  out.unshift(
    all({
      t: 'moved',
      ply: applied.state.ply,
      move: text,
      events: applied.events,
      clocks: clocksView(clock, now),
    }),
  );

  if (applied.state.result) {
    out.push(all({ t: 'result', result: applied.state.result, clocks: clocksView(clock, now) }));
  }

  return { room: next, out, close: [] };
}

// ---------------------------------------------------------------------------
// Everything that ends a game without a move
// ---------------------------------------------------------------------------

function end(
  room: Room,
  id: string,
  ending: (game: GameState) => GameState,
  now: number,
): Delivery {
  if (room.game.result) {
    return { room, out: [errorOut(id, 'not-allowed', 'the game is over')], close: [] };
  }
  return settle(room, ending(room.game), now);
}

function abort(room: Room, id: string, now: number): Delivery {
  const permission = canAbort(room.game.ply, room.state.mode);
  if (!permission.ok) {
    return { room, out: [errorOut(id, 'not-allowed', permission.reason)], close: [] };
  }
  if (room.game.result) {
    return { room, out: [errorOut(id, 'not-allowed', 'the game is over')], close: [] };
  }
  return settle(room, abortGame(room.game), now);
}

/**
 * Claim the win against someone who has been away sixty seconds (spec 13.2).
 *
 * OPEN, for Vig: this records `resign` for the player who left, because that
 * is the nearest thing the result vocabulary has (spec 7.2, ADDENDUM-CLOCKS 2)
 * and inventing a reason code is a change to what a finished game says about
 * itself — user-facing, and so his call, not a guess made here. An `abandoned`
 * reason would be the honest word; the addendum's own precedent is that a
 * reader treats an unknown reason as "finished, cause unknown", so adding one
 * later costs a line in this function.
 */
function claimWin(room: Room, id: string, side: Side, now: number): Delivery {
  if (room.game.result) {
    return { room, out: [errorOut(id, 'not-allowed', 'the game is over')], close: [] };
  }
  if (room.state.mode !== 'online-casual') {
    return {
      room,
      out: [errorOut(id, 'not-allowed', 'a rated game is decided by the clock, not by claiming')],
      close: [],
    };
  }
  if (room.state.startedAt === null) {
    return { room, out: [errorOut(id, 'not-allowed', 'the game has not started')], close: [] };
  }
  if (!canClaimAway(room.state.away, other(side), now)) {
    return {
      room,
      out: [errorOut(id, 'not-allowed', 'your opponent has not been away long enough')],
      close: [],
    };
  }

  return settle(room, resign(room.game, other(side)), now);
}

// ---------------------------------------------------------------------------
// Time gifts
// ---------------------------------------------------------------------------

function gift(room: Room, id: string, side: Side, now: number): Delivery {
  const recipient = other(side);
  const permission = canGive(GIFT_POLICIES[room.state.mode], side, recipient);
  if (!permission.ok) {
    return { room, out: [errorOut(id, 'not-allowed', permission.reason)], close: [] };
  }
  if (room.game.result || room.state.startedAt === null) {
    return { room, out: [errorOut(id, 'not-allowed', 'the game is not running')], close: [] };
  }
  if (room.state.control.unlimited) {
    return {
      room,
      out: [errorOut(id, 'not-allowed', 'there is no clock to add to')],
      close: [],
    };
  }

  const clock = giveTime(liveClock(room.state), {
    ply: room.game.ply,
    from: side,
    to: recipient,
    ms: GIFT_MS,
  });
  const next: Room = { ...room, state: replaceClock(room.state, clock) };

  return {
    room: next,
    out: [
      all({
        t: 'gifted',
        from: side,
        to: recipient,
        ms: GIFT_MS,
        clocks: clocksView(clock, now),
      }),
    ],
    close: [],
  };
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

function offerMessage(
  kind: 'draw' | 'takeback',
  event: 'offered' | 'declined' | 'withdrawn',
  by: Side,
): ServerMessage {
  return { t: `${kind}-${event}`, by } as ServerMessage;
}

function makeOffer(
  room: Room,
  id: string,
  side: Side,
  kind: 'draw' | 'takeback',
  now: number,
): Delivery {
  if (room.game.result) {
    return { room, out: [errorOut(id, 'not-allowed', 'the game is over')], close: [] };
  }
  if (kind === 'takeback' && room.game.ply === 0) {
    return { room, out: [errorOut(id, 'not-allowed', 'there is nothing to take back')], close: [] };
  }

  const permission = canOffer(room.state.offers, kind, side, room.game.ply);
  if (!permission.ok) {
    return { room, out: [errorOut(id, 'not-allowed', permission.reason)], close: [] };
  }

  const outcome = offer(room.state.offers, kind, side, room.game.ply);
  const next: Room = { ...room, state: { ...room.state, offers: outcome.state } };

  // Offering into the opponent's identical offer accepts it there and then
  // (ADDENDUM-CLOCKS 7) — two people pressing "draw" at once must not leave
  // two offers standing.
  if (outcome.accepted) return settleOffer(next, outcome.accepted.kind, outcome.accepted.by, now);

  return { room: next, out: [all(offerMessage(kind, 'offered', side))], close: [] };
}

function acceptOffer(
  room: Room,
  id: string,
  side: Side,
  kind: 'draw' | 'takeback',
  now: number,
): Delivery {
  const pending = room.state.offers.pending;
  if (room.game.result) {
    return { room, out: [errorOut(id, 'not-allowed', 'the game is over')], close: [] };
  }
  if (!pending || pending.kind !== kind) {
    return { room, out: [errorOut(id, 'not-allowed', `there is no ${kind} offer`)], close: [] };
  }

  let outcome;
  try {
    outcome = accept(room.state.offers, side);
  } catch (error) {
    return {
      room,
      out: [errorOut(id, 'not-allowed', error instanceof Error ? error.message : 'no')],
      close: [],
    };
  }

  const next: Room = { ...room, state: { ...room.state, offers: outcome.state } };
  return settleOffer(next, kind, pending.by, now);
}

function answerOffer(
  room: Room,
  id: string,
  side: Side,
  kind: 'draw' | 'takeback',
  how: 'decline' | 'withdraw',
): Delivery {
  const pending = room.state.offers.pending;
  if (!pending || pending.kind !== kind) {
    return { room, out: [errorOut(id, 'not-allowed', `there is no ${kind} offer`)], close: [] };
  }

  let offers: OfferState;
  try {
    offers = how === 'decline' ? decline(room.state.offers, side) : withdraw(room.state.offers, side);
  } catch (error) {
    return {
      room,
      out: [errorOut(id, 'not-allowed', error instanceof Error ? error.message : 'no')],
      close: [],
    };
  }

  const next: Room = { ...room, state: { ...room.state, offers } };
  return {
    room: next,
    out: [all(offerMessage(kind, how === 'decline' ? 'declined' : 'withdrawn', side))],
    close: [],
  };
}

function settleOffer(room: Room, kind: OfferKind, by: Side, now: number): Delivery {
  if (kind === 'draw') return settle(room, agreeDraw(room.game), now);
  if (kind === 'takeback') return takeBack(room, by, now);
  return quiet(room);
}

/**
 * Unmake the asking side's last move.
 *
 * The move list being the source of truth (spec 8.3) is what makes this three
 * lines rather than an undo stack: cut the list, replay it, and the position,
 * the turn and the repetition counts are all right by construction. The clock
 * comes back from the snapshot the record kept for exactly this (`rewind`),
 * re-anchored to now — a takeback must not hand back the time the opponent
 * spent thinking about the move that is being taken away.
 */
function takeBack(room: Room, by: Side, now: number): Delivery {
  const { state, game } = room;
  // One ply if the asker has just moved, two if the opponent has replied.
  const back = game.turn === by ? 2 : 1;
  const target = Math.max(0, game.ply - back);

  const moves = state.moves.slice(0, target);
  const { state: rewound } = replay(state.variant, moves);
  const clocks = state.clocks.slice(0, target + 1);
  const restored = startTurn(rewind(clocks, target), rewound.turn, now);
  clocks[target] = restored;

  const next: Room = {
    ...room,
    state: { ...state, moves, clocks },
    game: rewound,
  };

  return {
    room: next,
    out: [all({ t: 'took-back', ply: target, clocks: clocksView(restored, now) })],
    close: [],
  };
}
