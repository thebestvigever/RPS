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
