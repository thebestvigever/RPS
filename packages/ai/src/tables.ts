// Per-variant lookup tables. Distances never change for a variant, so they are
// computed once and shared by every node of every search.

import { SQUARE_COUNT, distance, goalSquares, homeSquares } from '@sps/engine';
import type { Side, VariantConfig } from '@sps/engine';

export interface DistanceTables {
  /** Nearest king distance from each square to that side's GOAL (spec 9.2). */
  toGoal: Record<Side, Int8Array>;
  /** Nearest king distance from each square to that side's OWN corner. */
  toHome: Record<Side, Int8Array>;
}

function tableFor(squares: readonly number[]): Int8Array {
  const table = new Int8Array(SQUARE_COUNT);
  for (let square = 0; square < SQUARE_COUNT; square++) {
    let nearest = 127;
    for (const target of squares) nearest = Math.min(nearest, distance(square, target));
    table[square] = nearest;
  }
  return table;
}

const cache = new WeakMap<VariantConfig, DistanceTables>();

export function distanceTables(variant: VariantConfig): DistanceTables {
  const cached = cache.get(variant);
  if (cached) return cached;

  const tables: DistanceTables = {
    toGoal: {
      blue: tableFor(goalSquares(variant, 'blue')),
      red: tableFor(goalSquares(variant, 'red')),
    },
    toHome: {
      blue: tableFor(homeSquares(variant, 'blue')),
      red: tableFor(homeSquares(variant, 'red')),
    },
  };

  cache.set(variant, tables);
  return tables;
}
