import { describe, expect, it } from 'vitest';
import {
  PRESETS,
  TYPICAL_MOVES,
  UNLIMITED,
  categoryOf,
  delayed,
  estimatedDurationMs,
  fischer,
  presetById,
} from '../src/index.js';

describe('time controls', () => {
  it('names itself the way a player would say it', () => {
    expect(fischer(3, 2).name).toBe('3+2');
    expect(fischer(5, 0).id).toBe('5+0');
    expect(UNLIMITED.name).toBe('Unlimited');
  });

  it('uses sudden death when there is no increment', () => {
    expect(fischer(5, 0).stages[0]!.bonus.kind).toBe('none');
    expect(fischer(5, 3).stages[0]!.bonus.kind).toBe('fischer');
  });

  it('estimates a game at this game’s length, not chess’s', () => {
    // Spec 6.1 measured 129-138 plies, so about 67 moves a side. A 3+2 game is
    // therefore 3 minutes plus over two more of increment — filing it by the
    // initial time alone would call it far shorter than it plays.
    expect(TYPICAL_MOVES).toBe(67);
    expect(estimatedDurationMs(fischer(3, 2))).toBe(3 * 60_000 + 67 * 2_000);
  });

  it('does not count delay as lengthening the game, because it is only given back if used', () => {
    expect(estimatedDurationMs(delayed(5, 10, 'simple'))).toBe(5 * 60_000);
    expect(estimatedDurationMs(delayed(5, 10, 'bronstein'))).toBe(5 * 60_000);
  });

  it('sorts controls into categories by how long they actually run', () => {
    expect(categoryOf(fischer(1, 0))).toBe('bullet');
    expect(categoryOf(fischer(3, 2))).toBe('blitz');
    expect(categoryOf(fischer(10, 5))).toBe('rapid');
    expect(categoryOf(fischer(30, 20))).toBe('classical');
    expect(categoryOf(UNLIMITED)).toBe('unlimited');
  });

  it('offers a preset in every category', () => {
    const categories = new Set(PRESETS.map(categoryOf));
    for (const category of ['bullet', 'blitz', 'rapid', 'classical', 'unlimited']) {
      expect(categories).toContain(category);
    }
  });

  it('gives every preset a unique id, and finds it again', () => {
    const ids = PRESETS.map((control) => control.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(presetById(id).id).toBe(id);
    expect(() => presetById('7+7')).toThrow(/unknown time control/);
  });

  it('carries an increment on everything but the shortest, because games run long', () => {
    for (const control of PRESETS) {
      if (control.unlimited || control.id === '1+0') continue;
      expect(control.stages[0]!.bonus.ms).toBeGreaterThan(0);
    }
  });
});
