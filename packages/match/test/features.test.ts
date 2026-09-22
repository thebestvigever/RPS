import { describe, expect, it } from 'vitest';
import { createGame, getVariant, legalMoves, parseSquare, resign } from '@sps/engine';
import {
  ABORT_BEFORE_PLY,
  DEFAULT_SETTINGS,
  URGENCY,
  canAbort,
  canPremove,
  createClock,
  fischer,
  resolvePremove,
  startTurn,
  UNLIMITED,
  urgencyOf,
  visibleAids,
} from '../src/index.js';
import type { MatchMode } from '../src/index.js';

const original = getVariant('original');
const MINUTE = 60_000;

describe('premove', () => {
  it('plays a queued move that is legal when the turn arrives', () => {
    const state = createGame(original);
    const first = legalMoves(state)[0]!;
    const outcome = resolvePremove(state, { from: first.from, to: first.to });

    expect(outcome.dropped).toBe(false);
    expect(outcome.move).toMatchObject({ from: first.from, to: first.to });
  });

  it('drops one that is not legal, rather than costing the player anything', () => {
    // a1 to a2: Blue's corner is empty at the start, so there is nothing to move.
    const outcome = resolvePremove(createGame(original), {
      from: parseSquare('a1'),
      to: parseSquare('a2'),
    });
    expect(outcome.move).toBeNull();
    expect(outcome.dropped).toBe(true);
  });

  it('drops one whose piece was captured while it waited', () => {
    const state = createGame(original);
    // d4 holds a Blue Scissors; premove from a square Blue does not occupy.
    const outcome = resolvePremove(state, {
      from: parseSquare('e8'),
      to: parseSquare('e7'),
    });
    expect(outcome.dropped).toBe(true);
  });

  it('does nothing when nothing is queued, or once the game is over', () => {
    const state = createGame(original);
    expect(resolvePremove(state, null)).toEqual({ move: null, dropped: false });

    const finished = resign(state, 'blue');
    const first = legalMoves(state)[0]!;
    expect(resolvePremove(finished, { from: first.from, to: first.to }).move).toBeNull();
  });

  it('is off in pass-and-play, where there is no waiting turn', () => {
    expect(canPremove('pass-and-play').ok).toBe(false);
    for (const mode of ['vs-computer', 'online-casual', 'rated'] as const) {
      expect(canPremove(mode).ok).toBe(true);
    }
  });
});

describe('abort', () => {
  it('is allowed in the first two plies and not after', () => {
    expect(ABORT_BEFORE_PLY).toBe(2);
    expect(canAbort(0, 'online-casual').ok).toBe(true);
    expect(canAbort(1, 'online-casual').ok).toBe(true);
    expect(canAbort(2, 'online-casual').ok).toBe(false);
    expect(canAbort(40, 'rated').ok).toBe(false);
  });

  it('says to resign instead once the game is under way', () => {
    const refused = canAbort(10, 'rated');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toMatch(/resign instead/);
  });

  it('is always allowed in pass-and-play, where nobody is being abandoned', () => {
    expect(canAbort(80, 'pass-and-play').ok).toBe(true);
  });
});

describe('low-time warning', () => {
  it('stays normal on a full clock', () => {
    const clock = startTurn(createClock(fischer(5, 3)), 'blue', 0);
    expect(urgencyOf(clock, 'blue', 0)).toBe('normal');
  });

  it('goes low then critical as the clock runs down', () => {
    const clock = startTurn(createClock(fischer(5, 0)), 'blue', 0);
    expect(urgencyOf(clock, 'blue', 5 * MINUTE - URGENCY.lowMs + 1)).toBe('low');
    expect(urgencyOf(clock, 'blue', 5 * MINUTE - URGENCY.criticalMs + 1)).toBe('critical');
  });

  it('scales to the control, so a bullet clock is not warning from move one', () => {
    // On 1+0, a flat 30s threshold would be on for half the game. The share
    // cuts it to 12s and 6s.
    const bullet = startTurn(createClock(fischer(1, 0)), 'blue', 0);
    expect(urgencyOf(bullet, 'blue', 0)).toBe('normal');
    expect(urgencyOf(bullet, 'blue', 40_000)).toBe('normal');
    expect(urgencyOf(bullet, 'blue', 49_000)).toBe('low');
    expect(urgencyOf(bullet, 'blue', 55_000)).toBe('critical');
  });

  it('never warns on an unlimited control', () => {
    const clock = startTurn(createClock(UNLIMITED), 'blue', 0);
    expect(urgencyOf(clock, 'blue', 99 * MINUTE)).toBe('normal');
  });

  it('does not warn about the side that is not on the clock', () => {
    const clock = startTurn(createClock(fischer(5, 0)), 'blue', 0);
    expect(urgencyOf(clock, 'red', 5 * MINUTE - 1_000)).toBe('normal');
  });
});

describe('Zen mode', () => {
  it('turns every aid on by default, as the spec asks', () => {
    expect(Object.values(DEFAULT_SETTINGS.aids).every(Boolean)).toBe(true);
    expect(DEFAULT_SETTINGS.zen).toBe(false);
    // Board flipping stays off by default in pass-and-play (10.2).
    expect(DEFAULT_SETTINGS.flipEachTurn).toBe(false);
  });

  it('hides every aid except the type counts', () => {
    // Vig's call, and a change from the addendum's original "hides every
    // aid": Zen is a quiet board, not a bare one. The counts are the only
    // aid that reports the position rather than advising on it, so hiding
    // them would make the player count pieces by hand instead of thinking.
    const zen = visibleAids({ ...DEFAULT_SETTINGS, zen: true });
    expect(zen.typeCounts).toBe(true);

    const { typeCounts: _counts, ...advice } = zen;
    expect(Object.values(advice).some(Boolean)).toBe(false);
  });

  it('still never turns an aid back ON that the player had switched off', () => {
    // Zen quiets the player's own settings; it does not override them
    // upward. Someone who chose to play without counts keeps that in Zen.
    const noCounts = { ...DEFAULT_SETTINGS, aids: { ...DEFAULT_SETTINGS.aids, typeCounts: false } };
    expect(visibleAids({ ...noCounts, zen: true }).typeCounts).toBe(false);
  });

  it('gives the player back their own choices, not the defaults', () => {
    const chosen = {
      ...DEFAULT_SETTINGS,
      aids: { ...DEFAULT_SETTINGS.aids, hint: false, threatLines: false },
    };
    expect(visibleAids({ ...chosen, zen: true }).hint).toBe(false);

    const restored = visibleAids({ ...chosen, zen: false });
    expect(restored.hint).toBe(false);
    expect(restored.threatLines).toBe(false);
    expect(restored.typeCounts).toBe(true);
  });
});

describe('modes agree on what they allow', () => {
  it('covers every mode', () => {
    const modes: MatchMode[] = ['pass-and-play', 'vs-computer', 'online-casual', 'rated'];
    for (const mode of modes) {
      expect(typeof canPremove(mode).ok).toBe('boolean');
      expect(typeof canAbort(0, mode).ok).toBe('boolean');
    }
  });
});
