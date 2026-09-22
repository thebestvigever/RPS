// Who is actually there, and what the other player may do about it.
//
// Spec 13.2: "a disconnected player's clock keeps running. In casual games the
// opponent may claim the win after 60 seconds away."
//
// Two rules fall out of that sentence and both matter:
//
//   * The clock is not paused by a dropped connection. Wifi dying is the
//     player's problem, not the opponent's, and a pause would make pulling the
//     plug the cheapest way to think.
//   * The win is CLAIMED, never awarded. A player who comes back at 59 seconds
//     finds the game where they left it; one who comes back at 61 finds it
//     still there unless the opponent pressed the button. That is lichess's
//     behaviour and it is the forgiving one.

import type { Side } from '@sps/engine';
import type { PresenceFlag, PresenceView } from './protocol.js';

/** Spec 13.2's sixty seconds. */
export const AWAY_CLAIM_MS = 60_000;

/** When each side went away, or null while they are connected. */
export type AwaySince = Record<Side, number | null>;

/**
 * What the other player is told, and when their button lights up.
 *
 * `claimableAt` is in server time and is what lets a client count down
 * honestly rather than starting its own sixty seconds from whenever the
 * message happened to arrive — which would be wrong by the whole of a
 * reconnect. Rated games carry null, because there is nothing to claim.
 */
export function presenceView(
  away: AwaySince,
  claimable: boolean,
  now: number,
): PresenceView {
  const flag = (side: Side): PresenceFlag => (away[side] === null ? 'online' : 'away');
  const at = (side: Side): number | null =>
    claimable ? claimableAt(away, side) : null;

  return {
    blue: flag('blue'),
    red: flag('red'),
    claimableAt: { blue: at('blue'), red: at('red') },
    serverTime: now,
  };
}

export function awayFor(away: AwaySince, side: Side, now: number): number {
  const since = away[side];
  return since === null ? 0 : Math.max(0, now - since);
}

export function canClaimAway(away: AwaySince, opponent: Side, now: number): boolean {
  return awayFor(away, opponent, now) >= AWAY_CLAIM_MS;
}

/** When a claim first becomes possible, so the room can wake and say so. */
export function claimableAt(away: AwaySince, opponent: Side): number | null {
  const since = away[opponent];
  return since === null ? null : since + AWAY_CLAIM_MS;
}
