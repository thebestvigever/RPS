// Themes and player-colour swatches — docs/VISUAL_SYSTEM.md 1, 3 and 4, spec 10.3.
//
// Values below are copied from docs/VISUAL_SYSTEM.md 3's tables, which
// corrected the handoff's: its "default side A/B" table and its
// theme-independent swatch list disagreed, and six of the twenty-four
// combinations that resulted broke the spec's own 3:1 floor — including both
// defaults it offered, on Signal, where the near-black swatch measured
// 1.04:1. `test/contrast.test.ts` re-derives every number here so a future
// palette edit cannot reintroduce that silently.
//
// M3 ships Field Notes only (docs/VISUAL_SYSTEM.md 8). The other two are
// filled in now anyway: they cost nothing as data, they are what the gate 1
// test in 9 checks, and switching later is then a data drop rather than a
// rewrite.

export type ThemeId = 'field-notes' | 'signal' | 'tabletop';

export const THEME_IDS: readonly ThemeId[] = ['field-notes', 'signal', 'tabletop'];

export interface ThemeFonts {
  /** Interface text and numbers. */
  body: string;
  /** Notation, coordinates, counts — every number (README 1). */
  mono: string;
  /** Names and results. Only Tabletop splits this from `body` (README 1). */
  heading: string;
}

export interface ThemeTokens {
  name: string;
  description: string;
  /** Outer frame, behind the board and panels. */
  page: string;
  /** Panel background. Same as `square` except on Tabletop (VISUAL_SYSTEM 11). */
  panel: string;
  /** Board square fill. */
  square: string;
  /** Grid line, always drawn at 1px regardless of board size (README 1). */
  grid: string;
  ink: string;
  muted: string;
  /** "Last one" / danger colour. */
  alert: string;
  /** Neutral-piece fill (Neutrals variant only). */
  neutral: string;
  /** Board corner radius in CSS px, at the reference sizes in README 1. */
  radiusPx: number;
  fonts: ThemeFonts;
}

export const THEMES: Record<ThemeId, ThemeTokens> = {
  'field-notes': {
    name: 'Field Notes',
    description: 'Analytical paper-and-ink. Reads like a studied position.',
    page: '#FBFAF6',
    panel: '#F4F2EC',
    square: '#F4F2EC',
    grid: '#CFC9B8',
    ink: '#1E1E1C',
    muted: '#65625A',
    alert: '#B0781C',
    neutral: '#7A7F87',
    radiusPx: 0,
    fonts: {
      body: "'IBM Plex Sans', system-ui, sans-serif",
      mono: "'IBM Plex Mono', ui-monospace, monospace",
      heading: "'IBM Plex Sans', system-ui, sans-serif",
    },
  },
  signal: {
    name: 'Signal',
    description: 'Dark, luminous, arcade-clean. The board glows where it matters.',
    page: '#0E1116',
    panel: '#161A21',
    square: '#161A21',
    grid: '#242B36',
    ink: '#E8ECF2',
    muted: '#9AA3B1',
    alert: '#F2C14E',
    neutral: '#96A0AE',
    radiusPx: 14,
    fonts: {
      body: "'Space Grotesk', system-ui, sans-serif",
      mono: "'JetBrains Mono', ui-monospace, monospace",
      heading: "'Space Grotesk', system-ui, sans-serif",
    },
  },
  tabletop: {
    name: 'Tabletop',
    description: 'Warm, physical, heirloom board game. Pieces feel picked up.',
    page: '#F3EBDD',
    panel: '#FBF6EC',
    square: '#E6D9C4',
    grid: '#CDB795',
    ink: '#2B241C',
    muted: '#6E6153',
    alert: '#9A7318',
    neutral: '#8B8072',
    radiusPx: 16,
    fonts: {
      body: "'Karla', system-ui, sans-serif",
      mono: "'IBM Plex Mono', ui-monospace, monospace",
      heading: "'Instrument Serif', Georgia, serif",
    },
  },
};

export function theme(id: ThemeId): ThemeTokens {
  const tokens = THEMES[id];
  if (!tokens) throw new Error(`Unknown theme: ${id}`);
  return tokens;
}

/**
 * Player-set piece colours (spec 10.3, "player-set colours"), per theme so
 * every offered swatch clears the theme's own board-square contrast — the
 * handoff offered one list for all three themes and six combinations broke
 * the floor. First in each list is the theme's default.
 */
export interface Swatches {
  you: readonly string[];
  opponent: readonly string[];
}

export const SWATCHES: Record<ThemeId, Swatches> = {
  'field-notes': {
    you: ['#2F5AA8', '#2E7D6B', '#6B4FA8', '#1E1E1C'],
    opponent: ['#B23A2E', '#9A5A11', '#A8347A', '#6E6A5E'],
  },
  signal: {
    you: ['#4CC2F5', '#5FD3A8', '#A98CF0', '#E8ECF2'],
    opponent: ['#F57A6E', '#ED9152', '#EE7FC4', '#A9A296'],
  },
  tabletop: {
    you: ['#36497E', '#2A6B57', '#5B3F87', '#1E1E1C'],
    opponent: ['#A8503A', '#8A5A10', '#8E2F66', '#5C5B57'],
  },
};

/** Fraction alpha for a corner's ownership tint (README 2: "14% alpha"). */
export const CORNER_TINT_ALPHA = 0.14;

/** Fraction alpha for the last move's origin/destination highlight (spec 10.5). */
export const LAST_MOVE_TINT_ALPHA = 0.1;
