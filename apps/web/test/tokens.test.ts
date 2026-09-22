// The app's chrome tokens, checked the way @sps/board's swatches already are
// (docs/VISUAL_SYSTEM.md 9, gate 1). That gate covers the BOARD's colours;
// nothing covered the buttons, chips and counts around it, and four of the
// five filled accents were below WCAG AA (spec 10.10) — two of them in the
// light theme, not just dark. The worst was the primary button: white on the
// dark theme's `--blue` measured 2.52:1.
//
// It parses the stylesheet rather than duplicating the values, so there is
// one place a colour is written down and this cannot drift from it. That is
// also what makes it a real gate: the next `color: white` on a filled accent
// fails here rather than shipping.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@sps/board';

/** WCAG AA for normal-size text (spec 10.10). The board's pieces use a separate 3:1 floor. */
const AA = 4.5;

const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8');

/**
 * The tokens as each theme actually resolves them: `:root` first, then the
 * dark block overriding what it names. Mirrors the cascade rather than
 * assuming the dark block redeclares everything.
 */
function tokens(theme: 'light' | 'dark'): Record<string, string> {
  const blocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]!);
  const darkStart = css.indexOf('prefers-color-scheme: dark');
  const inDark = (index: number) => darkStart !== -1 && index > darkStart;

  const resolved: Record<string, string> = {};
  let cursor = 0;
  for (const block of blocks) {
    const at = css.indexOf(block, cursor);
    cursor = at + block.length;
    if (inDark(at) && theme === 'light') continue;
    for (const [, name, value] of block.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
      resolved[name!] = value!;
    }
  }
  return resolved;
}

describe('app colour tokens clear WCAG AA (spec 10.10)', () => {
  for (const theme of ['light', 'dark'] as const) {
    const t = tokens(theme);

    it(`${theme}: every accent is legible as text on the page`, () => {
      for (const accent of ['blue', 'red', 'alert'] as const) {
        expect(t[accent], `--${accent} is missing`).toBeDefined();
        expect(contrastRatio(t[accent]!, t.paper!), `--${accent} text on --paper`).toBeGreaterThanOrEqual(AA);
      }
    });

    it(`${theme}: every accent carries --on-fill when used as a filled background`, () => {
      // The regression this file exists for: `.play`, the running clock chip,
      // the low/critical chips and the selected move all paint --on-fill on
      // one of these. One foreground has to work on all three per theme.
      expect(t['on-fill'], '--on-fill is missing').toBeDefined();
      for (const accent of ['blue', 'red', 'alert'] as const) {
        expect(
          contrastRatio(t['on-fill']!, t[accent]!),
          `--on-fill on --${accent}`,
        ).toBeGreaterThanOrEqual(AA);
      }
    });

    it(`${theme}: body text and muted text are legible`, () => {
      expect(contrastRatio(t.ink!, t.paper!)).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(t.muted!, t.paper!)).toBeGreaterThanOrEqual(AA);
    });
  }

  it('no stylesheet hard-codes a foreground on a filled accent', () => {
    // `color: white` is how this broke: it reads as obviously-correct on a
    // blue button and is wrong in whichever theme has the light accent.
    const sheets = ['../src/styles.css', '../src/game.css'].map((path) =>
      readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'),
    );
    for (const sheet of sheets) {
      expect(sheet).not.toMatch(/color:\s*(white|#fff\b|#ffffff)\s*;/i);
    }
  });
});
