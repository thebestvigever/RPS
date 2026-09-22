// Turning `packages/match`'s clock into the two things a server needs and a
// browser doesn't: what to broadcast, and when to wake up.
//
// `packages/match` is used exactly as it ships. It never reads the time
// (ADDENDUM-CLOCKS 1), which is the whole reason the server can own the clock
// without a second implementation — so everything here is handed `now` too.

import type { Side } from '@sps/engine';
import type { ClockState } from '@sps/match';
import { remainingAt, turnSide } from '@sps/match';
import type { ClocksView } from './protocol.js';

/** JSON has no Infinity, so an unlimited clock reports null rather than lying. */
function readable(ms: number): number | null {
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : null;
}

export function clocksView(clock: ClockState, now: number): ClocksView {
  return {
    blue: readable(remainingAt(clock, 'blue', now)),
    red: readable(remainingAt(clock, 'red', now)),
    running: clock.running,
    serverTime: now,
  };
}

/**
 * When the running clock will fall, or null if nothing is ticking.
 *
 * This is what a Durable Object alarm is set to, and it has to be exact: a
 * room that sleeps through a flag hands the game to whoever walked away.
 *
 * It is computed by probing `remainingAt` rather than by reimplementing the
 * clock's arithmetic, so a delay or a tournament stage can never be modelled
 * one way here and another way there. Two probes always suffice. Past a simple
 * or Bronstein delay the clock runs down one millisecond per millisecond, so
 * `now + remaining` lands exactly on zero; inside the delay it lands short by
 * however much delay is left, and that second reading IS the shortfall. With
 * no delay at all the second probe reads zero and adds nothing.
 */
export function flagDeadline(clock: ClockState, now: number): number | null {
  const side = clock.running;
  if (side === null || clock.flagged) return null;

  const first = remainingAt(clock, side, now);
  if (!Number.isFinite(first)) return null;
  if (first <= 0) return now;

  const probe = now + first;
  const second = remainingAt(clock, side, probe);
  return second <= 0 ? probe : probe + second;
}

/** The side the clock is on, running or paused — a paused turn still belongs to somebody. */
export function sideOnClock(clock: ClockState): Side | null {
  return turnSide(clock);
}
