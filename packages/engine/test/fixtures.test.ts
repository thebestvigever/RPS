// Guards the fixture data itself. The vectors in spec 11.2 are hand-transcribed,
// so a typo here would otherwise show up as a mysterious engine failure in M1.
//
// The tests that run these fixtures THROUGH the engine are the todos at the
// bottom — they turn on as M1 lands.

import { describe, expect, it } from 'vitest';
import openingMoves from './fixtures/opening-moves.json' with { type: 'json' };
import perftCounts from './fixtures/perft.json' with { type: 'json' };
import tutorial from '../src/data/tutorial.json' with { type: 'json' };
import vectors from './fixtures/vectors.json' with { type: 'json' };
import {
  applyMove,
  createGame,
  fromFen,
  getVariant,
  legalMoves,
  moveToText,
  parseMove,
  parseSquare,
  toFen,
  VARIANT_IDS,
} from '../src/index.js';
import type { VariantId } from '../src/index.js';
import { perft } from './perft.js';

/** Spec 8.1: [n]<Type><from><sep><to>[#] */
const MOVE_RE = /^(n?)([RPS])([a-i][1-9])([-x])([a-i][1-9])(#?)$/;

/** Spec 8.2: counts the files a rank accounts for. Neutrals are two-char tokens. */
function filesInRank(rank: string): number {
  let files = 0;
  for (let i = 0; i < rank.length; i++) {
    const ch = rank[i]!;
    if (ch >= '1' && ch <= '9') {
      files += Number(ch);
    } else if (ch === 'n') {
      const next = rank[i + 1];
      if (!next || !'RPS'.includes(next)) throw new Error(`bad neutral token in "${rank}"`);
      files += 1;
      i++;
    } else if ('rpsRPS'.includes(ch)) {
      files += 1;
    } else {
      throw new Error(`unknown character "${ch}" in "${rank}"`);
    }
  }
  return files;
}

function ranksOf(fen: string): string[] {
  const [board, side] = fen.split(' ');
  expect(side, `"${fen}" must name the side to move`).toMatch(/^(blue|red)$/);
  const ranks = board!.split('/');
  expect(ranks, `"${fen}" must have 9 ranks`).toHaveLength(9);
  return ranks;
}

describe('fixture vectors (spec 11.2)', () => {
  it('carries every vector from the spec', () => {
    expect(vectors).toHaveLength(11);
    expect(new Set(vectors.map((v) => v.name)).size).toBe(vectors.length);
  });

  it.each(vectors.map((v) => [v.name, v] as const))('%s is well formed', (_name, vector) => {
    expect(VARIANT_IDS).toContain(vector.variant);

    for (const rank of ranksOf(vector.fen)) {
      expect(filesInRank(rank), `rank "${rank}" of ${vector.name}`).toBe(9);
    }

    for (const move of vector.legal) {
      const parts = MOVE_RE.exec(move);
      expect(parts, `"${move}" must match the spec 8.1 grammar`).not.toBeNull();
      const [, neutral, , from, , to] = parts!;
      // A neutral mover only exists in a variant that has neutrals (spec 4).
      if (neutral) expect(vector.variant).toBe('neutrals');
      // Every move is one king step (spec 2.5).
      expect(Math.abs(parseSquare(from!) - parseSquare(to!))).toBeLessThanOrEqual(10);
    }

    expect(new Set(vector.legal).size, 'no duplicate moves').toBe(vector.legal.length);

    if ('play' in vector && vector.play) {
      expect(vector.legal).toContain(vector.play);
    }
    if ('fenAfter' in vector && vector.fenAfter) {
      for (const rank of ranksOf(vector.fenAfter)) {
        expect(filesInRank(rank), `rank "${rank}" after ${vector.name}`).toBe(9);
      }
    }
  });

  it('only marks a move with # when the vector says it wins', () => {
    for (const vector of vectors) {
      const winning = vector.legal.filter((m) => m.endsWith('#'));
      if (winning.length > 0) {
        expect(vector.play, `${vector.name} should play its winning move`).toBeDefined();
      }
    }
  });
});

describe('opening moves and perft (spec 11.3)', () => {
  it('lists 36 first moves for Blue, all well formed and unique', () => {
    expect(openingMoves.original).toHaveLength(36);
    expect(new Set(openingMoves.original).size).toBe(36);
    for (const move of openingMoves.original) expect(move).toMatch(MOVE_RE);
  });

  it('agrees with the perft depth-1 counts', () => {
    expect(perftCounts.original['1']).toBe(openingMoves.original.length);
    expect(perftCounts.corner2x2['1']).toBe(perftCounts.original['1']);
    // Neutrals loses exactly Sd4-e5: the neutral Scissors on e5 can't be taken.
    expect(perftCounts.neutrals['1']).toBe(perftCounts.original['1'] - 1);
    expect(openingMoves.original).toContain('Sd4-e5');
  });

  it('grows at every depth for every variant', () => {
    for (const id of ['original', 'corner2x2', 'neutrals'] as const) {
      const counts = perftCounts[id];
      expect(counts['2']).toBeGreaterThan(counts['1']);
      expect(counts['3']).toBeGreaterThan(counts['2']);
      expect(counts['4']).toBeGreaterThan(counts['3']);
    }
  });
});

describe('tutorial puzzles (spec 10.9)', () => {
  it('has six puzzles with valid positions and solutions', () => {
    expect(tutorial.puzzles).toHaveLength(6);
    for (const puzzle of tutorial.puzzles) {
      expect(VARIANT_IDS).toContain(puzzle.variant);
      for (const rank of ranksOf(puzzle.fen)) {
        expect(filesInRank(rank), `puzzle ${puzzle.n} rank "${rank}"`).toBe(9);
      }
      if (puzzle.solution) expect(puzzle.solution).toMatch(MOVE_RE);
    }
  });
});

// --- The fixtures, run through the engine ---------------------------------

describe('fixture vectors against the engine (spec 11.2)', () => {
  it.each(vectors.map((v) => [v.name, v] as const))('%s', (_name, vector) => {
    const variant = getVariant(vector.variant as VariantId);
    const state = fromFen(vector.fen, variant);

    if ('resultBeforeMoving' in vector && vector.resultBeforeMoving) {
      expect(state.result).toEqual(vector.resultBeforeMoving);
    }

    // Compared as a set: generation order is tested separately.
    const generated = legalMoves(state).map((move) => moveToText(state, move));
    expect(new Set(generated)).toEqual(new Set(vector.legal));
    expect(generated).toHaveLength(vector.legal.length);

    if (!('play' in vector) || !vector.play) return;

    const move = parseMove(state, vector.play);
    const after = applyMove(state, move);

    expect(after.state.result).toEqual('result' in vector ? vector.result : null);
    if ('fenAfter' in vector && vector.fenAfter) {
      expect(toFen(after.state)).toBe(vector.fenAfter);
    }
  });
});

describe('opening moves (spec 11.3)', () => {
  it('gives Blue exactly the 36 listed first moves in Original', () => {
    const state = createGame(getVariant('original'));
    const generated = legalMoves(state).map((move) => moveToText(state, move));
    expect([...generated].sort()).toEqual([...openingMoves.original].sort());
  });

  it('gives the same 36 in 2x2 Corner — the start position has no piece in either block', () => {
    const state = createGame(getVariant('corner2x2'));
    const generated = legalMoves(state).map((move) => moveToText(state, move));
    expect([...generated].sort()).toEqual([...openingMoves.original].sort());
  });

  it('gives those minus Sd4-e5 in Neutrals, and no neutral can capture on move one', () => {
    const state = createGame(getVariant('neutrals'));
    const generated = legalMoves(state).map((move) => moveToText(state, move));
    const expected = openingMoves.original.filter((move) => move !== 'Sd4-e5');

    expect([...generated].sort()).toEqual([...expected].sort());
    expect(generated).toHaveLength(35);
    expect(generated.filter((move) => move.startsWith('n'))).toEqual([]);
  });

  it('emits moves in origin-square then destination-square order', () => {
    const state = createGame(getVariant('original'));
    const moves = legalMoves(state);
    for (let i = 1; i < moves.length; i++) {
      const previous = moves[i - 1]!;
      const current = moves[i]!;
      expect(
        current.from > previous.from ||
          (current.from === previous.from && current.to > previous.to),
      ).toBe(true);
    }
  });
});

describe('perft (spec 11.3)', () => {
  // Depth 4 is ~2.1M sequences per variant and runs in its own test below.
  it.each(VARIANT_IDS)('%s matches at depths 1-3', (id) => {
    const variant = getVariant(id);
    const expected = perftCounts[id];
    for (const depth of [1, 2, 3] as const) {
      expect(perft(createGame(variant), depth)).toBe(expected[depth]);
    }
  });

  it.each(VARIANT_IDS)('%s matches at depth 4 (slow)', { timeout: 120_000 }, (id) => {
    const variant = getVariant(id);
    expect(perft(createGame(variant), 4)).toBe(perftCounts[id]['4']);
  });
});

describe('tutorial puzzles (spec 10.9)', () => {
  it.each(tutorial.puzzles.map((p) => [p.n, p] as const))('puzzle %i loads and solves', (_n, puzzle) => {
    const variant = getVariant(puzzle.variant as VariantId);
    const state = fromFen(puzzle.fen, variant);
    expect(state.result).toBeNull();

    if (puzzle.legalCount !== undefined) {
      expect(legalMoves(state)).toHaveLength(puzzle.legalCount);
    }

    if (!puzzle.solution) return;
    const generated = legalMoves(state).map((move) => moveToText(state, move));
    expect(generated).toContain(puzzle.solution);
  });

  it('puzzle 6 plays out as the spec describes: you move first, so you arrive first', () => {
    const puzzle = tutorial.puzzles[5]!;
    const variant = getVariant('original');
    let state = fromFen(puzzle.fen, variant);

    for (const text of puzzle.line!) {
      state = applyMove(state, parseMove(state, text)).state;
    }

    expect(state.result).toEqual({ winner: 'blue', reason: 'corner' });
  });
});
