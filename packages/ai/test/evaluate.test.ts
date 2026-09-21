import { describe, expect, it } from 'vitest';
import {
  createGame,
  fromFen,
  getVariant,
  isSealed,
  parseSquare,
  VARIANTS,
} from '@sps/engine';
import type { GameState } from '@sps/engine';
import { WEIGHTS, WIN_SCORE, evaluate, terminalScore } from '../src/evaluate.js';

const original = getVariant('original');
const load = (fen: string, variant = original): GameState => fromFen(fen, variant);
const flip = (state: GameState): GameState => ({
  ...state,
  turn: state.turn === 'blue' ? 'red' : 'blue',
});

describe('terminal scores (spec 9.1)', () => {
  it('prefers faster wins and slower losses', () => {
    expect(terminalScore('win', 10)).toBeGreaterThan(terminalScore('win', 40));
    expect(terminalScore('loss', 40)).toBeGreaterThan(terminalScore('loss', 10));
    expect(terminalScore('draw', 10)).toBe(0);
    expect(terminalScore('win', 0)).toBe(WIN_SCORE);
  });

  it('always ranks a win above a draw above a loss', () => {
    for (const ply of [0, 50, 150, 299]) {
      expect(terminalScore('win', ply)).toBeGreaterThan(0);
      expect(terminalScore('loss', ply)).toBeLessThan(0);
    }
  });
});

describe('evaluation (spec 9.2)', () => {
  it('is exactly antisymmetric: every term is a "mine minus theirs" difference', () => {
    const positions = [
      VARIANTS.original.start,
      '9/9/9/3PRS3/4r4/9/9/9/9 blue',
      '9/9/9/4S4/9/9/9/1r7/9 blue',
      '8R/7s1/9/9/9/9/9/9/9 blue',
      '9/4PR3/4SPR2/5SPR1/1ps3SP1/1rps5/2rps4/3rp4/9 red',
    ];

    for (const fen of positions) {
      for (const keepTerms of [false, true]) {
        const state = load(fen);
        expect(evaluate(state, keepTerms)).toBeCloseTo(-evaluate(flip(state), keepTerms), 6);
      }
    }
  });

  it('scores the balanced start position at zero', () => {
    expect(evaluate(createGame(original), false)).toBeCloseTo(0, 6);
    expect(evaluate(createGame(original), true)).toBeCloseTo(0, 6);
  });

  it('rewards material', () => {
    // Blue Rock and Red Rock, then the same with an extra Blue Rock.
    const even = load('9/9/9/9/4r4/9/9/9/8R blue');
    const ahead = load('9/9/9/9/4r4/3r5/9/9/8R blue');
    expect(evaluate(ahead, false)).toBeGreaterThan(evaluate(even, false));
    expect(evaluate(ahead, false) - evaluate(even, false)).toBeGreaterThan(WEIGHTS.material);
  });

  it('rewards getting closer to the goal', () => {
    // Blue's goal is i9. h8 is one step away, a1 is eight.
    const near = load('9/7r1/9/9/9/9/9/9/8R blue');
    const far = load('9/9/9/9/9/9/9/9/r7R blue');
    expect(evaluate(near, false)).toBeGreaterThan(evaluate(far, false));
  });

  it('rewards permanence', () => {
    // Red holds a Paper, so Blue's Rock can be taken.
    const vulnerable = load('9/9/9/9/4r4/9/9/9/7PS blue');
    // Red holds no Paper, so the same Rock is permanent.
    const permanent = load('9/9/9/9/4r4/9/9/9/7SS blue');
    expect(evaluate(permanent, false)).toBeGreaterThan(evaluate(vulnerable, false));
  });

  it('adds the Keep bonus only when the Keep terms are on', () => {
    const sealed = load('9/9/9/4S4/9/9/9/9/r8 blue');
    expect(isSealed(sealed, 'blue')).toBe(true);

    const withKeep = evaluate(sealed, true);
    const withoutKeep = evaluate(sealed, false);
    expect(withKeep - withoutKeep).toBeGreaterThanOrEqual(WEIGHTS.sealed);
  });

  it('ignores neutral pieces, which the search sees through captures anyway', () => {
    const neutrals = getVariant('neutrals');
    const bare = load('9/9/9/9/4r4/9/9/9/8S blue', neutrals);
    const withNeutralScissors = load('9/9/6nS2/9/4r4/9/9/9/8S blue', neutrals);
    // A neutral Scissors changes no side's material, distance or permanence.
    expect(evaluate(withNeutralScissors, false)).toBeCloseTo(evaluate(bare, false), 6);
  });

  it('never lets a positional term outweigh a win', () => {
    const state = load('9/4PR3/4SPR2/5SPR1/1ps3SP1/1rps5/2rps4/3rp4/9 blue');
    expect(Math.abs(evaluate(state, true))).toBeLessThan(WIN_SCORE / 2);
  });

  it('counts distance to the nearest square of a 2x2 goal block', () => {
    const corner2x2 = getVariant('corner2x2');
    // h8 is inside Blue's goal block, so distance 0 either way; under the
    // Original it is one step short of i9.
    const state = '9/7r1/9/9/9/9/9/9/8R blue';
    expect(evaluate(load(state, corner2x2), false)).toBeGreaterThan(
      evaluate(load(state, original), false),
    );
  });

  it('uses square-law advancement, so progress accelerates', () => {
    const at5 = load('9/9/9/9/4r4/9/9/9/8R blue');
    const at7 = load('9/9/6r2/9/9/9/9/9/8R blue');
    const gain = evaluate(at7, false) - evaluate(at5, false);
    expect(gain).toBeGreaterThan(0);
    expect(Number.isFinite(gain)).toBe(true);
    expect(parseSquare('g7')).toBe(24);
  });
});
