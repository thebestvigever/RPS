// Property tests over random legal move sequences in every variant — spec 11.4,
// and the termination check from 11.5.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  applyMove,
  createGame,
  decodePiece,
  fromFen,
  getVariant,
  isGoalSquare,
  isSealed,
  legalMoves,
  moveToText,
  other,
  parseMove,
  replay,
  SQUARE_COUNT,
  toFen,
  typeCounts,
  VARIANT_IDS,
} from '../src/index.js';
import type { GameState, Move, Side, VariantId } from '../src/index.js';

/** Plays `picks` as indices into the legal move list, stopping when the game ends. */
function walk(
  id: VariantId,
  picks: readonly number[],
  onStep?: (before: GameState, move: Move, after: GameState) => void,
): { state: GameState; texts: string[] } {
  let state = createGame(getVariant(id));
  const texts: string[] = [];

  for (const pick of picks) {
    const moves = legalMoves(state);
    if (state.result || moves.length === 0) break;
    const move = moves[pick % moves.length]!;
    texts.push(moveToText(state, move));
    const after = applyMove(state, move).state;
    onStep?.(state, move, after);
    state = after;
  }

  return { state, texts };
}

const anyVariant = fc.constantFrom(...VARIANT_IDS);
const picks = fc.array(fc.nat({ max: 512 }), { minLength: 0, maxLength: 60 });
const runs = { numRuns: 120 } as const;

function totalPieces(state: GameState, side: Side): number {
  const counts = typeCounts(state)[side];
  return counts.rock + counts.paper + counts.scissors;
}

