import { describe, expect, it } from 'vitest';
import { runTactics, TACTIC_PUZZLES } from '../src/tactics.js';
import type { TacticPuzzle } from '../src/tactics.js';

describe('the committed tactics fixture', () => {
  it('is non-empty and covers both categories', () => {
    expect(TACTIC_PUZZLES.length).toBeGreaterThan(0);
    const categories = new Set(TACTIC_PUZZLES.map((puzzle) => puzzle.category));
    expect(categories.has('defensive')).toBe(true);
    expect(categories.has('race')).toBe(true);
  });

  it('every puzzle has at least one solution and a real position', () => {
    for (const puzzle of TACTIC_PUZZLES) {
      expect(puzzle.solutions.length).toBeGreaterThan(0);
      expect(puzzle.fen.length).toBeGreaterThan(0);
    }
  });
});

describe('runTactics', () => {
  // Tutorial puzzle 2 (packages/engine/src/data/tutorial.json), already
  // verified against the live engine by the engine's own fixtures test — a
  // known-good position rather than a hand-built one for this test.
  const puzzle: TacticPuzzle = {
    id: 'test-1',
    category: 'defensive',
    variant: 'original',
    fen: '9/9/9/3PRS3/4r4/9/9/9/9 blue',
    solutions: ['Re5xf6'],
    note: 'test fixture',
  };

  it('scores a puzzle solved when the chosen move matches a solution', () => {
    const result = runTactics('hard', [puzzle], 1);
    expect(result.outcomes[0]?.played).toBe('Re5xf6');
    expect(result.outcomes[0]?.solved).toBe(true);
    expect(result.total).toBe(1);
    expect(result.solved).toBe(1);
    expect(result.rate).toBe(1);
  }, 30_000);

  it('breaks the rate down by category', () => {
    const result = runTactics('hard', [puzzle], 1);
    expect(result.byCategory.defensive.total).toBe(1);
    expect(result.byCategory.race.total).toBe(0);
  }, 30_000);

  it('accepts a custom LevelConfig, not just a named level', () => {
    const config = { depth: 3, minDepth: 3, jitter: 0, keepTerms: true, budgetMs: 400 };
    const result = runTactics(config, [puzzle], 1);
    expect(result.level).toBe('custom');
  }, 30_000);
});
