// Variants are data, never separate code paths — spec 5.
//
// Never mutate a shipped variant. A rules change gets a new rulesVersion, so
// saved games and, later, ratings stay interpretable.

import type { VariantConfig, VariantId } from './types.js';

const STANDARD_START = '9/4PR3/4SPR2/5SPR1/1ps3SP1/1rps5/2rps4/3rp4/9 blue';
const NEUTRALS_START = '9/4PR3/2nP1SPR2/5SPR1/1ps1nS1SP1/1rps5/2rps1nP2/3rp4/9 blue';

export const VARIANTS: Record<VariantId, VariantConfig> = {
  original: {
    id: 'original',
    name: 'Original',
    rulesVersion: 1,
    start: STANDARD_START,
    goals: { blue: ['i9'], red: ['a1'] },
    neutrals: false,
    draw: { repetitions: 3, maxPlies: 300 },
  },
  corner2x2: {
    id: 'corner2x2',
    name: '2×2 Corner',
    rulesVersion: 1,
    start: STANDARD_START,
    goals: { blue: ['h8', 'i8', 'h9', 'i9'], red: ['a1', 'b1', 'a2', 'b2'] },
    neutrals: false,
    draw: { repetitions: 3, maxPlies: 300 },
  },
  neutrals: {
    id: 'neutrals',
    name: 'Neutrals',
    rulesVersion: 1,
    start: NEUTRALS_START,
    goals: { blue: ['i9'], red: ['a1'] },
    neutrals: { captureOnly: true },
    draw: { repetitions: 3, maxPlies: 300 },
  },
};

export const VARIANT_IDS = Object.keys(VARIANTS) as VariantId[];

/** One-line description for the variant cards — spec 10.1. */
export const VARIANT_BLURBS: Record<VariantId, string> = {
  original: 'Ten pieces, king moves, first to the enemy corner.',
  corner2x2: 'A bigger target: reach any of four corner squares. Faster games.',
  neutrals: 'Three pieces belong to nobody. Either player can use one — but only to capture.',
};

export function getVariant(id: VariantId): VariantConfig {
  const variant = VARIANTS[id];
  if (!variant) throw new Error(`Unknown variant: ${id}`);
  return variant;
}
