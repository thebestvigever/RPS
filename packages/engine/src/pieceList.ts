// Piece lists — docs/engine/04-SPEED.md §2.
//
// `legalMoves` and the AI's evaluation both loop every one of the 81 squares to
// find the handful that hold a piece. A piece list is the fix: the occupied
// squares for each owner, plus a back-pointer so removing one is an O(1)
// swap-with-last instead of a scan. A caller that keeps one current through
// `make`/`unmake` (the search) can then walk just its own pieces — about 7-10
// in the midgame, not 81.

import { SQUARE_COUNT } from './board.js';
import { EMPTY, decodePiece } from './pieces.js';
import type { Owner, Square } from './types.js';

/**
 * Per-owner lists of occupied squares, plus `slot` so any one of them can be
 * found and removed in O(1). Sized to the board itself — more than enough for
 * any legal position, and allocated once, not per node.
 */
export interface PieceLists {
  readonly squares: Record<Owner, Int8Array>;
  readonly count: Record<Owner, number>;
  /** slot[square] = that square's index within its owner's `squares` list, while occupied. */
  readonly slot: Int8Array;
}

export function pieceListsOf(board: Int8Array): PieceLists {
  const squares: Record<Owner, Int8Array> = {
    blue: new Int8Array(SQUARE_COUNT),
    red: new Int8Array(SQUARE_COUNT),
    neutral: new Int8Array(SQUARE_COUNT),
  };
  const count: Record<Owner, number> = { blue: 0, red: 0, neutral: 0 };
  const slot = new Int8Array(SQUARE_COUNT).fill(-1);

  for (let square = 0; square < SQUARE_COUNT; square++) {
    const code = board[square]!;
    if (code === EMPTY) continue;
    const { owner } = decodePiece(code)!;
    slot[square] = count[owner];
    squares[owner][count[owner]] = square;
    count[owner]++;
  }

  return { squares, count, slot };
}

/** A piece that was on `from` is now on `to` — no capture involved. */
export function relocateInPieceLists(lists: PieceLists, owner: Owner, from: Square, to: Square): void {
  const idx = lists.slot[from]!;
  lists.squares[owner][idx] = to;
  lists.slot[to] = idx;
  lists.slot[from] = -1;
}

/** The piece on `square` is gone — swap-with-last removal from its owner's list. */
export function removeFromPieceLists(lists: PieceLists, owner: Owner, square: Square): void {
  const list = lists.squares[owner];
  const idx = lists.slot[square]!;
  const lastIndex = --lists.count[owner];
  const movedSquare = list[lastIndex]!;
  list[idx] = movedSquare;
  lists.slot[movedSquare] = idx;
  lists.slot[square] = -1;
}

/** Undo of `removeFromPieceLists`: put the piece back on `square`. */
export function insertIntoPieceLists(lists: PieceLists, owner: Owner, square: Square): void {
  const idx = lists.count[owner]++;
  lists.squares[owner][idx] = square;
  lists.slot[square] = idx;
}
