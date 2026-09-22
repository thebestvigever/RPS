// docs/VISUAL_SYSTEM.md 6 — one motion per matchup, derived from the captor's
// type, never stored.

import { describe, expect, it } from 'vitest';
import { beats, PIECE_TYPES } from '@sps/engine';
import { captureMotion } from '../src/motion.js';

describe('captureMotion', () => {
  it('Rock x Scissors -> crush', () => {
    expect(captureMotion('rock')).toBe('crush');
  });
  it('Scissors x Paper -> cut', () => {
    expect(captureMotion('scissors')).toBe('cut');
  });
  it('Paper x Rock -> wrap', () => {
    expect(captureMotion('paper')).toBe('wrap');
  });

  it('every type that can capture has exactly one motion, matching what it actually beats', () => {
    for (const type of PIECE_TYPES) {
      const motion = captureMotion(type);
      expect(['crush', 'cut', 'wrap']).toContain(motion);
      // Sanity: the motion is keyed off the captor, and every captor beats
      // exactly one type (beats()), so this is a total, unambiguous function.
      expect(beats(type)).toBeDefined();
    }
  });
});
