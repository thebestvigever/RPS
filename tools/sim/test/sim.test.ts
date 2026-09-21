import { describe, expect, it } from 'vitest';
import { parseOptions, DEFAULTS } from '../src/options.js';
import { checkBalanceGuard } from '../src/summary.js';
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
  it.todo('1,000 random-vs-random games per variant all terminate (spec 11.5)');
  it.todo('Medium vs Medium over 200 games lands near the spec 6.1 numbers');
  it.todo('the guard runs in CI for all three variants');
});
