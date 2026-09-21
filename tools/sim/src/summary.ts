// The self-play summary and the CI balance guard — spec 9.6.

import type { VariantId } from '@sps/engine';
import type { Level } from '@sps/ai';

export interface SimSummary {
  variant: VariantId;
  blue: number;
  red: number;
  draws: number;
  reasons: Record<'corner' | 'no-moves' | 'repetition' | 'move-limit', number>;
  avgPlies: number;
  avgCaptures: number;
  /** Share of games in which one side lost every piece of some type. */
  typeWipedOutRate: number;
  /** Of those, the share where the side that wiped out a type first went on to win. */
  firstToWipeOutWins: number;
  /** Share of games in which a corner got sealed (spec 6.3). */
  sealedRate: number;
}

export interface SimOptions {
  variant: VariantId;
  blue: Level;
  red: Level;
  games: number;
  seed: number;
}

/**
 * CI guard (spec 9.6): at Medium against Medium over 200 games per variant, the
 * first player's share of DECISIVE games stays between 40% and 60%, and draws
 * stay under 10%. Fail the build otherwise.
 */
export const GUARD = {
  minFirstPlayerShare: 0.4,
  maxFirstPlayerShare: 0.6,
  maxDrawRate: 0.1,
} as const;

export interface GuardVerdict {
  pass: boolean;
  firstPlayerShare: number;
  drawRate: number;
  failures: string[];
}

export function checkBalanceGuard(summary: SimSummary): GuardVerdict {
  const total = summary.blue + summary.red + summary.draws;
  if (total === 0) {
    return { pass: false, firstPlayerShare: 0, drawRate: 0, failures: ['no games played'] };
  }

  const decisive = summary.blue + summary.red;
  const firstPlayerShare = decisive === 0 ? 0 : summary.blue / decisive;
  const drawRate = summary.draws / total;
  const failures: string[] = [];

  if (decisive === 0) {
    failures.push('every game drawn — no decisive games to measure');
  } else if (
    firstPlayerShare < GUARD.minFirstPlayerShare ||
    firstPlayerShare > GUARD.maxFirstPlayerShare
  ) {
    failures.push(
      `first player took ${(firstPlayerShare * 100).toFixed(1)}% of decisive games, ` +
        `outside ${GUARD.minFirstPlayerShare * 100}-${GUARD.maxFirstPlayerShare * 100}%`,
    );
  }

  if (drawRate >= GUARD.maxDrawRate) {
    failures.push(
      `draws were ${(drawRate * 100).toFixed(1)}%, at or above the ${GUARD.maxDrawRate * 100}% limit`,
    );
  }

  return { pass: failures.length === 0, firstPlayerShare, drawRate, failures };
}
