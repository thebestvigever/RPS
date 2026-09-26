// Board geometry — spec 2.1. Pure arithmetic, no rules.

import type { Square } from './types.js';

export const FILES = 9;
export const RANKS = 9;
export const SQUARE_COUNT = FILES * RANKS; // 81

export const FILE_LETTERS = 'abcdefghi';

/** Square index from zero-based row (0 = rank 9, top) and col (0 = file a). */
export function toIndex(row: number, col: number): Square {
  return row * FILES + col;
}

export function rowOf(square: Square): number {
  return Math.floor(square / FILES);
}

export function colOf(square: Square): number {
  return square % FILES;
}

/** `a1` -> 72, `e5` -> 40, `i9` -> 8. Throws on anything that is not a square name. */
export function parseSquare(name: string): Square {
  if (name.length !== 2) throw new Error(`Not a square name: ${name}`);
  const col = FILE_LETTERS.indexOf(name[0]!);
  const rank = Number(name[1]);
  if (col < 0 || !Number.isInteger(rank) || rank < 1 || rank > RANKS) {
    throw new Error(`Not a square name: ${name}`);
  }
  return toIndex(RANKS - rank, col);
}

/** 72 -> `a1`, 40 -> `e5`, 8 -> `i9`. */
export function squareName(square: Square): string {
  if (!Number.isInteger(square) || square < 0 || square >= SQUARE_COUNT) {
    throw new Error(`Not a square index: ${square}`);
  }
  return `${FILE_LETTERS[colOf(square)]}${RANKS - rowOf(square)}`;
}

/** King (Chebyshev) distance. a1 to i9 is 8. */
export function distance(a: Square, b: Square): number {
  return Math.max(Math.abs(rowOf(a) - rowOf(b)), Math.abs(colOf(a) - colOf(b)));
}

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

function computeNeighbours(): ReadonlyArray<readonly Square[]> {
  const table: Square[][] = [];
  for (let square = 0; square < SQUARE_COUNT; square++) {
    const row = rowOf(square);
    const col = colOf(square);
    const list: Square[] = [];
    for (const [dr, dc] of DIRECTIONS) {
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < RANKS && c >= 0 && c < FILES) list.push(toIndex(r, c));
    }
    // Ascending, so move generation emits destinations in square order (spec 7.4).
    list.sort((x, y) => x - y);
    table.push(list);
  }
  return table;
}

/**
 * The up to 8 squares at king distance 1, ascending.
 * Corners have 3, edges 5, interior 8.
 */
export const NEIGHBOURS = computeNeighbours();

export function neighbours(square: Square): readonly Square[] {
  const list = NEIGHBOURS[square];
  if (!list) throw new Error(`Not a square index: ${square}`);
  return list;
}

/**
 * `NEIGHBOURS` flattened into one `Int8Array`, with `NEIGHBOUR_OFFSETS[square]`
 * .. `NEIGHBOUR_OFFSETS[square + 1]` marking each square's slice — an array of
 * arrays is an extra indirection and allocation per square that the engine's
 * own hot loops (move generation, `isSealed`'s walk, threat detection) don't
 * need to pay for on every node (docs/engine/04-SPEED.md §5). Internal only:
 * `NEIGHBOURS` stays the public shape everything else reads.
 */
function computeFlatNeighbours(): { offsets: Int32Array; flat: Int8Array } {
  const offsets = new Int32Array(SQUARE_COUNT + 1);
  let total = 0;
  for (let square = 0; square < SQUARE_COUNT; square++) {
    offsets[square] = total;
    total += NEIGHBOURS[square]!.length;
  }
  offsets[SQUARE_COUNT] = total;

  const flat = new Int8Array(total);
  let i = 0;
  for (let square = 0; square < SQUARE_COUNT; square++) {
    for (const to of NEIGHBOURS[square]!) flat[i++] = to;
  }

  return { offsets, flat };
}

const { offsets: NEIGHBOUR_OFFSETS, flat: NEIGHBOUR_FLAT } = computeFlatNeighbours();
export { NEIGHBOUR_FLAT, NEIGHBOUR_OFFSETS };
