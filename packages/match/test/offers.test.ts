import { describe, expect, it } from 'vitest';
import {
  GIFT_POLICIES,
  OFFER_POLICIES,
  OfferError,
  accept,
  canGive,
  canOffer,
  createOffers,
  decline,
  offer,
  onMove,
  withdraw,
} from '../src/index.js';
import type { MatchMode } from '../src/index.js';

const casual = () => createOffers(OFFER_POLICIES['online-casual']);
const local = () => createOffers(OFFER_POLICIES['pass-and-play']);

describe('draw offers', () => {
  it('holds one pending offer', () => {
    const { state } = offer(local(), 'draw', 'blue', 4);
    expect(state.pending).toEqual({ kind: 'draw', by: 'blue', atPly: 4 });
  });

  it('is accepted by the opponent, and reports what was accepted', () => {
    const { state } = offer(local(), 'draw', 'blue', 4);
    const { state: after, accepted } = accept(state, 'red');
    expect(accepted).toEqual({ kind: 'draw', by: 'blue', atPly: 4 });
    expect(after.pending).toBeNull();
  });

  it('cannot be accepted by the player who made it', () => {
    const { state } = offer(local(), 'draw', 'blue', 4);
    expect(() => accept(state, 'blue')).toThrow(OfferError);
  });

  it('is declined by the opponent, and withdrawn by its author', () => {
    const { state } = offer(local(), 'draw', 'blue', 4);
    expect(decline(state, 'red').pending).toBeNull();
    expect(withdraw(state, 'blue').pending).toBeNull();
    expect(() => withdraw(state, 'red')).toThrow(OfferError);
    expect(() => decline(state, 'blue')).toThrow(/withdraw your own/);
  });

  it('is declined by playing on', () => {
    const { state } = offer(local(), 'draw', 'blue', 4);
    expect(onMove(state).pending).toBeNull();
  });

  it('accepts when both players offer, whoever is second', () => {
    const first = offer(local(), 'draw', 'blue', 4).state;
    const { state, accepted } = offer(first, 'draw', 'red', 5);
    expect(accepted).toEqual({ kind: 'draw', by: 'blue', atPly: 4 });
    expect(state.pending).toBeNull();
  });

  it('refuses a second offer from the same player', () => {
    const { state } = offer(local(), 'draw', 'blue', 4);
    expect(canOffer(state, 'draw', 'blue', 5)).toEqual({
      ok: false,
      reason: 'you already offered a draw',
    });
  });

  it('refuses a different offer while one is pending', () => {
    const { state } = offer(casual(), 'draw', 'blue', 4);
    expect(canOffer(state, 'takeback', 'red', 5).ok).toBe(false);
  });

  it('cannot be repeated immediately after a refusal, so it cannot be used to nag', () => {
    let state = offer(casual(), 'draw', 'blue', 4).state;
    state = decline(state, 'red');

    const refused = canOffer(state, 'draw', 'blue', 5);
    expect(refused.ok).toBe(false);
    // Narrowed, so the message is actually checked rather than coerced.
    if (!refused.ok) expect(refused.reason).toMatch(/wait 9 more plies/);
    // The opponent is not held to Blue's cooldown.
    expect(canOffer(state, 'draw', 'red', 5).ok).toBe(true);
    // And Blue may ask again later.
    expect(canOffer(state, 'draw', 'blue', 14).ok).toBe(true);
  });

  it('throws rather than silently ignoring a refused offer', () => {
    let state = offer(casual(), 'draw', 'blue', 4).state;
    state = decline(state, 'red');
    expect(() => offer(state, 'draw', 'blue', 5)).toThrow(OfferError);
  });

  it('has nothing to accept, decline or withdraw when none is pending', () => {
    expect(() => accept(local(), 'red')).toThrow(OfferError);
    expect(() => decline(local(), 'red')).toThrow(OfferError);
    expect(() => withdraw(local(), 'blue')).toThrow(OfferError);
  });
});

describe('what each mode allows', () => {
  it('needs no takeback offer where undo is already free', () => {
    // Undo is unrestricted against the computer and in pass-and-play (10.8).
    for (const mode of ['pass-and-play', 'vs-computer'] as const) {
      expect(canOffer(createOffers(OFFER_POLICIES[mode]), 'takeback', 'blue', 2).ok).toBe(false);
    }
    expect(canOffer(casual(), 'takeback', 'blue', 2).ok).toBe(true);
  });

  it('never takes a takeback back in a rated game', () => {
    expect(canOffer(createOffers(OFFER_POLICIES.rated), 'takeback', 'blue', 2).ok).toBe(false);
  });

  it('allows a draw and a rematch everywhere', () => {
    for (const mode of Object.keys(OFFER_POLICIES) as MatchMode[]) {
      const state = createOffers(OFFER_POLICIES[mode]);
      expect(canOffer(state, 'draw', 'blue', 2).ok).toBe(true);
      expect(canOffer(state, 'rematch', 'blue', 2).ok).toBe(true);
    }
  });

  it('keeps a rematch offer alive across a move, unlike a draw', () => {
    const { state } = offer(local(), 'rematch', 'blue', 40);
    expect(onMove(state).pending).not.toBeNull();
  });
});

describe('who may give time', () => {
  it('lets either player hand the opponent time in a casual game', () => {
    for (const mode of ['pass-and-play', 'vs-computer', 'online-casual'] as const) {
      expect(canGive(GIFT_POLICIES[mode], 'blue', 'red').ok).toBe(true);
    }
  });

  it('lets a player top up their own clock only against the computer', () => {
    expect(canGive(GIFT_POLICIES['vs-computer'], 'blue', 'blue').ok).toBe(true);
    expect(canGive(GIFT_POLICIES['pass-and-play'], 'blue', 'blue').ok).toBe(false);
    expect(canGive(GIFT_POLICIES['online-casual'], 'blue', 'blue').ok).toBe(false);
  });

  it('turns gifts off entirely in a rated game', () => {
    expect(canGive(GIFT_POLICIES.rated, 'blue', 'red').ok).toBe(false);
    expect(canGive(GIFT_POLICIES.rated, 'blue', 'blue').ok).toBe(false);
  });

  it('hands over 15 seconds a press', () => {
    for (const policy of Object.values(GIFT_POLICIES)) expect(policy.ms).toBe(15_000);
  });
});
