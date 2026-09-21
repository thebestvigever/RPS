// Draw, takeback and rematch offers.
//
// The engine already knows a game can end `agreed` (2.9); this is the etiquette
// around getting there. The rules are lichess's, because they are the ones
// players already expect:
//
//   - one pending offer at a time,
//   - making a move declines a draw offer you were sitting on,
//   - offering into an opponent's identical offer accepts it,
//   - and you cannot re-offer immediately after being turned down.
//
// That last one matters more than it looks: without it, "offer draw" becomes a
// way to interrupt someone once a move while their clock runs.

import type { Side } from '@sps/engine';

export type OfferKind = 'draw' | 'takeback' | 'rematch';

export interface Offer {
  kind: OfferKind;
  by: Side;
  atPly: number;
}

export interface OfferPolicy {
  /** Which offers this mode allows at all. */
  allowed: readonly OfferKind[];
  /** Plies a side must wait before repeating an offer that was refused. */
  cooldownPlies: number;
}

export interface OfferState {
  policy: OfferPolicy;
  pending: Offer | null;
  /** Ply of each side's last offer of each kind, keyed `side:kind`. */
  lastOfferPly: Record<string, number>;
}

export class OfferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfferError';
  }
}

/**
 * Undo is unrestricted against the computer and in pass-and-play (10.8), so a
 * takeback only needs asking for online. Rematch is offered after the game.
 */
export const OFFER_POLICIES = {
  'pass-and-play': { allowed: ['draw', 'rematch'], cooldownPlies: 0 },
  'vs-computer': { allowed: ['draw', 'rematch'], cooldownPlies: 0 },
  'online-casual': { allowed: ['draw', 'takeback', 'rematch'], cooldownPlies: 10 },
  rated: { allowed: ['draw', 'rematch'], cooldownPlies: 10 },
} as const satisfies Record<string, OfferPolicy>;

export type MatchMode = keyof typeof OFFER_POLICIES;

export function createOffers(policy: OfferPolicy): OfferState {
  return { policy, pending: null, lastOfferPly: {} };
}

const key = (side: Side, kind: OfferKind): string => `${side}:${kind}`;

export type Permission = { ok: true } | { ok: false; reason: string };

export function canOffer(
  state: OfferState,
  kind: OfferKind,
  by: Side,
  ply: number,
): Permission {
  if (!state.policy.allowed.includes(kind)) {
    return { ok: false, reason: `${kind} offers are not available in this game` };
  }

  const pending = state.pending;
  if (pending) {
    // Offering into the opponent's identical offer is an acceptance, so it is
    // allowed; offering into your own, or a different one, is not.
    if (pending.by === by) return { ok: false, reason: `you already offered a ${pending.kind}` };
    if (pending.kind !== kind) {
      return { ok: false, reason: `answer the ${pending.kind} offer first` };
    }
    return { ok: true };
  }

  const last = state.lastOfferPly[key(by, kind)];
  if (last !== undefined && ply - last < state.policy.cooldownPlies) {
    const wait = state.policy.cooldownPlies - (ply - last);
    return { ok: false, reason: `wait ${wait} more ${wait === 1 ? 'ply' : 'plies'} before offering again` };
  }

  return { ok: true };
}

export interface OfferOutcome {
  state: OfferState;
  /** Set when this offer met a matching one and settled it there and then. */
  accepted: Offer | null;
}

export function offer(
  state: OfferState,
  kind: OfferKind,
  by: Side,
  ply: number,
): OfferOutcome {
  const permission = canOffer(state, kind, by, ply);
  if (!permission.ok) throw new OfferError(permission.reason);

  const pending = state.pending;
  if (pending && pending.by !== by && pending.kind === kind) {
    return accept(state, by);
  }

  return {
    state: {
      ...state,
      pending: { kind, by, atPly: ply },
      lastOfferPly: { ...state.lastOfferPly, [key(by, kind)]: ply },
    },
    accepted: null,
  };
}

export function accept(state: OfferState, by: Side): OfferOutcome {
  const pending = state.pending;
  if (!pending) throw new OfferError('there is nothing to accept');
  if (pending.by === by) throw new OfferError('you cannot accept your own offer');
  return { state: { ...state, pending: null }, accepted: pending };
}

export function decline(state: OfferState, by: Side): OfferState {
  const pending = state.pending;
  if (!pending) throw new OfferError('there is nothing to decline');
  if (pending.by === by) throw new OfferError('withdraw your own offer instead');
  return { ...state, pending: null };
}

export function withdraw(state: OfferState, by: Side): OfferState {
  const pending = state.pending;
  if (!pending) throw new OfferError('there is nothing to withdraw');
  if (pending.by !== by) throw new OfferError('that is not your offer');
  return { ...state, pending: null };
}

/**
 * A move answers a draw or takeback offer: you played on, so you declined.
 * A rematch offer belongs to a finished game and survives.
 */
export function onMove(state: OfferState): OfferState {
  if (!state.pending || state.pending.kind === 'rematch') return state;
  return { ...state, pending: null };
}

/**
 * A game can be abandoned during the first two plies — before either side has
 * really started — and then it counts for nothing (`aborted`). After that,
 * leaving is a resignation.
 *
 * Lichess draws the line in the same place, and for the same reason: a
 * misclicked "new game" should not become a loss, but neither should "abort"
 * be an escape hatch from a position going badly.
 */
export const ABORT_BEFORE_PLY = 2;

export function canAbort(ply: number, mode: MatchMode): Permission {
  if (mode === 'pass-and-play') {
    // One device, one person: they can simply start another game.
    return { ok: true };
  }
  return ply < ABORT_BEFORE_PLY
    ? { ok: true }
    : { ok: false, reason: 'the game has started — resign instead' };
}
