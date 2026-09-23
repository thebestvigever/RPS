// Spec 10.13: "Wrap every read and write in try/catch; the game MUST work
// when storage is unavailable." Both halves of that are tested here — the
// round trip when a store exists, and that every loader still returns a
// usable default when it doesn't (the suite's own Node environment has no
// `localStorage` at all, which makes that half of the contract free to check).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@sps/match';
import {
  clearInProgressGame,
  loadInProgressGame,
  loadSettings,
  loadStats,
  loadTutorialProgress,
  saveInProgressGame,
  saveSettings,
  saveStats,
  saveTutorialProgress,
} from '../src/storage.js';
import type { PersistedGame } from '../src/storage.js';

describe('storage when localStorage is unavailable (spec 10.13)', () => {
  it('every loader falls back to a usable default rather than throwing', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadStats()).toEqual({});
    expect(loadInProgressGame()).toBeNull();
    expect(loadTutorialProgress()).toEqual([]);
  });

  it('every saver is a no-op rather than throwing', () => {
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
    expect(() => saveStats({})).not.toThrow();
    expect(() => saveTutorialProgress([1, 3])).not.toThrow();
    expect(() => clearInProgressGame()).not.toThrow();
  });
});

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe('storage with a real store', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('round-trips settings', () => {
    saveSettings({ ...DEFAULT_SETTINGS, zen: true, sound: false });
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, zen: true, sound: false });
  });

  it('a settings blob missing newer fields still loads with defaults for them', () => {
    localStorage.setItem('sps.settings.v1', JSON.stringify({ zen: true }));
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, zen: true });
  });

  it('round-trips an in-progress game, including an unlimited clock\'s Infinity', () => {
    const game: PersistedGame = {
      variant: 'original',
      controlId: 'unlimited',
      computer: { side: 'red', level: 'medium' },
      names: {},
      history: ['Pb5-b6'],
      clockStack: [
        {
          control: { id: 'unlimited', name: 'Unlimited', unlimited: true, stages: [{ moves: null, baseMs: 0, bonus: { kind: 'none', ms: 0 } }] },
          remainingMs: { blue: Infinity, red: Infinity },
          stageIndex: { blue: 0, red: 0 },
          movesInStage: { blue: 0, red: 0 },
          running: 'blue',
          pausedSide: null,
          since: 1000,
          elapsedThisTurnMs: 0,
          flagged: null,
          gifts: [],
        },
        {
          control: { id: 'unlimited', name: 'Unlimited', unlimited: true, stages: [{ moves: null, baseMs: 0, bonus: { kind: 'none', ms: 0 } }] },
          remainingMs: { blue: Infinity, red: Infinity },
          stageIndex: { blue: 0, red: 0 },
          movesInStage: { blue: 0, red: 0 },
          running: 'red',
          pausedSide: null,
          since: 2000,
          elapsedThisTurnMs: 0,
          flagged: null,
          gifts: [],
        },
      ],
    };
    saveInProgressGame(game);
    const loaded = loadInProgressGame();
    expect(loaded).toEqual(game);
    expect(loaded!.clockStack[0]!.remainingMs.blue).toBe(Infinity);
  });

  it('a hand-edited blob with mismatched history/clock lengths loads as absent', () => {
    localStorage.setItem(
      'sps.game.v1',
      JSON.stringify({ variant: 'original', controlId: '10+5', computer: null, names: {}, history: ['a', 'b'], clockStack: [] }),
    );
    expect(loadInProgressGame()).toBeNull();
  });

  it('clearing removes it', () => {
    localStorage.setItem('sps.game.v1', '{}');
    clearInProgressGame();
    expect(localStorage.getItem('sps.game.v1')).toBeNull();
  });

  it('round-trips tutorial progress, de-duplicated and sorted', () => {
    saveTutorialProgress([3, 1, 3]);
    expect(loadTutorialProgress()).toEqual([1, 3]);
  });
});