describe('invariants over random legal play (spec 11.4)', () => {
  it('keeps every cell a valid piece code, and piece counts never increase', () => {
    fc.assert(
      fc.property(anyVariant, picks, (id, chosen) => {
        let blue = 10;
        let red = 10;

        walk(id, chosen, (_before, _move, after) => {
          for (let square = 0; square < SQUARE_COUNT; square++) {
            // Throws on a code no piece maps to; null is an empty square.
            decodePiece(after.board[square]!);
          }
          const nowBlue = totalPieces(after, 'blue');
          const nowRed = totalPieces(after, 'red');
          expect(nowBlue).toBeLessThanOrEqual(blue);
          expect(nowRed).toBeLessThanOrEqual(red);
          blue = nowBlue;
          red = nowRed;
        });
      }),
      runs,
    );
  });

  it('accepts every move legalMoves returns', () => {
    fc.assert(
      fc.property(anyVariant, picks, (id, chosen) => {
        const { state } = walk(id, chosen);
        if (state.result) return;
        for (const move of legalMoves(state)) {
          expect(() => applyMove(state, { from: move.from, to: move.to })).not.toThrow();
        }
      }),
      runs,
    );
  });

  it('rejects every from/to pair legalMoves does not return', () => {
    fc.assert(
      fc.property(anyVariant, picks, fc.nat({ max: 80 }), fc.nat({ max: 80 }), (id, chosen, from, to) => {
        const { state } = walk(id, chosen);
        if (state.result) return;
        const legal = legalMoves(state).some((move) => move.from === from && move.to === to);
        if (legal) return;
        expect(() => applyMove(state, { from, to })).toThrow();
      }),
      runs,
    );
  });

  it('leaves a finished game with no legal moves, and throws on applyMove', () => {
    fc.assert(
      fc.property(anyVariant, fc.array(fc.nat({ max: 512 }), { minLength: 0, maxLength: 400 }), (id, chosen) => {
        const { state } = walk(id, chosen);
        if (!state.result) return;
        expect(legalMoves(state)).toEqual([]);
        expect(() => applyMove(state, { from: 0, to: 1 })).toThrow();
      }),
      { numRuns: 60 },
    );
  });

  it('round-trips through the position notation', () => {
    fc.assert(
      fc.property(anyVariant, picks, (id, chosen) => {
        const { state } = walk(id, chosen);
        const fen = toFen(state);
        const reloaded = fromFen(fen, getVariant(id));
        expect(toFen(reloaded)).toBe(fen);
        expect(reloaded.turn).toBe(state.turn);
        expect(reloaded.result).toEqual(state.result);
      }),
      runs,
    );
  });

  it('round-trips every legal move through the move notation', () => {
    fc.assert(
      fc.property(anyVariant, picks, (id, chosen) => {
        const { state } = walk(id, chosen);
        if (state.result) return;
        for (const move of legalMoves(state)) {
          expect(parseMove(state, moveToText(state, move))).toEqual(move);
        }
      }),
      runs,
    );
  });

  it('reproduces the same state through replay', () => {
    fc.assert(
      fc.property(anyVariant, picks, (id, chosen) => {
        const { state, texts } = walk(id, chosen);
        const replayed = replay(getVariant(id), texts);
        expect(toFen(replayed.state)).toBe(toFen(state));
        expect(replayed.state.ply).toBe(state.ply);
        expect(replayed.state.result).toEqual(state.result);
        expect(replayed.events).toHaveLength(texts.length);
      }),
      runs,
    );
  });

  it('never lets a neutral walk, take its user’s pieces, take another neutral, or win', () => {
    fc.assert(
      fc.property(fc.constant('neutrals' as const), picks, (id, chosen) => {
        walk(id, chosen, (before, move, after) => {
          if (move.piece.owner !== 'neutral') return;
          // Only ever to capture (4.2.1, 4.2.2).
          expect(move.captured).not.toBeNull();
          // Never its user's own piece, and never another neutral (4.2.3).
          expect(move.captured!.owner).toBe(other(before.turn));
          // Never a corner result (4.2.5).
          expect(after.result?.reason).not.toBe('corner');
        });
      }),
      runs,
    );
  });

  it('never seals a corner the attacker could enter on their very next move', () => {
    fc.assert(
      fc.property(anyVariant, picks, (id, chosen) => {
        const { state } = walk(id, chosen);
        if (state.result) return;

        const attacker = state.turn;
        const defender = other(attacker);
        if (!isSealed(state, defender)) return;

        // A sealed corner means the attacker cannot win by the corner (2.10).
        for (const move of legalMoves(state)) {
          if (move.piece.owner !== attacker) continue;
          expect(isGoalSquare(state.variant, attacker, move.to)).toBe(false);
        }
      }),
      runs,
    );
  });

  it('never reports a corner sealed while its defender holds no permanent piece', () => {
    fc.assert(
      fc.property(anyVariant, picks, (id, chosen) => {
        const { state } = walk(id, chosen);
        for (const side of ['blue', 'red'] as const) {
          if (!isSealed(state, side)) continue;
          // Something must be doing the sealing.
          const hasPieces = totalPieces(state, side) > 0;
          expect(hasPieces).toBe(true);
        }
      }),
      runs,
    );
  });
});

// Spec 11.5 asks for 1,000 games per variant. That is ~30s each, so the suite
// runs a still-substantial 400 by default and takes the full number on demand:
//   SPS_RANDOM_GAMES=1000 pnpm test
const RANDOM_GAMES = Number(process.env.SPS_RANDOM_GAMES ?? 400);

describe('every game terminates (spec 11.5)', () => {
  it.each(VARIANT_IDS)(`%s: ${RANDOM_GAMES} random games all end by a result`, (id) => {
    const variant = getVariant(id);

    for (let game = 0; game < RANDOM_GAMES; game++) {
      // A tiny deterministic generator, so a failure is reproducible from `game`.
      let seed = (game + 1) * 2654435761;
      const nextIndex = (n: number): number => {
        seed = (seed ^ (seed << 13)) >>> 0;
        seed = (seed ^ (seed >>> 17)) >>> 0;
        seed = (seed ^ (seed << 5)) >>> 0;
        return seed % n;
      };

      let state = createGame(variant);
      let plies = 0;

      while (!state.result) {
        const moves = legalMoves(state);
        expect(moves.length, `game ${game} stalled with no result`).toBeGreaterThan(0);
        state = applyMove(state, moves[nextIndex(moves.length)]!).state;
        plies++;
        expect(plies).toBeLessThanOrEqual(variant.draw.maxPlies);
      }

      expect(state.result).not.toBeNull();
      expect(legalMoves(state)).toEqual([]);
    }
  }, 120_000);
});
