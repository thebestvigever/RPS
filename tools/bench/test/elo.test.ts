import { describe, expect, it } from 'vitest';
import { eloEstimate, scoreToElo } from '../src/elo.js';

describe('scoreToElo', () => {
  it('is 0 at a 50% score', () => {
    expect(scoreToElo(0.5)).toBeCloseTo(0, 6);
  });

  it('is +-400 at a 10:1 score ratio — a property of the logistic model itself', () => {
    expect(scoreToElo(10 / 11)).toBeCloseTo(400, 4);
    expect(scoreToElo(1 / 11)).toBeCloseTo(-400, 4);
  });

  it('is +-Infinity outside [0, 1]', () => {
    expect(scoreToElo(1)).toBe(Infinity);
    expect(scoreToElo(0)).toBe(-Infinity);
  });
});

describe('eloEstimate', () => {
  it('reports 0 elo and a wide-open interval for no games', () => {
    const estimate = eloEstimate({ wins: 0, draws: 0, losses: 0 });
    expect(estimate.elo).toBe(0);
    expect(estimate.lo).toBe(-Infinity);
    expect(estimate.hi).toBe(Infinity);
  });

  it('is positive when the side under test wins more than it loses', () => {
    const estimate = eloEstimate({ wins: 60, draws: 5, losses: 35 });
    expect(estimate.elo).toBeGreaterThan(0);
    expect(estimate.lo).toBeLessThan(estimate.elo);
    expect(estimate.hi).toBeGreaterThan(estimate.elo);
  });

  it('is exactly 0 for an even split', () => {
    const estimate = eloEstimate({ wins: 40, draws: 20, losses: 40 });
    expect(estimate.elo).toBeCloseTo(0, 6);
  });

  it('a bigger sample gives a tighter interval at the same score — the doc\'s own point', () => {
    // docs/engine/06-MEASUREMENT-AND-LEVELS.md: "55 wins in 100 games sounds
    // decisive and is not."
    const small = eloEstimate({ wins: 11, draws: 0, losses: 9 });
    const big = eloEstimate({ wins: 110, draws: 0, losses: 90 });
    expect(big.hi - big.lo).toBeLessThan(small.hi - small.lo);
  });
});
