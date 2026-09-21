import { describe, expect, it } from 'vitest';
import {
  NEIGHBOURS,
  SQUARE_COUNT,
  colOf,
  distance,
  neighbours,
  parseSquare,
  rowOf,
  squareName,
} from '../src/board.js';

describe('coordinates (spec 2.1)', () => {
  it('maps the spec anchor squares', () => {
    expect(parseSquare('a9')).toBe(0);
    expect(parseSquare('i9')).toBe(8);
    expect(parseSquare('e5')).toBe(40);
    expect(parseSquare('a1')).toBe(72);
    expect(parseSquare('i1')).toBe(80);
  });

  it('round-trips every square', () => {
    for (let square = 0; square < SQUARE_COUNT; square++) {
      expect(parseSquare(squareName(square))).toBe(square);
    }
  });

  it('puts row 0 on the top rank, matching the position notation order', () => {
    expect(rowOf(parseSquare('a9'))).toBe(0);
    expect(rowOf(parseSquare('a1'))).toBe(8);
    expect(colOf(parseSquare('a5'))).toBe(0);
    expect(colOf(parseSquare('i5'))).toBe(8);
  });

  it('rejects anything that is not a square name', () => {
    for (const bad of ['j1', 'a0', 'a10', '', 'a', 'aa', '11']) {
      expect(() => parseSquare(bad)).toThrow();
    }
  });
});

describe('king distance (spec 2.1)', () => {
  it('is 8 from corner to corner', () => {
    expect(distance(parseSquare('a1'), parseSquare('i9'))).toBe(8);
  });

  it('is Chebyshev, not Manhattan', () => {
    expect(distance(parseSquare('e5'), parseSquare('f6'))).toBe(1);
    expect(distance(parseSquare('e5'), parseSquare('g5'))).toBe(2);
    expect(distance(parseSquare('e5'), parseSquare('g7'))).toBe(2);
  });

  it('is zero to itself and symmetric', () => {
    for (let a = 0; a < SQUARE_COUNT; a += 7) {
      expect(distance(a, a)).toBe(0);
      for (let b = 0; b < SQUARE_COUNT; b += 11) {
        expect(distance(a, b)).toBe(distance(b, a));
      }
    }
  });
});

describe('neighbours (spec 2.1)', () => {
  it('gives corners 3, edges 5 and interior squares 8', () => {
    expect(neighbours(parseSquare('a1'))).toHaveLength(3);
    expect(neighbours(parseSquare('i9'))).toHaveLength(3);
    expect(neighbours(parseSquare('e1'))).toHaveLength(5);
    expect(neighbours(parseSquare('a5'))).toHaveLength(5);
    expect(neighbours(parseSquare('e5'))).toHaveLength(8);
  });

  it('holds only squares at king distance 1, ascending', () => {
    for (let square = 0; square < SQUARE_COUNT; square++) {
      const list = neighbours(square);
      for (const n of list) expect(distance(square, n)).toBe(1);
      expect([...list].sort((a, b) => a - b)).toEqual([...list]);
    }
  });

  it('is symmetric', () => {
    for (let square = 0; square < SQUARE_COUNT; square++) {
      for (const n of NEIGHBOURS[square]!) {
        expect(NEIGHBOURS[n]).toContain(square);
      }
    }
  });
});
