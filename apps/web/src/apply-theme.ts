// The one place the app's theme actually touches the DOM. @sps/board stays
// pure per CLAUDE.md ("no DOM, no dependencies"); `theme-tokens.ts` stays
// pure the same way. Everything here is the opposite on purpose: reading
// `document`, writing custom properties, injecting a stylesheet link.
//
// Called from two places, deliberately: once synchronously in `main.tsx`,
// before React ever renders, so the very first paint is already the saved
// theme rather than a flash of `styles.css`'s static fallback; and again
// from `App.tsx`'s effect on every theme change afterwards.

import type { ThemeId } from '@sps/board';
import { CHROME_TOKEN_CSS_VAR, chromeTokens } from './theme-tokens.js';

/** Writes every chrome token as a CSS custom property on `document.documentElement`. */
export function applyTheme(id: ThemeId): void {
  const tokens = chromeTokens(id);
  const root = document.documentElement.style;
  for (const [key, cssVar] of Object.entries(CHROME_TOKEN_CSS_VAR) as Array<
    [keyof typeof tokens, string]
  >) {
    root.setProperty(cssVar, tokens[key]);
  }
}

/**
 * docs/VISUAL_SYSTEM.md 4: "Fonts load per theme, never eagerly... a theme
 * switch fetches its own." Six families across three themes is wasteful on
 * the mid-range Android targets spec 11.7 names, so this replaces rather
 * than accumulates: one `<link>`, swapped on every call, never stacked.
 *
 * Field Notes and Signal only need two families (`heading` repeats `body`);
 * Tabletop needs all three, Instrument Serif included. Requesting a weight a
 * family doesn't ship (Instrument Serif is 400 only) costs nothing — the
 * font service just omits it.
 */
const THEME_FONT_FAMILIES: Record<ThemeId, ReadonlyArray<{ name: string; weights: string }>> = {
  'field-notes': [
    { name: 'IBM Plex Sans', weights: '400;600;700' },
    { name: 'IBM Plex Mono', weights: '400;700' },
  ],
  signal: [
    { name: 'Space Grotesk', weights: '400;600;700' },
    { name: 'JetBrains Mono', weights: '400;700' },
  ],
  tabletop: [
    { name: 'Karla', weights: '400;600;700' },
    { name: 'IBM Plex Mono', weights: '400;700' },
    { name: 'Instrument Serif', weights: '400' },
  ],
};

const FONT_LINK_ID = 'theme-fonts';

function fontsUrl(id: ThemeId): string {
  const families = THEME_FONT_FAMILIES[id]
    .map(({ name, weights }) => `family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@${weights}`)
    .join('&');
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

export function loadThemeFonts(id: ThemeId): void {
  const href = fontsUrl(id);
  const existing = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
  if (existing?.href === href) return; // already the active theme's fonts
  const link = existing ?? document.createElement('link');
  link.id = FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.href = href;
  if (!existing) document.head.appendChild(link);
}
