// Goal squares — spec 2.1 and 5. A side's goal is the OPPONENT's corner: Blue
// must reach i9, Red must reach a1, and in the 2x2 Corner variant each goal is a
// block of four.

import { SQUARE_COUNT, parseSquare } from './board.js';
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

/**
 * 81-entry, 1 where that square is one of `side`'s goals — `isGoalSquare` is
 * asked for every move under consideration (`winsNow`, docs/engine/04-SPEED.md
 * §5), so this trades a `.includes()` scan (1 or 4 elements, but still a scan
 * behind a `WeakMap` lookup) for a direct array index.
 */
const maskCache = new WeakMap<VariantConfig, Record<Side, Uint8Array>>();

function goalMask(variant: VariantConfig): Record<Side, Uint8Array> {
  const cached = maskCache.get(variant);
  if (cached) return cached;

  const squares = resolve(variant);
  const mask: Record<Side, Uint8Array> = {
    blue: new Uint8Array(SQUARE_COUNT),
    red: new Uint8Array(SQUARE_COUNT),
  };
  for (const square of squares.blue) mask.blue[square] = 1;
  for (const square of squares.red) mask.red[square] = 1;

  maskCache.set(variant, mask);
  return mask;
}

export function isGoalSquare(variant: VariantConfig, side: Side, square: Square): boolean {
  return goalMask(variant)[side][square] === 1;
}

/**
 * `side`'s own corner — the squares it defends, which is the opponent's goal.
 * This is what the Keep seals (2.10).
 */
export function homeSquares(variant: VariantConfig, side: Side): readonly Square[] {
  return goalSquares(variant, side === 'blue' ? 'red' : 'blue');
}
