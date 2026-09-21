import { describe, expect, it } from 'vitest';
import { createGame, getVariant, parseMove, replay, VARIANT_IDS } from '@sps/engine';
import type { GameRecord } from '@sps/engine';
import { think } from '../src/think.js';

function record(over: Partial<GameRecord> = {}): GameRecord {
  const variant = getVariant(over.variant ?? 'original');
  return {
    game: 'stone-paper-scissors',
    rulesVersion: 1,
    variant: variant.id,
    start: variant.start,
    moves: [],
    ...over,
  };
}

describe('the worker’s think step (spec 9.4)', () => {
  it.each(VARIANT_IDS)('%s: returns a move that is legal in the replayed position', (id) => {
    const reply = think(record({ variant: id }), 'medium', 1);
    expect(reply.type).toBe('move');

    // The record is the source of truth, so the move must parse against the
    // state the record replays to.
    const state = createGame(getVariant(id));
    expect(() => parseMove(state, reply.move)).not.toThrow();
  });

  it('picks up from the moves already played', () => {
    const played = ['Sd4-d5', 'Se7-d6'];
    const reply = think(record({ moves: played }), 'medium', 3);

    const { state } = replay(getVariant('original'), played);
    expect(state.turn).toBe('blue');
    expect(() => parseMove(state, reply.move)).not.toThrow();
  });

  it('reports the search stats the protocol promises', () => {
    const reply = think(record(), 'medium', 1);
    expect(reply.stats.depth).toBeGreaterThanOrEqual(1);
    expect(reply.stats.nodes).toBeGreaterThan(0);
    expect(reply.stats.ms).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic for a seed, so a computer game replays exactly', () => {
    expect(think(record(), 'medium', 77).move).toBe(think(record(), 'medium', 77).move);
  });
});
