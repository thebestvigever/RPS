import { describe, expect, it } from 'vitest';
import {
  VARIANT_BLURBS,
  VARIANT_IDS,
  VARIANTS,
  getVariant,
} from '../src/variants.js';
import { parseSquare } from '../src/board.js';

describe('variants as data (spec 5)', () => {
  it('ships the three v1 variants', () => {
    expect(VARIANT_IDS).toEqual(['original', 'corner2x2', 'neutrals']);
  });

  it('stamps rulesVersion 1 and the shared draw rules on every variant', () => {
    for (const id of VARIANT_IDS) {
      const variant = getVariant(id);
      expect(variant.rulesVersion).toBe(1);
      expect(variant.draw).toEqual({ repetitions: 3, maxPlies: 300 });
      expect(variant.id).toBe(id);
      expect(VARIANT_BLURBS[id]).toBeTruthy();
    }
  });

  it('uses the spec start positions', () => {
    const standard = '9/4PR3/4SPR2/5SPR1/1ps3SP1/1rps5/2rps4/3rp4/9 blue';
    const withNeutrals = '9/4PR3/2nP1SPR2/5SPR1/1ps1nS1SP1/1rps5/2rps1nP2/3rp4/9 blue';
    expect(VARIANTS.original.start).toBe(standard);
    expect(VARIANTS.corner2x2.start).toBe(standard);
    expect(VARIANTS.neutrals.start).toBe(withNeutrals);
  });

  it('gives each side the opponent corner as its goal', () => {
    expect(VARIANTS.original.goals).toEqual({ blue: ['i9'], red: ['a1'] });
    expect(VARIANTS.neutrals.goals).toEqual({ blue: ['i9'], red: ['a1'] });
    expect(VARIANTS.corner2x2.goals.blue).toEqual(['h8', 'i8', 'h9', 'i9']);
    expect(VARIANTS.corner2x2.goals.red).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('names only real squares as goals', () => {
    for (const id of VARIANT_IDS) {
      const { goals } = getVariant(id);
      for (const side of ['blue', 'red'] as const) {
        expect(goals[side].length).toBeGreaterThan(0);
        for (const name of goals[side]) {
          expect(() => parseSquare(name)).not.toThrow();
        }
      }
    }
  });

  it('turns neutrals on only in the Neutrals variant, capture-only', () => {
    expect(VARIANTS.original.neutrals).toBe(false);
    expect(VARIANTS.corner2x2.neutrals).toBe(false);
    expect(VARIANTS.neutrals.neutrals).toEqual({ captureOnly: true });
  });

  it('rejects an unknown variant id', () => {
    // @ts-expect-error — deliberately outside VariantId
    expect(() => getVariant('crazyhouse')).toThrow();
  });
});
