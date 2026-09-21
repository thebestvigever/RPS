import { describe, expect, it } from 'vitest';
import { mulberry32, pick, randomInt, stableJitter } from '../src/random.js';

describe('seeded randomness (spec 7.8)', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(918273);
    const b = mulberry32(918273);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('differs between seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it('stays in [0, 1)', () => {
    const next = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const value = next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('picks within range and rejects an empty list', () => {
    const next = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const n = randomInt(next, 5);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(5);
    }
    expect(pick(mulberry32(7), ['only'])).toBe('only');
    expect(() => pick(mulberry32(7), [])).toThrow();
  });
});

describe('stable move-ordering tiebreak', () => {
  it('is deterministic for a (seed, from, to) triple', () => {
    expect(stableJitter(7, 40, 41)).toBe(stableJitter(7, 40, 41));
  });

  it('differs across seeds and across moves', () => {
    expect(stableJitter(1, 40, 41)).not.toBe(stableJitter(2, 40, 41));
    expect(stableJitter(1, 40, 41)).not.toBe(stableJitter(1, 40, 42));
    expect(stableJitter(1, 40, 41)).not.toBe(stableJitter(1, 39, 41));
  });

  it('stays in [0, 1) so it can only ever break a tie, never reorder', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (let square = 0; square < 81; square++) {
        const value = stableJitter(seed, square, (square + 7) % 81);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });
});
