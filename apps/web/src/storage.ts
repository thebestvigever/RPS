// localStorage — spec 10.13: "settings, the in-progress game record... and
// local stats. Wrap every read and write in try/catch; the game MUST work
// when storage is unavailable."
//
// Every function here follows that rule itself: a private browsing tab that
// throws on `localStorage.setItem`, a quota that's full, or `localStorage`
// simply not existing (this module runs the same in Vitest's Node
// environment) all fall back to doing nothing rather than crashing the app.
// Nothing outside this file needs to know which of those happened — a load
// that fails just returns null, same as a key that was never set.

import type { DisplaySettings } from '@sps/match';
import type { ClockState } from '@sps/match';
import { DEFAULT_SETTINGS } from '@sps/match';
import type { Level } from '@sps/ai';
import type { Side, VariantId } from '@sps/engine';
import type { SideNames, ThemeId } from '@sps/board';
import { THEME_IDS } from '@sps/board';
import type { Stats } from './stats.js';

const KEYS = {
  settings: 'sps.settings.v1',
  stats: 'sps.stats.v1',
  game: 'sps.game.v1',
  tutorial: 'sps.tutorial.v1',
  theme: 'sps.theme.v1',
} as const;

/** `ClockState.remainingMs` is `Infinity` for an unlimited control, which `JSON.stringify` turns into `null`. Round-tripped through a sentinel instead of losing it outright. */
const INFINITY_SENTINEL = '__Infinity__';

function replacer(_key: string, value: unknown): unknown {
  return value === Infinity ? INFINITY_SENTINEL : value;
}

function reviver(_key: string, value: unknown): unknown {
  return value === INFINITY_SENTINEL ? Infinity : value;
}

function readJSON<T>(key: string): T | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw, reviver) as T;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value, replacer));
  } catch {
    // Quota exceeded, storage disabled, or a private-mode browser that
    // throws on write — the game keeps running without persistence.
  }
}

function removeItem(key: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  } catch {
    // Nothing to do — if remove fails, the next load will just overwrite it.
  }
}

// --- Settings (spec 10.13's first item) -------------------------------------

/** Merged with `DEFAULT_SETTINGS` so a settings blob saved before a new field existed still loads with a sane value for it. */
export function loadSettings(): DisplaySettings {
  const saved = readJSON<Partial<DisplaySettings>>(KEYS.settings);
  if (!saved) return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...saved, aids: { ...DEFAULT_SETTINGS.aids, ...saved.aids } };
}

export function saveSettings(settings: DisplaySettings): void {
  writeJSON(KEYS.settings, settings);
}

// --- Local stats (spec 10.7) ------------------------------------------------

export function loadStats(): Stats {
  return readJSON<Stats>(KEYS.stats) ?? {};
}

export function saveStats(stats: Stats): void {
  writeJSON(KEYS.stats, stats);
}

// --- Resume-after-reload (spec 10.13's second item) -------------------------

export interface PersistedGame {
  variant: VariantId;
  controlId: string;
  computer: { side: Side; level: Level } | null;
  names: SideNames;
  history: string[];
  /** `clockStack[n]` is the clock as it stood after n moves — the same shape `Game.tsx` already keeps live, so resuming reuses `rewind`/`startTurn` rather than a second reconstruction. */
  clockStack: ClockState[];
}

const VARIANT_IDS: readonly VariantId[] = ['original', 'corner2x2', 'neutrals'];

/** Loose validation: a corrupted or hand-edited blob is treated as absent rather than crashing the resume path. */
function isPersistedGame(value: unknown): value is PersistedGame {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<PersistedGame>;
  return (
    typeof v.variant === 'string' &&
    VARIANT_IDS.includes(v.variant as VariantId) &&
    typeof v.controlId === 'string' &&
    Array.isArray(v.history) &&
    Array.isArray(v.clockStack) &&
    v.clockStack.length === v.history.length + 1
  );
}

export function loadInProgressGame(): PersistedGame | null {
  const saved = readJSON<unknown>(KEYS.game);
  return isPersistedGame(saved) ? saved : null;
}

export function saveInProgressGame(game: PersistedGame): void {
  writeJSON(KEYS.game, game);
}

export function clearInProgressGame(): void {
  removeItem(KEYS.game);
}

// --- Appearance (theme) -------------------------------------------------------
//
// Deliberately its own key, not folded into `settings`: docs/VISUAL_SYSTEM.md
// 7 draws a hard line between `DisplaySettings` ("what the game shows" —
// packages/match, tested, readable by a server later) and an app-only
// Appearance ("what it looks like" — colour choices, which never leave the
// device). Piece family isn't here because only Cut stone is built
// (packages/board/src/families.ts) — there is nothing yet to pick.

const DEFAULT_THEME: ThemeId = 'field-notes';

export function loadThemeId(): ThemeId {
  const saved = readJSON<ThemeId>(KEYS.theme);
  return saved && THEME_IDS.includes(saved) ? saved : DEFAULT_THEME;
}

export function saveThemeId(theme: ThemeId): void {
  writeJSON(KEYS.theme, theme);
}

// --- Tutorial progress -------------------------------------------------------

/** Which puzzle numbers (1-6) have been solved at least once. */
export function loadTutorialProgress(): number[] {
  const saved = readJSON<number[]>(KEYS.tutorial);
  return Array.isArray(saved) ? saved.filter((n) => typeof n === 'number') : [];
}

export function saveTutorialProgress(solved: readonly number[]): void {
  writeJSON(KEYS.tutorial, [...new Set(solved)].sort((a, b) => a - b));
}
