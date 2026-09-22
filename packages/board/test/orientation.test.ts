import { describe, expect, it } from 'vitest';
import { FILES, RANKS, SQUARE_COUNT, parseSquare, squareName } from '@sps/engine';
import type { Side } from '@sps/engine';
import { DEFAULT_ORIENTATION, displayCell, squareAtCell } from '../src/orientation.js';

const BOTH: Side[] = ['blue', 'red'];

describe('orientation (spec 10.2)', () => {
  it("defaults to Blue's view", () => {
    expect(DEFAULT_ORIENTATION).toBe('blue');
  });

  it('leaves the board alone for Blue', () => {
    // a1 bottom-left, i9 top-right — the orientation every other milestone
    // rendered, so this is also a regression test on M3a/M3b's output.
    expect(displayCell(parseSquare('a1'), 'blue')).toEqual({ row: RANKS - 1, col: 0 });
    expect(displayCell(parseSquare('i9'), 'blue')).toEqual({ row: 0, col: FILES - 1 });
  });

  it("puts Red's own corner bottom-left", () => {
    expect(displayCell(parseSquare('i9'), 'red')).toEqual({ row: RANKS - 1, col: 0 });
    expect(displayCell(parseSquare('a1'), 'red')).toEqual({ row: 0, col: FILES - 1 });
  });

  it('is a 180 degree turn, so the centre never moves', () => {
    const e5 = parseSquare('e5');
    expect(displayCell(e5, 'red')).toEqual(displayCell(e5, 'blue'));
  });

  it.each(BOTH)('round-trips every square (%s)', (orientation) => {
    for (let square = 0; square < SQUARE_COUNT; square++) {
      const { row, col } = displayCell(square, orientation);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(RANKS);
      expect(col).toBeGreaterThanOrEqual(0);
      expect(col).toBeLessThan(FILES);
      expect(squareAtCell(row, col, orientation)).toBe(square);
    }
  });

  it.each(BOTH)('fills every cell exactly once (%s)', (orientation) => {
    const seen = new Set<number>();
    for (let row = 0; row < RANKS; row++) {
      for (let col = 0; col < FILES; col++) seen.add(squareAtCell(row, col, orientation));
    }
    expect(seen.size).toBe(SQUARE_COUNT);
  });

  it('rotates rather than mirrors — a1 and a9 do not swap files', () => {
    // A mirror (flipping rank only) would leave file `a` on the left for Red
    // too. That renders a board that looks plausible and plays wrong, so it
    // is worth pinning: under a real 180 turn, a-file squares move to the
    // right-hand edge.
    expect(displayCell(parseSquare('a9'), 'red').col).toBe(FILES - 1);
    expect(squareName(squareAtCell(RANKS - 1, 0, 'red'))).toBe('i9');
  });
});
