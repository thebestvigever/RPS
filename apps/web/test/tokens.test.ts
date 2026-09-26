// The app's chrome tokens, checked the way @sps/board's swatches already are
// (docs/VISUAL_SYSTEM.md 9, gate 1) — now once per theme, not once for a
// light/dark pair. This used to parse `:root` and a `prefers-color-scheme`
// media query out of styles.css by regex; now that every theme's values live
// in theme-tokens.ts as data (apps/web/src/theme-tokens.ts), the gate reads
// that data directly, the same way packages/board/test/contrast.test.ts
// reads THEMES/SWATCHES rather than re-parsing rendered SVG.
//
// It still catches the same class of bug this file was written for: four of
// the five filled accents were once below WCAG AA (spec 10.10), the worst
// being white on a hovered blue button at 2.52:1. That is also why the last
// test below still parses the stylesheets — a hard-coded `color: white` on a
// filled accent is invisible to token-level checks, since nothing here stops
// a stylesheet from ignoring `--on-fill` altogether.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { THEME_IDS, contrastRatio } from '@sps/board';
import { chromeTokens } from '../src/theme-tokens.js';

/** WCAG AA for normal-size text (spec 10.10). The board's pieces use a separate 3:1 floor. */
const AA = 4.5;

const STYLESHEETS = ['styles.css', 'game.css', 'online.css', 'settings.css', 'tutorial.css'];

describe('app chrome tokens clear WCAG AA (spec 10.10)', () => {
  for (const id of THEME_IDS) {
    const t = chromeTokens(id);

    it(`${id}: accent, danger and alert are legible as text on the page and on panels`, () => {
      for (const key of ['accent', 'danger', 'alert'] as const) {
        expect(contrastRatio(t[key], t.page), `${id} --${key} on --page`).toBeGreaterThanOrEqual(AA);
        expect(contrastRatio(t[key], t.panel), `${id} --${key} on --panel`).toBeGreaterThanOrEqual(AA);
      }
    });

    it(`${id}: --on-fill carries accent, danger and alert as filled backgrounds`, () => {
      // The regression this file exists for: `.play`, the running clock chip,
      // the critical/low chips and the selected move all paint --on-fill on
      // one of these. One foreground has to work on all three per theme.
      for (const key of ['accent', 'danger', 'alert'] as const) {
        expect(contrastRatio(t.onFill, t[key]), `${id} --on-fill on --${key}`).toBeGreaterThanOrEqual(AA);
      }
    });

    it(`${id}: body text and muted text are legible`, () => {
      expect(contrastRatio(t.ink, t.page), `${id} --ink on --page`).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(t.muted, t.page), `${id} --muted on --page`).toBeGreaterThanOrEqual(AA);
    });
  }

  it('no stylesheet hard-codes a foreground on a filled accent', () => {
    // `color: white` is how this broke: it reads as obviously-correct on one
    // theme's accent and is wrong on whichever theme has a lighter one.
    for (const file of STYLESHEETS) {
      const css = readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), 'utf8');
      expect(css, file).not.toMatch(/color:\s*(white|#fff\b|#ffffff)\s*;/i);
    }
  });

  it("styles.css's static :root fallback matches Field Notes — the theme it stands in for until JS runs", () => {
    // apply-theme.ts overwrites this block on every load (main.tsx, before
    // React's first render) and every theme change, so a mismatch here is
    // invisible in normal use — it would only ever show as a flash of the
    // wrong colours for a returning player before JS finishes hydrating, or
    // the only colours a player with JS disabled ever sees. Parsed rather
    // than eyeballed, so a hand-edit to either side can't drift from the other.
    const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8');
    const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const fallback: Record<string, string> = {};
    for (const [, name, value] of root.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
      fallback[name!] = value!.toLowerCase();
    }
    const fieldNotes = chromeTokens('field-notes');
    const expected: Record<string, string> = {
      accent: fieldNotes.accent,
      danger: fieldNotes.danger,
      alert: fieldNotes.alert,
      panel: fieldNotes.panel,
      'panel-alt': fieldNotes.panelAlt,
      grid: fieldNotes.grid,
      ink: fieldNotes.ink,
      page: fieldNotes.page,
      muted: fieldNotes.muted,
      'on-fill': fieldNotes.onFill,
    };
    for (const [name, value] of Object.entries(expected)) {
      expect(fallback[name], `--${name} in styles.css :root`).toBe(value.toLowerCase());
    }
  });
});
