import { describe, expect, it } from 'vitest';
import { EMPTY_VARIANT_STATS, recordOutcome, statsFor, statsKey } from '../src/stats.js';

describe('stats (spec 10.7)', () => {
  it('keys by variant and difficulty', () => {
    expect(statsKey('original', 'medium')).toBe('original:medium');
    expect(statsKey('neutrals', 'hard')).toBe('neutrals:hard');
  });

  it('starts every key at zero', () => {
    expect(statsFor({}, 'original', 'easy')).toEqual(EMPTY_VARIANT_STATS);
  });

  it('a win increments wins and the streak', () => {
    let stats = recordOutcome({}, 'original', 'medium', 'win');
    stats = recordOutcome(stats, 'original', 'medium', 'win');
    expect(statsFor(stats, 'original', 'medium')).toEqual({ wins: 2, losses: 0, draws: 0, streak: 2 });
  });

  it('a loss ends the streak without touching wins', () => {
    let stats = recordOutcome({}, 'original', 'medium', 'win');
    stats = recordOutcome(stats, 'original', 'medium', 'loss');
    expect(statsFor(stats, 'original', 'medium')).toEqual({ wins: 1, losses: 1, draws: 0, streak: 0 });
  });

  it('a draw ends the streak without counting as a loss', () => {
    let stats = recordOutcome({}, 'original', 'hard', 'win');
    stats = recordOutcome(stats, 'original', 'hard', 'draw');
    expect(statsFor(stats, 'original', 'hard')).toEqual({ wins: 1, losses: 0, draws: 1, streak: 0 });
  });

  it('keeps variants and difficulties separate', () => {
    let stats = recordOutcome({}, 'original', 'easy', 'win');
    stats = recordOutcome(stats, 'neutrals', 'hard', 'loss');
    expect(statsFor(stats, 'original', 'easy')).toEqual({ wins: 1, losses: 0, draws: 0, streak: 1 });
    expect(statsFor(stats, 'neutrals', 'hard')).toEqual({ wins: 0, losses: 1, draws: 0, streak: 0 });
    expect(statsFor(stats, 'original', 'hard')).toEqual(EMPTY_VARIANT_STATS);
  });
});
