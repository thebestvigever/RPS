// Who may move, per mode. This exists because the interface got it wrong in a
// way nothing could type-check: pass-and-play is one person playing BOTH
// sides (spec 10.1), but the board compared the side to move against a single
// `humanSide` that was hardcoded to Blue with no computer — so after Blue's
// first move, no Red piece was selectable and the game could not go on.

import { describe, expect, it } from 'vitest';
import { controlsSide } from '../src/control.js';
import type { MatchMode } from '../src/offers.js';

describe('controlsSide (spec 10.1)', () => {
  it('lets pass-and-play move both sides, whichever one it calls yours', () => {
    // The regression, pinned: Blue moves, and Red must still be movable.
    for (const humanSide of ['blue', 'red'] as const) {
      expect(controlsSide('pass-and-play', 'blue', humanSide)).toBe(true);
      expect(controlsSide('pass-and-play', 'red', humanSide)).toBe(true);
    }
  });

  it('lets you move only your own side against the computer', () => {
    expect(controlsSide('vs-computer', 'blue', 'blue')).toBe(true);
    expect(controlsSide('vs-computer', 'red', 'blue')).toBe(false);
    // And the same when the human chose Red (M4b's side picker).
    expect(controlsSide('vs-computer', 'red', 'red')).toBe(true);
    expect(controlsSide('vs-computer', 'blue', 'red')).toBe(false);
  });

  it('treats every online mode like vs-computer — one side each', () => {
    for (const mode of ['online-casual', 'rated'] as MatchMode[]) {
      expect(controlsSide(mode, 'blue', 'blue')).toBe(true);
      expect(controlsSide(mode, 'red', 'blue')).toBe(false);
    }
  });

  it('never lets a mode move both sides except pass-and-play', () => {
    const modes: MatchMode[] = ['vs-computer', 'online-casual', 'rated'];
    for (const mode of modes) {
      const both = controlsSide(mode, 'blue', 'blue') && controlsSide(mode, 'red', 'blue');
      expect(both).toBe(false);
    }
  });
});
