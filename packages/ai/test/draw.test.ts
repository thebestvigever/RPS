import { describe, expect, it } from 'vitest';
import { createGame, fromFen, getVariant, isSealed, resign } from '@sps/engine';
import type { GameState } from '@sps/engine';
import { DRAW_MIN_PLY, shouldAcceptDraw } from '../src/draw.js';

const original = getVariant('original');
const load = (fen: string): GameState => fromFen(fen, original);

describe('answering a draw offer', () => {
  it('refuses before the game has a shape', () => {
    const decision = shouldAcceptDraw(createGame(original), 'red', 'medium', 1);
    expect(decision.accept).toBe(false);
    expect(decision.reason).toMatch(/too early/);
  });

  it('takes the draw when both corners are sealed, however early', () => {
    // Neither side has the other's predator type, and each sits on its corner:
    // nobody can ever win by the corner.
    const state = load('8R/9/9/9/9/9/9/9/r8 blue');
    expect(isSealed(state, 'blue')).toBe(true);
    expect(isSealed(state, 'red')).toBe(true);

    const decision = shouldAcceptDraw(state, 'red', 'medium', 1);
    expect(decision.accept).toBe(true);
    expect(decision.reason).toMatch(/both corners are sealed/);
  });

  it('refuses while it is clearly winning', () => {
    // Red has a full army, Blue has one piece.
    const state = { ...load('9/4PR3/4SPR2/5SPR1/6SP1/9/9/3rp4/9 blue'), ply: 40 };
    const decision = shouldAcceptDraw(state, 'red', 'medium', 1);
    expect(decision.accept).toBe(false);
    expect(decision.score).toBeGreaterThan(0);
  });

  it('takes the draw while it is losing', () => {
    const state = { ...load('9/4PR3/4SPR2/5SPR1/6SP1/9/9/3rp4/9 blue'), ply: 40 };
    const decision = shouldAcceptDraw(state, 'blue', 'medium', 1);
    expect(decision.accept).toBe(true);
    expect(decision.score).toBeLessThan(0);
  });

  it('takes a level position', () => {
    // The start position is 180-degree symmetric (2.3), so it is dead level by
    // construction — no invented opening line needed.
    const state = { ...createGame(original), ply: DRAW_MIN_PLY };
    const decision = shouldAcceptDraw(state, 'red', 'medium', 1);
    expect(decision.accept).toBe(true);
    expect(decision.reason).toMatch(/level enough/);
  });

  it('refuses once the game is over', () => {
    const finished = resign(createGame(original), 'blue');
    expect(shouldAcceptDraw(finished, 'red', 'medium', 1).accept).toBe(false);
  });

  it('is deterministic', () => {
    const state = { ...createGame(original), ply: 40 };
    expect(shouldAcceptDraw(state, 'red', 'medium', 9)).toEqual(
      shouldAcceptDraw(state, 'red', 'medium', 9),
    );
  });
});
