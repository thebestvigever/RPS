// Goal squares — spec 2.1 and 5. A side's goal is the OPPONENT's corner: Blue
// must reach i9, Red must reach a1, and in the 2x2 Corner variant each goal is a
// block of four.

import { parseSquare } from './board.js';
import type { Side, Square, VariantConfig } from './types.js';

const cache = new WeakMap<VariantConfig, Record<Side, readonly Square[]>>();

function resolve(variant: VariantConfig): Record<Side, readonly Square[]> {
  const cached = cache.get(variant);
  if (cached) return cached;
  const resolved = {
    blue: variant.goals.blue.map(parseSquare),
    red: variant.goals.red.map(parseSquare),
  };
  cache.set(variant, resolved);
  return resolved;
}

/** The squares `side` must REACH to win. */
export function goalSquares(variant: VariantConfig, side: Side): readonly Square[] {
  return resolve(variant)[side];
}

export function isGoalSquare(variant: VariantConfig, side: Side, square: Square): boolean {
  return goalSquares(variant, side).includes(square);
}

/**
 * `side`'s own corner — the squares it defends, which is the opponent's goal.
 * This is what the Keep seals (2.10).
 */
export function homeSquares(variant: VariantConfig, side: Side): readonly Square[] {
  return goalSquares(variant, side === 'blue' ? 'red' : 'blue');
}
