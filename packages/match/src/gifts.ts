// Who may hand time to whom.
//
// Giving the opponent 15 seconds is lichess's gesture, and like theirs it is a
// casual-game courtesy: in a rated game it would be a way to buy a result, so
// it is off there.
//
// Giving it to YOURSELF is only offered against the computer, where there is
// nobody to cheat — it is the difference between losing a good position to a
// phone call and not. It is deliberately unlimited, which makes a timed game
// against the computer a soft limit rather than a hard one. Every gift is
// recorded in the game record, so a shared game still tells the truth about it.

import type { Side } from '@sps/engine';
import { GIFT_MS } from './time-control.js';
import type { MatchMode, Permission } from './offers.js';

export interface GiftPolicy {
  /** May a player add time to their opponent's clock? */
  toOpponent: boolean;
  /** May a player add time to their own? */
  toSelf: boolean;
  /** How much a single press hands over. */
  ms: number;
}

export const GIFT_POLICIES: Record<MatchMode, GiftPolicy> = {
  'pass-and-play': { toOpponent: true, toSelf: false, ms: GIFT_MS },
  'vs-computer': { toOpponent: true, toSelf: true, ms: GIFT_MS },
  'online-casual': { toOpponent: true, toSelf: false, ms: GIFT_MS },
  rated: { toOpponent: false, toSelf: false, ms: GIFT_MS },
};

export function canGive(policy: GiftPolicy, from: Side, to: Side): Permission {
  if (from === to) {
    return policy.toSelf
      ? { ok: true }
      : { ok: false, reason: 'you can only add time to your own clock against the computer' };
  }
  return policy.toOpponent
    ? { ok: true }
    : { ok: false, reason: 'giving time is off in a rated game' };
}
