// Local stats — spec 10.7: "Local stats per variant and difficulty: wins,
// losses, draws and current streak." GameOver.tsx's own comment before this
// file existed: "Not here, and not pretended... a streak counter that resets
// every reload would be worse than none." This is that persistence-shaped
// piece; storage.ts is what actually touches localStorage.
//
// Scoped to vs-computer games only. "Per variant and difficulty" only means
// something there — pass-and-play has no difficulty, and there is no fixed
// "you" to keep a streak for when two people are trading the same device.
// Tracking it per SIDE instead would be a different, unasked-for feature.

import type { Level } from '@sps/ai';
import type { VariantId } from '@sps/engine';

export interface VariantStats {
  wins: number;
  losses: number;
  draws: number;
  /** Consecutive wins right now; any loss or draw resets it to 0. */
  streak: number;
}

export type StatsKey = `${VariantId}:${Level}`;

export type Stats = Partial<Record<StatsKey, VariantStats>>;

export const EMPTY_VARIANT_STATS: VariantStats = { wins: 0, losses: 0, draws: 0, streak: 0 };

export function statsKey(variant: VariantId, level: Level): StatsKey {
  return `${variant}:${level}`;
}

export function statsFor(stats: Stats, variant: VariantId, level: Level): VariantStats {
  return stats[statsKey(variant, level)] ?? EMPTY_VARIANT_STATS;
}

export type Outcome = 'win' | 'loss' | 'draw';

/** Pure update — the caller decides when a game is over and what it counts as. */
export function recordOutcome(stats: Stats, variant: VariantId, level: Level, outcome: Outcome): Stats {
  const key = statsKey(variant, level);
  const current = stats[key] ?? EMPTY_VARIANT_STATS;
  const next: VariantStats =
    outcome === 'win'
      ? { ...current, wins: current.wins + 1, streak: current.streak + 1 }
      : outcome === 'loss'
        ? { ...current, losses: current.losses + 1, streak: 0 }
        : { ...current, draws: current.draws + 1, streak: 0 };
  return { ...stats, [key]: next };
}
