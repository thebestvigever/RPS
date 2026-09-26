// The app chrome's own theming — the counterpart to @sps/board's themes.ts
// for everything that ISN'T the board: buttons, panels, clock chips, the
// move list, Settings itself. Pure data, same discipline as themes.ts (no
// DOM, checked by apps/web/test/tokens.test.ts the same way the board's
// swatches are checked by packages/board/test/contrast.test.ts).
//
// This does not live in @sps/board on purpose: the board package's own
// contract is "(position, settings, appearance) -> SVG"
// (docs/VISUAL_SYSTEM.md 4) — none of what's below reaches the SVG
// renderer, so it stays app-only rather than widening that package's scope.
//
// `page`, `panel`, `grid`, `ink` and `muted` are read straight from
// @sps/board's THEMES — they already mean the same thing here that they
// mean on the board. Three tokens don't have a board equivalent and are
// derived here, each for a reason the board never had to solve:
//
//   accent  Primary/"your" chrome colour (the play button, focus rings,
//           the running clock chip). Can't reuse SWATCHES[id].you[0] live —
//           that's the player's own customisable piece colour (spec 10.3)
//           — but its theme DEFAULT is exactly this identity already, so
//           it's reused as a fixed constant: same hue the board opens with,
//           immune to whatever the player later picks for their pieces.
//   danger  Same reasoning, opponent[0]: the resign button, the critical
//           clock chip, the opponent's own panel dot.
//   alert   themes.ts's `alert` only has to clear the board's 3:1 floor
//           (spec 10.3) against a SQUARE. Used as chrome TEXT it needs
//           WCAG AA's 4.5:1 (spec 10.10) against the lighter PAGE/PANEL —
//           Field Notes and Tabletop's board-tuned value falls short there
//           (3.62:1 / 3.67:1), so chrome gets its own darkened variant,
//           the same fix apps/web/src/styles.css already made once for the
//           old two-theme --alert before this file existed. Signal's clears
//           both floors unchanged.
//
// `onFill` (what sits on a filled accent/danger/alert) and `panelAlt` (the
// hover/pressed tint `--square-alt` used to be) have no board equivalent at
// all — the board never paints text on a piece or hovers a square.
//
// Every value below is measured with @sps/board's own `contrastRatio`;
// apps/web/test/tokens.test.ts re-derives every number so a future palette
// edit can't reintroduce a failure silently, exactly like
// packages/board/test/contrast.test.ts does for the swatches.

import { SWATCHES, THEMES } from '@sps/board';
import type { ThemeId } from '@sps/board';

export interface ChromeTokens {
  page: string;
  panel: string;
  /** Hover/pressed surface — a step darker than `panel` in every theme. */
  panelAlt: string;
  grid: string;
  ink: string;
  muted: string;
  /** Primary/"your" accent — the theme's default "you" swatch, fixed. */
  accent: string;
  /** Opponent/critical accent — the theme's default "opponent" swatch, fixed. */
  danger: string;
  /** Text-safe variant of the board's `alert` (see header comment). */
  alert: string;
  /** Foreground that clears AA on `accent`, `danger` AND `alert` as fills. */
  onFill: string;
  fontBody: string;
  fontMono: string;
  fontHeading: string;
}

/**
 * Chrome-only overrides that can't be read straight off `THEMES`: the
 * text-safe `alert` (see header) and the `onFill` each theme's accents
 * actually need (light fills want a dark foreground, dark fills a light
 * one — same split @sps/board's own swatches make between light and dark
 * boards).
 */
const CHROME_OVERRIDES: Record<ThemeId, { alert: string; onFill: string }> = {
  'field-notes': { alert: '#946518', onFill: '#FFFFFF' },
  signal: { alert: '#F2C14E', onFill: '#0E1116' },
  tabletop: { alert: '#886515', onFill: '#FFFFFF' },
};

/**
 * How much darker `panelAlt` is than `panel`, per theme. Not one constant:
 * Signal's `panel` sits so close to black that a light theme's percentage
 * left it indistinguishable from `panel` on hover — it needs a bigger step
 * to read as a step at all.
 */
const PANEL_ALT_DARKEN_PERCENT: Record<ThemeId, number> = {
  'field-notes': 6,
  signal: 18,
  tabletop: 6,
};

function darken(hex: string, percent: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Not a 6-digit hex colour: "${hex}"`);
  const value = match[1]!;
  const factor = 1 - percent / 100;
  const channel = (start: number) => {
    const n = Math.round(parseInt(value.slice(start, start + 2), 16) * factor);
    return Math.min(255, Math.max(0, n)).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(2)}${channel(4)}`.toUpperCase();
}

function buildChromeTokens(id: ThemeId): ChromeTokens {
  const t = THEMES[id];
  const sw = SWATCHES[id];
  const overrides = CHROME_OVERRIDES[id];
  return {
    page: t.page,
    panel: t.panel,
    panelAlt: darken(t.panel, PANEL_ALT_DARKEN_PERCENT[id]),
    grid: t.grid,
    ink: t.ink,
    muted: t.muted,
    accent: sw.you[0]!,
    danger: sw.opponent[0]!,
    alert: overrides.alert,
    onFill: overrides.onFill,
    fontBody: t.fonts.body,
    fontMono: t.fonts.mono,
    fontHeading: t.fonts.heading,
  };
}

export const CHROME_TOKENS: Record<ThemeId, ChromeTokens> = {
  'field-notes': buildChromeTokens('field-notes'),
  signal: buildChromeTokens('signal'),
  tabletop: buildChromeTokens('tabletop'),
};

export function chromeTokens(id: ThemeId): ChromeTokens {
  return CHROME_TOKENS[id];
}

/** The CSS custom property each `ChromeTokens` field maps to, applied to `document.documentElement` by `apply-theme.ts`. */
export const CHROME_TOKEN_CSS_VAR: Record<keyof ChromeTokens, string> = {
  page: '--page',
  panel: '--panel',
  panelAlt: '--panel-alt',
  grid: '--grid',
  ink: '--ink',
  muted: '--muted',
  accent: '--accent',
  danger: '--danger',
  alert: '--alert',
  onFill: '--on-fill',
  fontBody: '--font-body',
  fontMono: '--font-mono',
  fontHeading: '--font-heading',
};
