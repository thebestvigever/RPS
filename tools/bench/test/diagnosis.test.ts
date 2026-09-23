import { describe, expect, it } from 'vitest';
import { branchingFactor, depthAndSpeed, hangingRate, midgamePosition } from '../src/diagnosis.js';

describe('hangingRate', () => {
  it('reports coherent counts over a small self-play sample', () => {
    const result = hangingRate({ level: 'medium', games: 2, seed: 1 });
    expect(result.moves).toBeGreaterThan(0);
    expect(result.leftHanging).toBeLessThanOrEqual(result.moves);
    expect(result.leftHangingRate).toBeGreaterThanOrEqual(0);
    expect(result.leftHangingRate).toBeLessThanOrEqual(1);
    expect(result.ignoredHanging).toBeLessThanOrEqual(result.alreadyHanging);
  }, 60_000);

  it('is reproducible from its seed', () => {
    const options = { level: 'medium' as const, games: 2, seed: 3 };
    expect(hangingRate(options)).toEqual(hangingRate(options));
  }, 60_000);
});

describe('midgamePosition', () => {
  it('reaches the requested ply, deterministically', () => {
    const a = midgamePosition('original', 1, 10);
    const b = midgamePosition('original', 1, 10);
    expect(a.ply).toBe(10);
    expect(a.ply).toBe(b.ply);
  }, 30_000);
});

describe('depthAndSpeed', () => {
  it('reports a real depth, node count and a positive nodes/second', () => {
    const result = depthAndSpeed({ targetPly: 10 });
    expect(result.depth).toBeGreaterThan(0);
    expect(result.nodes).toBeGreaterThan(0);
    expect(result.nodesPerSecond).toBeGreaterThan(0);
  }, 30_000);
});

describe('branchingFactor', () => {
  it('reports one nodes sample per depth and a branching factor between each pair', () => {
    const result = branchingFactor({ targetPly: 10, minDepth: 1, maxDepth: 3 });
    expect(result.samples).toHaveLength(3);
    expect(result.effectiveBranchingFactors).toHaveLength(2);
    for (const factor of result.effectiveBranchingFactors) {
      expect(factor).toBeGreaterThan(0);
    }
  }, 60_000);
});
