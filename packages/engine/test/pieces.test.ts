import { describe, expect, it } from 'vitest';
import {
  PIECE_TYPES,
  beats,
  decodePiece,
  encodePiece,
  other,
  predatorOf,
} from '../src/pieces.js';
import type { Owner, PieceType } from '../src/types.js';

const OWNERS: Owner[] = ['blue', 'red', 'neutral'];

describe('the cycle (spec 2.2)', () => {
  it('has Rock beat Scissors, Scissors beat Paper, Paper beat Rock', () => {
    expect(beats('rock')).toBe('scissors');
    expect(beats('scissors')).toBe('paper');
    expect(beats('paper')).toBe('rock');
  });

  it('makes the predator the inverse of beats', () => {
    for (const type of PIECE_TYPES) {
      expect(beats(predatorOf(type))).toBe(type);
      expect(predatorOf(beats(type))).toBe(type);
    }
  });

  it('never has a type beat itself', () => {
    for (const type of PIECE_TYPES) {
      expect(beats(type)).not.toBe(type);
      expect(predatorOf(type)).not.toBe(type);
    }
  });
});

describe('board encoding (spec 7.2)', () => {
  it('matches the code table', () => {
    const table: Array<[number, Owner, PieceType]> = [
      [1, 'blue', 'rock'],
      [2, 'blue', 'paper'],
      [3, 'blue', 'scissors'],
      [5, 'red', 'rock'],
      [6, 'red', 'paper'],
      [7, 'red', 'scissors'],
      [9, 'neutral', 'rock'],
      [10, 'neutral', 'paper'],
      [11, 'neutral', 'scissors'],
    ];
    for (const [code, owner, type] of table) {
      expect(encodePiece({ owner, type })).toBe(code);
      expect(decodePiece(code)).toEqual({ owner, type });
    }
  });

  it('round-trips every piece and fits in an Int8Array cell', () => {
    for (const owner of OWNERS) {
      for (const type of PIECE_TYPES) {
        const code = encodePiece({ owner, type });
        expect(code).toBeGreaterThan(0);
        expect(code).toBeLessThan(128);
        expect(decodePiece(code)).toEqual({ owner, type });
      }
    }
  });

  it('reads 0 as empty and rejects codes no piece maps to', () => {
    expect(decodePiece(0)).toBeNull();
    for (const bad of [4, 8, 12, 13, 99]) {
      expect(() => decodePiece(bad)).toThrow();
    }
  });
});

describe('sides', () => {
  it('is its own inverse', () => {
    expect(other('blue')).toBe('red');
    expect(other('red')).toBe('blue');
    expect(other(other('blue'))).toBe('blue');
  });
});
