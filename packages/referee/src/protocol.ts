// The wire protocol — spec 13.2.
//
// Everything a client sends is UNTRUSTED (spec 13.7: "the server validates
// every move; clients are never trusted"). So nothing here takes the shape of
// an incoming message on faith: `parseClientMessage` is the only door in, it
// works on `unknown`, and it returns a reason rather than throwing, because a
// malformed message is an ordinary event on a public socket and not an
// exceptional one.
//
// Spec 13.2 listed the messages; this adds the ones the clock addendum made
// real after that list was written (abort, time gifts, takebacks, withdrawing
// an offer) and one the spec's own prose asked for without naming — `claim`,
// for "the opponent may claim the win after 60 seconds away". Additions are
// marked. The spec's names are kept exactly where it gave one, so a client
// written from 13.2 alone still speaks this.

import type { GameEvent, GameRecord, GameResult, Side } from '@sps/engine';

/** Who a connection is. Spec 13.2's `welcome.you`. */
export type SeatId = Side | 'spectator';

export type OfferKindWire = 'draw' | 'takeback';

/** A player's presence, as broadcast. Spec 13.2's `presence`. */
export type PresenceFlag = 'online' | 'away';

/**
 * What the clocks read, from the server's point of view. `serverTime` is what
 * lets a client display server time adjusted for latency (spec 13.2) rather
 * than trusting its own idea of when this message left.
 *
 * An unlimited control reports `null` rather than `Infinity`: this crosses
 * JSON, which turns Infinity into null anyway, and a type that admits it is
 * better than one that lies.
 *
 * Every view carries its own `serverTime`, which is also how a client tells a
 * live reading from a historical one. Catching up after a reconnect delivers
 * the clocks as they stood after each missed move — those are the right
 * numbers for a move list and the wrong ones for the face of a clock, and the
 * rule that sorts them out is simply: display the view with the newest
 * `serverTime`.
 */
export interface ClocksView {
  blue: number | null;
  red: number | null;
  running: Side | null;
  serverTime: number;
}

export interface PresenceView {
  blue: PresenceFlag;
  red: PresenceFlag;
}

export type ClientMessage =
  /** Always first. `lastPly` is what the client already has, so a reconnect gets only the rest. */
  | { t: 'hello'; matchId: string; token: string | null; lastPly: number; name: string | null }
  /** `ply` is the ply this move is meant to be — the whole of the idempotency story. */
  | { t: 'move'; ply: number; move: string }
  | { t: 'resign' }
  | { t: 'ping'; at: number | null }
  | { t: 'draw-offer' }
  | { t: 'draw-accept' }
  | { t: 'draw-decline' }
  // Added since spec 13.2's list:
  | { t: 'draw-withdraw' }
  | { t: 'takeback-offer' }
  | { t: 'takeback-accept' }
  | { t: 'takeback-decline' }
  | { t: 'takeback-withdraw' }
  /** Addendum 9: allowed in the first two plies, then "resign instead". */
  | { t: 'abort' }
  /** Addendum 6: 15 seconds to the opponent, casual only. */
  | { t: 'gift' }
  /** Spec 13.2's "claim the win after 60 seconds away", which its list had no message for. */
  | { t: 'claim' };

export type ErrorCode =
  | 'bad-message'
  | 'bad-token'
  | 'wrong-match'
  | 'hello-required'
  | 'already-said-hello'
  | 'seat-taken'
  | 'spectator'
  | 'not-allowed'
  | 'rate-limited';

export type ServerMessage =
  | {
      t: 'welcome';
      matchId: string;
      you: SeatId;
      /** The whole game so far. The move list is the source of truth (spec 8.3). */
      record: GameRecord;
      clocks: ClocksView;
      presence: PresenceView;
      /** A pending offer survives a reconnect, so it has to be in the welcome. */
      offer: { kind: OfferKindWire; by: Side } | null;
      names: Record<Side, string | null>;
      /** Which offers and gestures this match allows (spec 13.2 casual vs rated). */
      mode: string;
    }
  /** Both seats are taken and the first clock is running. Added: 13.2 had no "the game began". */
  | { t: 'started'; clocks: ClocksView }
  | { t: 'moved'; ply: number; move: string; events: GameEvent[]; clocks: ClocksView }
  | { t: 'rejected'; ply: number; reason: string }
  | { t: 'result'; result: GameResult; clocks: ClocksView }
  | { t: 'presence'; blue: PresenceFlag; red: PresenceFlag }
  | { t: 'draw-offered'; by: Side }
  | { t: 'draw-declined'; by: Side }
  | { t: 'draw-withdrawn'; by: Side }
  | { t: 'takeback-offered'; by: Side }
  | { t: 'takeback-declined'; by: Side }
  | { t: 'takeback-withdrawn'; by: Side }
  /** A takeback was agreed: the game is now `ply` plies long. */
  | { t: 'took-back'; ply: number; clocks: ClocksView }
  | { t: 'gifted'; from: Side; to: Side; ms: number; clocks: ClocksView }
  | { t: 'pong'; serverTime: number; at: number | null }
  | { t: 'error'; code: ErrorCode; reason: string };

