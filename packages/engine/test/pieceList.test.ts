// Piece lists — docs/engine/04-SPEED.md §2. `movesFromPieceLists` must return
// exactly the same set of moves as `legalMoves`, and a piece list kept current
// through make/unmake must match one built fresh from the same board.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  EMPTY,
  applyMove,
  createGame,
  decodePiece,
  getVariant,
  insertIntoPieceLists,
  legalMoves,
  movesFromPieceLists,
  pieceListsOf,
  relocateInPieceLists,
  removeFromPieceLists,
  VARIANT_IDS,
} from '../src/index.js';
import type { GameState, Move, PieceLists, VariantId } from '../src/index.js';

function sortedKeys(moves: Move[]): string[] {
  return moves
    .map((m) => `${m.from}-${m.to}-${m.piece.owner}-${m.piece.type}-${m.captured?.owner ?? ''}-${m.captured?.type ?? ''}`)
    .sort();
}

/** Rebuilds a fresh piece list from the board and checks it matches `lists` exactly. */
function assertListsMatchBoard(lists: PieceLists, board: Int8Array): void {
  const fresh = pieceListsOf(board);
  for (const owner of ['blue', 'red', 'neutral'] as const) {
    expect(lists.count[owner]).toBe(fresh.count[owner]);
    const got = Array.from(lists.squares[owner].slice(0, lists.count[owner])).sort((a, b) => a - b);
    const want = Array.from(fresh.squares[owner].slice(0, fresh.count[owner])).sort((a, b) => a - b);
    expect(got).toEqual(want);
  }
}

const anyVariant = fc.constantFrom(...VARIANT_IDS);
const picks = fc.array(fc.nat({ max: 512 }), { minLength: 0, maxLength: 60 });

function walk(id: VariantId, choices: readonly number[]): GameState[] {
  let state = createGame(getVariant(id));
  const trail = [state];
  for (const pick of choices) {
    const moves = legalMoves(state);
    if (state.result || moves.length === 0) break;
    state = applyMove(state, moves[pick % moves.length]!).state;
    trail.push(state);
  }
  return trail;
}

describe('movesFromPieceLists agrees with legalMoves', () => {
  it('on every position along random legal games, every variant', () => {
    fc.assert(
      fc.property(anyVariant, picks, (id, chosen) => {
        for (const state of walk(id, chosen)) {
          const lists = pieceListsOf(state.board);
          expect(sortedKeys(movesFromPieceLists(state, lists))).toEqual(sortedKeys(legalMoves(state)));
        }
      }),
      { numRuns: 120 },
    );
  });

  it('on the start position of every variant', () => {
    for (const id of VARIANT_IDS) {
      const state = createGame(getVariant(id));
      const lists = pieceListsOf(state.board);
      expect(sortedKeys(movesFromPieceLists(state, lists))).toEqual(sortedKeys(legalMoves(state)));
    }
  });
});

/**
 * Applies `move` to both `state` and `lists`, the way the AI search's make()
 * does: remove any captured piece first (its slot still points at `to`), then
 * relocate the mover. Returns what unmake() needs to put both back.
 */
function makeBoth(
  state: GameState,
  lists: PieceLists,
  move: Move,
): { state: GameState; capturedCode: number } {
  const mover = decodePiece(state.board[move.from]!)!.owner;
  const capturedCode = state.board[move.to]!;

  if (capturedCode !== EMPTY) {
    removeFromPieceLists(lists, decodePiece(capturedCode)!.owner, move.to);
  }
  relocateInPieceLists(lists, mover, move.from, move.to);

  return { state: applyMove(state, { from: move.from, to: move.to }).state, capturedCode };
}

function unmakeLists(lists: PieceLists, move: Move, mover: 'blue' | 'red' | 'neutral', capturedCode: number): void {
  relocateInPieceLists(lists, mover, move.to, move.from);
  if (capturedCode !== EMPTY) {
    insertIntoPieceLists(lists, decodePiece(capturedCode)!.owner, move.to);
  }
}

describe('incremental piece-list maintenance', () => {
  it('matches a fresh scan at every ply', () => {
    fc.assert(
      fc.property(anyVariant, picks, (id, chosen) => {
        let state = createGame(getVariant(id));
        const lists = pieceListsOf(state.board);
        assertListsMatchBoard(lists, state.board);

        for (const pick of chosen) {
          const moves = legalMoves(state);
          if (state.result || moves.length === 0) break;
          const move = moves[pick % moves.length]!;

          const { state: next } = makeBoth(state, lists, move);
          state = next;
          assertListsMatchBoard(lists, state.board);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('undoes cleanly back to the board it started from', () => {
    fc.assert(
      fc.property(anyVariant, picks, fc.nat({ max: 512 }), (id, chosen, extraPick) => {
        let state = createGame(getVariant(id));
        const lists = pieceListsOf(state.board);

        for (const pick of chosen) {
          const moves = legalMoves(state);
          if (state.result || moves.length === 0) break;
          const move = moves[pick % moves.length]!;
          state = makeBoth(state, lists, move).state;
        }

        const moves = legalMoves(state);
        if (state.result || moves.length === 0) return;
        const move = moves[extraPick % moves.length]!;
        const mover = decodePiece(state.board[move.from]!)!.owner;
        const boardBefore = state.board; // applyMove never mutates its input

        const { capturedCode } = makeBoth(state, lists, move);
        unmakeLists(lists, move, mover, capturedCode);
        assertListsMatchBoard(lists, boardBefore);
      }),
      { numRuns: 100 },
    );
  });
});
