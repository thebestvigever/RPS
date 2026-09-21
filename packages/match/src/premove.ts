// Premoves — choose your reply while the opponent is still thinking.
//
// The single biggest comfort in a fast time control, and unusually simple here:
// every move is one king step, so a premove is either legal when your turn
// arrives or it isn't. There is no castling, no promotion, nothing to
// disambiguate.
//
// Lichess's behaviour, which is what players expect: one premove queued at a
// time, setting another replaces it, and a premove that turns out to be illegal
// is quietly dropped rather than costing you anything.

import { findLegalMove } from '@sps/engine';
import type { GameState, Move, Square } from '@sps/engine';
import type { MatchMode, Permission } from './offers.js';

export interface Premove {
  from: Square;
  to: Square;
}

export interface PremoveOutcome {
  /** The move to play now, if the premove survived. */
  move: Move | null;
  /** True when something was queued and turned out to be illegal. */
  dropped: boolean;
}

/**
 * Pass-and-play has one person moving both sides, so there is nothing to
 * premove during — the feature would only ever fire against yourself.
 */
export function canPremove(mode: MatchMode): Permission {
  return mode === 'pass-and-play'
    ? { ok: false, reason: 'there is no waiting turn in pass-and-play' }
    : { ok: true };
}

/**
 * Turns a queued premove into a move, now that it is this side's turn.
 *
 * Whatever comes back, the queue should be cleared: a premove is for one turn.
 * A premove whose origin square now holds an enemy piece — or nothing, because
 * it was captured — simply fails to match and is dropped.
 */
export function resolvePremove(state: GameState, queued: Premove | null): PremoveOutcome {
  if (!queued || state.result) return { move: null, dropped: false };
  const move = findLegalMove(state, queued);
  return { move, dropped: move === null };
}
