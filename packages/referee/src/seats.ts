// Seats, tokens and invite links — spec 13.2's first online feature:
// "play a friend by link, with no accounts. Create a match, share the link,
// and the second person to open it takes the other side."
//
// A seat's token is a bearer credential: whoever presents it IS that player,
// for joining and for every later reconnect. That is the whole design, and it
// has a cost worth stating plainly — anyone the link is forwarded to can take
// the seat, and a second connection presenting the same token is treated as
// the same person coming back (the older one is closed). With no accounts
// there is nothing else to check against, and inventing a weaker secret would
// only look like security. When accounts arrive (spec 13.3) a seat can be
// bound to a user id and the token becomes a fallback.
//
// No randomness lives here. Tokens are handed in, the same way the AI takes a
// seed rather than reaching for Math.random (spec 7.8) — which is what lets a
// room be tested with tokens a person can read.

import type { Side } from '@sps/engine';

export interface SeatRecord {
  token: string;
  /** What this player calls themselves; feeds the record's `players` (spec 8.3). */
  name: string | null;
  /** When somebody first presented this token, or null while the seat is open. */
  claimedAt: number | null;
}

export type Seats = Record<Side, SeatRecord>;

export class SeatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeatError';
  }
}

/** URL-safe, so a token can sit in a link without escaping. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** Same shape, so `#m=<id>.<token>` can be split on the first dot. */
const MATCH_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export function isToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export function isMatchId(value: string): boolean {
  return MATCH_ID_PATTERN.test(value);
}

export function createSeats(tokens: Record<Side, string>): Seats {
  for (const side of ['blue', 'red'] as const) {
    if (!isToken(tokens[side])) throw new SeatError(`${side}'s token is not url-safe`);
  }
  if (tokens.blue === tokens.red) throw new SeatError('the two seats need different tokens');
  return {
    blue: { token: tokens.blue, name: null, claimedAt: null },
    red: { token: tokens.red, name: null, claimedAt: null },
  };
}

/**
 * Which seat a token opens, or null for a token this match has never issued.
 *
 * An unknown token is deliberately NOT quietly demoted to a spectator: a
 * mistyped or stale link should say so, not put someone silently in the
 * audience of their own game.
 */
export function seatFor(seats: Seats, token: string | null): Side | null {
  if (token === null) return null;
  for (const side of ['blue', 'red'] as const) {
    if (seats[side].token === token) return side;
  }
  return null;
}

export function claim(seats: Seats, side: Side, name: string | null, now: number): Seats {
  const seat = seats[side];
  return {
    ...seats,
    [side]: {
      ...seat,
      claimedAt: seat.claimedAt ?? now,
      // A returning player may rename themselves; an unnamed reconnect keeps
      // the name the game already knows them by.
      name: name ?? seat.name,
    },
  };
}

/** Both seats taken: the game can start and the clock can be set going. */
export function bothClaimed(seats: Seats): boolean {
  return seats.blue.claimedAt !== null && seats.red.claimedAt !== null;
}

/** Mirrors the share link's `#g=` (spec 8.4); this one names a live room. */
export const JOIN_PREFIX = '#m=';

/**
 * The link to send a friend. With a token it hands over that seat; without
 * one it is a spectator's link to the same room.
 */
export function inviteLink(origin: string, matchId: string, token: string | null): string {
  if (!isMatchId(matchId)) throw new SeatError('that is not a match id');
  if (token !== null && !isToken(token)) throw new SeatError('that is not a token');
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  return `${base}/${JOIN_PREFIX}${matchId}${token === null ? '' : `.${token}`}`;
}

/** The other half, for the client: read a match id and token out of a link. */
export function parseInvite(link: string): { matchId: string; token: string | null } | null {
  const at = link.indexOf(JOIN_PREFIX);
  if (at < 0) return null;
  const body = link.slice(at + JOIN_PREFIX.length);
  const dot = body.indexOf('.');
  const matchId = dot < 0 ? body : body.slice(0, dot);
  const token = dot < 0 ? null : body.slice(dot + 1);
  if (!isMatchId(matchId)) return null;
  if (token !== null && !isToken(token)) return null;
  return { matchId, token };
}
