// The engine has no randomness (spec 7.8). The AI takes a seed and uses this, so
// any computer game replays exactly from its seed and move list.

export type Random = () => number;

/** mulberry32 — the generator the spec names. Returns [0, 1). */
export function mulberry32(seed: number): Random {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in [0, n). */
export function randomInt(random: Random, n: number): number {
  return Math.floor(random() * n);
}

/** Uniform pick. Throws on an empty list so a bug never silently picks nothing. */
export function pick<T>(random: Random, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick from an empty list');
  return items[randomInt(random, items.length)]!;
}

/**
 * A stable pseudo-random value in [0, 1) for a (seed, a, b) triple.
 *
 * Move ordering needs a tiebreak so equal moves don't always come out in board
 * order. Drawing it from the shared generator would work, but it couples the
 * random stream to how many moves the search happens to look at — so any change
 * to ordering or pruning reshuffles every game, and a self-play run before and
 * after a rules change is no longer comparable. Hashing the move instead keeps
 * the generator for the root choice alone.
 */
export function stableJitter(seed: number, a: number, b: number): number {
  let hash = (seed ^ Math.imul(a + 1, 0x27d4eb2d) ^ Math.imul(b + 1, 0x165667b1)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0x297a2d39) >>> 0;
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}