/**
 * A ceiling on an incoming frame, before any parsing. A move message is about
 * 40 bytes and the largest legitimate one is a `hello` carrying a name; this
 * leaves room for both and refuses to hand a megabyte of anything to JSON.
 */
export const MAX_MESSAGE_BYTES = 1024;

export const MAX_NAME_LENGTH = 40;

/** Move text is `[n]<Type><from><sep><to>[#]` (spec 8.1) — eight characters at most. */
const MAX_MOVE_LENGTH = 16;

const MAX_MATCH_ID_LENGTH = 64;
const MAX_TOKEN_LENGTH = 128;

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; reason: string };

function bad(reason: string): ParseResult {
  return { ok: false, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(
  body: Record<string, unknown>,
  field: string,
  max: number,
): { ok: true; value: string } | { ok: false; reason: string } {
  const value = body[field];
  if (typeof value !== 'string') return { ok: false, reason: `${field} must be a string` };
  if (value.length > max) return { ok: false, reason: `${field} is too long` };
  return { ok: true, value };
}

/** Optional, and an empty string counts as absent — a client with no token sends "". */
function readOptionalString(
  body: Record<string, unknown>,
  field: string,
  max: number,
): { ok: true; value: string | null } | { ok: false; reason: string } {
  const value = body[field];
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, reason: `${field} must be a string` };
  if (value.length > max) return { ok: false, reason: `${field} is too long` };
  return { ok: true, value };
}

function readPly(
  body: Record<string, unknown>,
  field: string,
): { ok: true; value: number } | { ok: false; reason: string } {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { ok: false, reason: `${field} must be a whole number` };
  }
  // The upper bound is the variant's own move limit (spec 2.9); anything past
  // it cannot name a real ply, whatever variant this room is running.
  if (value < 0 || value > 1000) return { ok: false, reason: `${field} is out of range` };
  return { ok: true, value };
}

/** Messages that carry nothing but their name. */
const BARE_TYPES = new Set([
  'resign',
  'draw-offer',
  'draw-accept',
  'draw-decline',
  'draw-withdraw',
  'takeback-offer',
  'takeback-accept',
  'takeback-decline',
  'takeback-withdraw',
  'abort',
  'gift',
  'claim',
]);

/**
 * The only door in. Takes the raw frame — a string off the socket, or anything
 * at all — and either hands back a message this room understands or says why
 * not. It never throws.
 */
export function parseClientMessage(raw: unknown): ParseResult {
  let body: unknown = raw;

  if (typeof raw === 'string') {
    if (raw.length > MAX_MESSAGE_BYTES) return bad('message too large');
    try {
      body = JSON.parse(raw);
    } catch {
      return bad('not JSON');
    }
  }

  if (!isRecord(body)) return bad('a message must be a JSON object');
  const t = body['t'];
  if (typeof t !== 'string') return bad('a message needs a `t`');

  if (t === 'hello') {
    const matchId = readString(body, 'matchId', MAX_MATCH_ID_LENGTH);
    if (!matchId.ok) return bad(matchId.reason);
    const token = readOptionalString(body, 'token', MAX_TOKEN_LENGTH);
    if (!token.ok) return bad(token.reason);
    const name = readOptionalString(body, 'name', MAX_NAME_LENGTH);
    if (!name.ok) return bad(name.reason);
    const lastPly = readPly(body, 'lastPly');
    if (!lastPly.ok) return bad(lastPly.reason);
    return {
      ok: true,
      message: {
        t: 'hello',
        matchId: matchId.value,
        token: token.value,
        lastPly: lastPly.value,
        name: name.value,
      },
    };
  }

  if (t === 'move') {
    const ply = readPly(body, 'ply');
    if (!ply.ok) return bad(ply.reason);
    const move = readString(body, 'move', MAX_MOVE_LENGTH);
    if (!move.ok) return bad(move.reason);
    return { ok: true, message: { t: 'move', ply: ply.value, move: move.value } };
  }

  if (t === 'ping') {
    const at = body['at'];
    if (at !== undefined && at !== null && typeof at !== 'number') {
      return bad('at must be a number');
    }
    return { ok: true, message: { t: 'ping', at: typeof at === 'number' ? at : null } };
  }

  if (BARE_TYPES.has(t)) {
    return { ok: true, message: { t } as ClientMessage };
  }

  return bad(`unknown message type ${JSON.stringify(t)}`);
}
