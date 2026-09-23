import { describe, expect, it } from 'vitest';
import { sprt } from '../src/sprt.js';

const PARAMS = { elo0: 0, elo1: 5, alpha: 0.05, beta: 0.05 };

describe('sprt', () => {
  it('keeps going with too little data', () => {
    expect(sprt({ wins: 1, draws: 0, losses: 0 }, PARAMS).status).toBe('continue');
    expect(sprt({ wins: 0, draws: 10, losses: 0 }, PARAMS).status).toBe('continue');
  });

  it('accepts H1 given a clear, sustained improvement', () => {
    // ~85 elo, well past elo1 (5) — this needs to be decisive, not just
    // "better": a 42-elo gap at 500 games (an earlier version of this test)
    // still landed well inside the bounds, which is realistic SPRT behaviour
    // for a modest effect size, not a bug.
    const wdl = { wins: 600, draws: 40, losses: 100 };
    const result = sprt(wdl, PARAMS);
    expect(result.status).toBe('accept');
    expect(result.llr).toBeGreaterThanOrEqual(result.upperBound);
  });

  it('rejects given a clear regression', () => {
    const wdl = { wins: 100, draws: 40, losses: 600 };
    const result = sprt(wdl, PARAMS);
    expect(result.status).toBe('reject');
    expect(result.llr).toBeLessThanOrEqual(result.lowerBound);
  });

  it('stays inconclusive at a dead-even score — right at elo0, where the test is deliberately ambivalent', () => {
    const wdl = { wins: 100, draws: 20, losses: 100 };
    expect(sprt(wdl, PARAMS).status).toBe('continue');
  });

  it('tighter alpha/beta widen the bounds it takes to resolve', () => {
    const wdl = { wins: 10, draws: 0, losses: 8 };
    const loose = sprt(wdl, PARAMS);
    const tight = sprt(wdl, { ...PARAMS, alpha: 0.01, beta: 0.01 });
    expect(tight.upperBound).toBeGreaterThan(loose.upperBound);
    expect(tight.lowerBound).toBeLessThan(loose.lowerBound);
  });
});
