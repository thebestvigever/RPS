// Gates 1 and 3 (docs/VISUAL_SYSTEM.md 9): every shipped swatch clears the
// spec's 3:1 floor against every theme's board square, and `dotAlpha` always
// finds an alpha that does too. These would have caught six of the handoff's
// twenty-four colour combinations and its fixed 55% dot alpha.

import { describe, expect, it } from 'vitest';
import {
  CONTRAST_FLOOR,
  composite,
  contrastRatio,
  dotAlpha,
  isConfusablePair,
  passesFloor,
} from '../src/contrast.js';
import { SWATCHES, THEMES, THEME_IDS } from '../src/themes.js';

describe('contrastRatio', () => {
  it('is 21:1 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('is 1:1 for identical colours', () => {
    expect(contrastRatio('#2f5aa8', '#2f5aa8')).toBeCloseTo(1, 5);
  });

  it("does not care which colour is passed first", () => {
    expect(contrastRatio('#2f5aa8', '#f4f2ec')).toBeCloseTo(contrastRatio('#f4f2ec', '#2f5aa8'), 5);
  });

  it('matches the values docs/VISUAL_SYSTEM.md 3 reports for the corrected swatches', () => {
    // Field Notes default "you" against its square.
    expect(contrastRatio('#2F5AA8', '#F4F2EC')).toBeCloseTo(5.96, 1);
    // Signal's near-black swatch, which the handoff offered as a default and
    // which measured 1.04:1 there.
    expect(contrastRatio('#1E1E1C', '#161A21')).toBeCloseTo(1.04, 1);
  });
});

describe('gate 1 — every shipped swatch clears the floor', () => {
  for (const themeId of THEME_IDS) {
    const square = THEMES[themeId].square;
    const swatches = SWATCHES[themeId];

    for (const role of ['you', 'opponent'] as const) {
      for (const color of swatches[role]) {
        it(`${themeId} / ${role} / ${color} clears ${CONTRAST_FLOOR}:1 against ${square}`, () => {
          expect(passesFloor(color, square)).toBe(true);
        });
      }
    }
  }
});

describe('gate 1 — the handoff\'s broken combinations are rejected, not silently allowed', () => {
  it('Signal square rejects the handoff\'s original defaults', () => {
    // #2F5AA8 (2.62:1) and #B23A2E (2.94:1) were the handoff's own defaults
    // for "you" and "opponent" on Signal; both fail the floor, which is why
    // neither is in SWATCHES.signal.
    expect(passesFloor('#2F5AA8', THEMES.signal.square)).toBe(false);
    expect(passesFloor('#B23A2E', THEMES.signal.square)).toBe(false);
    expect(SWATCHES.signal.you).not.toContain('#2F5AA8');
    expect(SWATCHES.signal.opponent).not.toContain('#B23A2E');
  });

  it('Tabletop square rejects the handoff\'s #C77A18', () => {
    expect(passesFloor('#C77A18', THEMES.tabletop.square)).toBe(false);
    expect(SWATCHES.tabletop.you).not.toContain('#C77A18');
    expect(SWATCHES.tabletop.opponent).not.toContain('#C77A18');
  });
});

describe('composite', () => {
  it('at alpha 1 is the foreground colour', () => {
    expect(composite('#2f5aa8', '#f4f2ec', 1)).toBe('#2f5aa8');
  });

  it('at alpha 0 is the background colour', () => {
    expect(composite('#2f5aa8', '#f4f2ec', 0)).toBe('#f4f2ec');
  });
});

describe('gate 3 — dotAlpha always reaches the floor', () => {
  it("the handoff's fixed 55% alpha fails the floor for two of the three defaults", () => {
    // README 2's legal-move dot: "colour at 55%". Field Notes and Tabletop's
    // defaults need more than that (VISUAL_SYSTEM 3: 2.42:1 and 2.46:1 at
    // .55); Signal's default happens to clear it anyway, only because Signal
    // starts from much higher contrast (8.59:1 at full opacity) — a fixed
    // constant getting one theme right by chance is exactly why this has to
    // be derived per colour rather than picked once.
    expect(passesFloor(composite(SWATCHES['field-notes'].you[0]!, THEMES['field-notes'].square, 0.55), THEMES['field-notes'].square)).toBe(false);
    expect(passesFloor(composite(SWATCHES.tabletop.you[0]!, THEMES.tabletop.square, 0.55), THEMES.tabletop.square)).toBe(false);
    expect(passesFloor(composite(SWATCHES.signal.you[0]!, THEMES.signal.square, 0.55), THEMES.signal.square)).toBe(true);
  });

  for (const themeId of THEME_IDS) {
    const square = THEMES[themeId].square;
    const swatches = SWATCHES[themeId];

    for (const role of ['you', 'opponent'] as const) {
      for (const color of swatches[role]) {
        it(`${themeId} / ${role} / ${color}: dotAlpha reaches the floor and stays <= 1`, () => {
          const alpha = dotAlpha(color, square);
          expect(alpha).toBeGreaterThanOrEqual(0.55);
          expect(alpha).toBeLessThanOrEqual(1);
          expect(passesFloor(composite(color, square, alpha), square)).toBe(true);
        });
      }
    }
  }
});

describe('isConfusablePair', () => {
  it('flags two close saturated hues at low contrast', () => {
    // A nudge of #B23A2E toward white: same red hue family, close enough in
    // luminance to be easy to mistake for one another at a glance.
    expect(isConfusablePair('#B23A2E', '#A85A4E')).toBe(true);
  });

  it('does not flag hues that are far apart', () => {
    expect(isConfusablePair('#2F5AA8', '#B23A2E')).toBe(false);
  });

  it('no shipped you/opponent pair on any theme is confusable', () => {
    for (const themeId of THEME_IDS) {
      const { you, opponent } = SWATCHES[themeId];
      for (const a of you) {
        for (const b of opponent) {
          expect(isConfusablePair(a, b), `${themeId}: ${a} vs ${b}`).toBe(false);
        }
      }
    }
  });
});
