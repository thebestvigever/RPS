// The Worker: four routes and a rate limiter.
//
//   POST /api/match       create a match, get back a link to send a friend
//   GET  /api/match/<id>  what that link leads to, without taking a seat
//   GET  /ws/<id>         the socket, handed straight to that match's room
//   OPTIONS *             the browser asking first
//
// Everything after the upgrade happens in `MatchRoom`, and everything that
// decides anything happens in `@sps/referee`.

import { inviteLink, isMatchId } from '@sps/referee';
import type { Bucket } from '@sps/referee';
import { charge, createBucket } from '@sps/referee';

import type { CreatedMatch } from './api.js';
import { CORS_HEADERS, json, matchIdFrom, parseCreateMatch, problem } from './api.js';
import { newMatchId, newToken, pickSide } from './ids.js';
import type { Env, InitBody } from './room-object.js';

export { MatchRoom } from './room-object.js';
export type { Env } from './room-object.js';

/** A create-match body is a few dozen bytes; this is already generous. */
const MAX_BODY_BYTES = 2048;

/**
 * Rate limiting for match creation — spec 13.7.
 *
 * Per isolate, which is honest rather than ideal: Cloudflare may run several,
 * so a determined client gets one bucket per isolate it lands on. It costs
 * nothing, it stops the ordinary runaway loop, and the real answer when this
 * matters is a rate-limiting binding or a gate object keyed by address. Said
 * here rather than left for someone to discover.
 */
const gates = new Map<string, Bucket>();

function allowCreate(address: string, now: number): boolean {
  const bucket = gates.get(address) ?? createBucket(now);
  const charged = charge(bucket, now);
  gates.set(address, charged.bucket);
  // A map that only ever grows is a leak; isolates are short-lived, but not
  // short-lived enough to rely on.
  if (gates.size > 5_000) gates.clear();
  return charged.ok;
}

async function createMatch(request: Request, env: Env, url: URL, origin: string): Promise<Response> {
  const address = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (!allowCreate(address, Date.now())) {
    return problem('too many matches, too fast — wait a moment', 429, origin);
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return problem('that request is too large', 413, origin);

  let body: unknown = {};
  if (text.trim() !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      return problem('that is not JSON', 400, origin);
    }
  }

  const parsed = parseCreateMatch(body);
  if (!parsed.ok) return problem(parsed.reason, 400, origin);

  const matchId = newMatchId();
  const tokens = { blue: newToken(), red: newToken() };
  const you = pickSide(parsed.value.side);
  const theirs = you === 'blue' ? tokens.red : tokens.blue;

  const init: InitBody = {
    matchId,
    mode: parsed.value.mode,
    variant: parsed.value.variant,
    control: parsed.value.control.id,
    tokens,
  };

  const stub = env.ROOMS.get(env.ROOMS.idFromName(matchId));
  const created = await stub.fetch('https://room/init', {
    method: 'POST',
    body: JSON.stringify(init),
  });
  if (!created.ok) return problem('could not open that room', 500, origin);

  // Links point at the app, which is somewhere else: this Worker serves an API
  // and no pages. A deployment without APP_ORIGIN set still works — the links
  // just point back here, which is wrong in a visible way rather than a quiet
  // one.
  const app = env.APP_ORIGIN ?? url.origin;
  const socket = `${url.origin.replace(/^http/, 'ws')}/ws/${matchId}`;

  const response: CreatedMatch = {
    matchId,
    you,
    token: you === 'blue' ? tokens.blue : tokens.red,
    invite: inviteLink(app, matchId, theirs),
    spectate: inviteLink(app, matchId, null),
    socket,
    variant: parsed.value.variant,
    control: { id: parsed.value.control.id, name: parsed.value.control.name },
    mode: parsed.value.mode,
  };

  return json(response, 201, origin);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN ?? '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { 'access-control-allow-origin': origin, ...CORS_HEADERS },
      });
    }

    if (url.pathname === '/api/match' && request.method === 'POST') {
      return createMatch(request, env, url, origin);
    }

    const socketId = matchIdFrom(url.pathname, '/ws/');
    if (socketId !== null) {
      if ((request.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
        return problem('that address wants a websocket', 426, origin);
      }
      const stub = env.ROOMS.get(env.ROOMS.idFromName(socketId));
      return stub.fetch(request);
    }

    const matchId = matchIdFrom(url.pathname, '/api/match/');
    if (matchId !== null && request.method === 'GET') {
      const stub = env.ROOMS.get(env.ROOMS.idFromName(matchId));
      const summary = await stub.fetch('https://room/summary');
      return json(await summary.json(), summary.status, origin);
    }

    // A path that looks like a match id but is not one gets the same answer as
    // anything else: this API says nothing about which rooms exist.
    if (url.pathname.startsWith('/api/match/') && !isMatchId(url.pathname.slice(11))) {
      return problem('not found', 404, origin);
    }

    return problem('not found', 404, origin);
  },
};
