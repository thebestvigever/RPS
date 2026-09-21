// Guards the fixture data itself. The vectors in spec 11.2 are hand-transcribed,
// so a typo here would otherwise show up as a mysterious engine failure in M1.
//
// The tests that run these fixtures THROUGH the engine are the todos at the
// bottom — they turn on as M1 lands.

import { describe, expect, it } from 'vitest';
import openingMoves from './fixtures/opening-moves.json' with { type: 'json' };
import perft from './fixtures/perft.json' with { type: 'json' };
import tutorial from './fixtures/tutorial.json' with { type: 'json' };
import vectors from './fixtures/vectors.json' with { type: 'json' };
import { VARIANT_IDS } from '../src/variants.js';
import { parseSquare } from '../src/board.js';

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
    expect(perft.original['1']).toBe(openingMoves.original.length);
    expect(perft.corner2x2['1']).toBe(perft.original['1']);
    // Neutrals loses exactly Sd4-e5: the neutral Scissors on e5 can't be taken.
    expect(perft.neutrals['1']).toBe(perft.original['1'] - 1);
    expect(openingMoves.original).toContain('Sd4-e5');
  });

  it('grows at every depth for every variant', () => {
    for (const id of ['original', 'corner2x2', 'neutrals'] as const) {
      const counts = perft[id];
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

// --- Turned on by M1 (spec 12). Each needs a working engine. ---

describe('fixtures against the engine', () => {
  it.todo('legalMoves equals `legal`, compared as a set, for every vector');
  it.todo('applying `play` gives `result` and `fenAfter` for every vector');
  it.todo('a position with `resultBeforeMoving` loads as already over');
  it.todo('Blue has exactly the 36 listed first moves in Original and 2x2 Corner');
  it.todo('Blue has those 36 minus Sd4-e5 in Neutrals');
  it.todo('perft matches at depths 1-3 for every variant');
  it.todo('perft matches at depth 4 for every variant (slow)');
  it.todo('every tutorial puzzle accepts its solution and rejects the alternatives');
});
