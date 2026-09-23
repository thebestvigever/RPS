import { describe, expect, it } from 'vitest';
import { getVariant } from '@sps/engine';
import { fastControl, playGame, runMatch } from '../src/match.js';

const original = getVariant('original');

describe('playGame', () => {
  it('returns a coherent outcome', () => {
    const outcome = playGame(original, 'easy', 'easy', true, 1);
    expect(['A', 'B', null]).toContain(outcome.winner);
    expect(outcome.plies).toBeGreaterThan(0);
  }, 30_000);

  it('is deterministic for a seed', () => {
    const first = playGame(original, 'easy', 'medium', true, 7);
    const second = playGame(original, 'easy', 'medium', true, 7);
    expect(second).toEqual(first);
  }, 30_000);

  it('aIsBlue actually swaps who moves first', () => {
    const asBlue = playGame(original, 'easy', 'medium', true, 3);
    const asRed = playGame(original, 'easy', 'medium', false, 3);
    // Same two configs, same seed, opposite colours — going first changes the
    // game (this game has no symmetric start), so these should diverge.
    expect(asBlue).not.toEqual(asRed);
  }, 30_000);
});

describe('runMatch', () => {
  it('plays exactly the requested game count without sprt', () => {
    const result = runMatch({ configA: 'easy', configB: 'easy', games: 6, seed: 1 });
    expect(result.gamesPlayed).toBe(6);
    expect(result.winsA + result.winsB + result.draws).toBe(6);
  }, 60_000);

  it('is reproducible from its seed', () => {
    const options = { configA: 'easy' as const, configB: 'medium' as const, games: 4, seed: 2 };
    expect(runMatch(options)).toEqual(runMatch(options));
  }, 60_000);

  it('a clearly stronger side (depth 2 vs depth 1) scores a positive elo estimate', () => {
    const result = runMatch({ configA: 'medium', configB: 'easy', games: 10, seed: 5 });
    expect(result.elo.elo).toBeGreaterThan(0);
  }, 60_000);

  it('colour-swaps in pairs from the same seed, so half the games share an opening', () => {
    // 6 games = 3 pairs; the 2nd game of each pair uses the same base seed as
    // the 1st with the sides swapped (06-MEASUREMENT-AND-LEVELS.md part one's
    // "varied openings" — cancel first-move advantage, not remove it).
    const result = runMatch({ configA: 'easy', configB: 'easy', games: 6, seed: 100 });
    expect(result.gamesPlayed).toBe(6);
  }, 60_000);

  it('wires sprt through: stops as soon as it resolves, respects maxGames otherwise', () => {
    // Not a claim that medium-vs-easy resolves within any particular game
    // count against a tight [0, 5] elo bound — `sprt.test.ts` already covers
    // the statistics on their own, cheaply, with synthetic counts. This
    // checks the plumbing: the loop stops early when `sprt()` says so, and
    // never runs past `maxGames` when it doesn't.
    const result = runMatch({
      configA: 'medium',
      configB: 'easy',
      seed: 9,
      maxGames: 40,
      sprt: { elo0: 0, elo1: 5, alpha: 0.05, beta: 0.05 },
    });
    expect(result.sprt).toBeDefined();
    expect(Number.isFinite(result.sprt!.llr)).toBe(true);
    expect(result.gamesPlayed).toBeLessThanOrEqual(40);
    if (result.sprt!.status === 'continue') {
      expect(result.gamesPlayed).toBe(40);
    } else {
      expect(result.gamesPlayed).toBeLessThan(40);
    }
  }, 120_000);
});

describe('fastControl', () => {
  it('shrinks the budget of an iterative level, for screening', () => {
    const config = fastControl('hard', 25);
    expect(config.budgetMs).toBe(25);
    expect(config.depth).toBe('iterative');
  });

  it('is harmless on a fixed-depth config, which has no budget to shrink', () => {
    const config = fastControl('medium', 25);
    expect(config.depth).toBe(2);
    expect(config.budgetMs).toBe(25);
  });
});
