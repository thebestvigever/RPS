import { describe, expect, it } from 'vitest';
import { VARIANT_IDS } from '@sps/engine';
import { parseOptions, DEFAULTS } from '../src/options.js';
import { checkBalanceGuard } from '../src/summary.js';
import { runSimulation } from '../src/index.js';
import type { SimSummary } from '../src/summary.js';

function summary(over: Partial<SimSummary>): SimSummary {
  return {
    variant: 'original',
    blue: 0,
    red: 0,
    draws: 0,
    reasons: { corner: 0, 'no-moves': 0, repetition: 0, 'move-limit': 0 },
    avgPlies: 0,
    avgCaptures: 0,
    typeWipedOutRate: 0,
    firstToWipeOutWins: 0,
    sealedRate: 0,
    ...over,
  };
}

describe('CLI options (spec 9.6)', () => {
  it('defaults to Medium against Medium over 200 games', () => {
    expect(parseOptions([])).toEqual(DEFAULTS);
    expect(DEFAULTS.games).toBe(200);
    expect(DEFAULTS.blue).toBe('medium');
    expect(DEFAULTS.red).toBe('medium');
  });

  it('parses the documented invocation', () => {
    const argv = '--variant neutrals --blue hard --red easy --games 40 --seed 918273'.split(' ');
    expect(parseOptions(argv)).toEqual({
      variant: 'neutrals',
      blue: 'hard',
      red: 'easy',
      games: 40,
      seed: 918273,
    });
  });

  it('rejects unknown variants, levels, flags and bad counts', () => {
    expect(() => parseOptions(['--variant', 'crazyhouse'])).toThrow(/unknown variant/);
    expect(() => parseOptions(['--blue', 'godlike'])).toThrow(/unknown level/);
    expect(() => parseOptions(['--rounds', '5'])).toThrow(/unknown flag/);
    expect(() => parseOptions(['--games', '0'])).toThrow(/positive integer/);
    expect(() => parseOptions(['--seed', 'abc'])).toThrow(/positive integer/);
    expect(() => parseOptions(['--games'])).toThrow(/needs a value/);
  });
});

describe('CI balance guard (spec 9.6)', () => {
  it('passes a balanced, decisive run', () => {
    // Original at depth 2, spec 6.1: 111 / 147 / 2 over 260 games.
    const verdict = checkBalanceGuard(summary({ blue: 111, red: 147, draws: 2 }));
    expect(verdict.pass).toBe(true);
    expect(verdict.firstPlayerShare).toBeCloseTo(0.43, 2);
  });

  it('fails a lopsided run', () => {
    // The rejected centre-neutrals design, spec 4.4: 77 to 42.
    const verdict = checkBalanceGuard(summary({ blue: 77, red: 42, draws: 1 }));
    expect(verdict.pass).toBe(false);
    expect(verdict.failures.join(' ')).toMatch(/first player/);
  });

  it('fails a drawish run', () => {
    // Freely-walking neutrals, spec 4.4: 34 of 120 drawn.
    const verdict = checkBalanceGuard(summary({ blue: 43, red: 43, draws: 34 }));
    expect(verdict.pass).toBe(false);
    expect(verdict.failures.join(' ')).toMatch(/draws/);
  });

  it('fails an empty or all-drawn run rather than passing vacuously', () => {
    expect(checkBalanceGuard(summary({})).pass).toBe(false);
    expect(checkBalanceGuard(summary({ draws: 100 })).pass).toBe(false);
  });

  it('holds the boundaries the spec names', () => {
    expect(checkBalanceGuard(summary({ blue: 40, red: 60, draws: 0 })).pass).toBe(true);
    expect(checkBalanceGuard(summary({ blue: 39, red: 61, draws: 0 })).pass).toBe(false);
    expect(checkBalanceGuard(summary({ blue: 46, red: 45, draws: 9 })).pass).toBe(true);
    expect(checkBalanceGuard(summary({ blue: 45, red: 45, draws: 10 })).pass).toBe(false);
  });
});

describe('self-play runs', () => {
  // A real 200-game guard run takes minutes, so it lives in CI and in the
  // pre-rules-change routine, not here. This only proves the harness reports
  // coherent numbers.
  it.each(VARIANT_IDS)('%s: a short run reports a coherent summary', (id) => {
    const games = 4;
    const result = runSimulation({ variant: id, blue: 'easy', red: 'easy', games, seed: 11 });

    expect(result.variant).toBe(id);
    expect(result.blue + result.red + result.draws).toBe(games);

    const byReason = Object.values(result.reasons).reduce((sum, n) => sum + n, 0);
    expect(byReason).toBe(games);

    expect(result.avgPlies).toBeGreaterThan(0);
    expect(result.avgPlies).toBeLessThanOrEqual(300);
    expect(result.avgCaptures).toBeGreaterThanOrEqual(0);

    for (const rate of [result.typeWipedOutRate, result.firstToWipeOutWins, result.sealedRate]) {
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
  }, 120_000);

  it('is reproducible from its seed', () => {
    const options = { variant: 'original' as const, blue: 'easy' as const, red: 'easy' as const, games: 3, seed: 5 };
    expect(runSimulation(options)).toEqual(runSimulation(options));
  }, 120_000);

  it('plays different games from different seeds', () => {
    const base = { variant: 'original' as const, blue: 'easy' as const, red: 'easy' as const, games: 6 };
    const a = runSimulation({ ...base, seed: 1 });
    const b = runSimulation({ ...base, seed: 2 });
    // Same length every time would mean the seed is not reaching the moves.
    expect(a.avgPlies === b.avgPlies && a.avgCaptures === b.avgCaptures).toBe(false);
  }, 120_000);
});
