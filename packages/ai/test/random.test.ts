import { describe, expect, it } from 'vitest';
import { mulberry32, pick, randomInt } from '../src/random.js';
import { WIN_SCORE, terminalScore } from '../src/evaluate.js';

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

describe('terminal scores (spec 9.1)', () => {
  it('prefers faster wins and slower losses', () => {
    expect(terminalScore('win', 10)).toBeGreaterThan(terminalScore('win', 40));
    expect(terminalScore('loss', 40)).toBeGreaterThan(terminalScore('loss', 10));
    expect(terminalScore('draw', 10)).toBe(0);
    expect(terminalScore('win', 0)).toBe(WIN_SCORE);
  });

  it('always ranks a win above a draw above a loss', () => {
    for (const ply of [0, 50, 150, 299]) {
      expect(terminalScore('win', ply)).toBeGreaterThan(0);
      expect(terminalScore('loss', ply)).toBeLessThan(0);
    }
  });
});

describe('search', () => {
  it.todo('negamax with alpha-beta returns the same move as plain negamax');
  it.todo('quiescence stops the horizon effect on a hanging capture');
  it.todo('jitter picks only among moves within its window of the best');
  it.todo('the same seed and position always give the same move');
  it.todo('Hard stays inside its 1.2 s budget');
});
