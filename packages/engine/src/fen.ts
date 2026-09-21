// Position notation — spec 8.2.
//
// <rank 9>/<rank 8>/.../<rank 1> <side to move>
//   - within a rank, files run a to i
//   - a digit 1-9 is that many empty squares
//   - blue pieces are `r p s`, red `R P S`, neutral `nR nP nS`
//
// The variant (goals, neutral rules) is not part of the string; it travels
// alongside it. This module only reads and writes the notation — loading a
// position into a playable GameState is game.ts, which needs move generation.

import { FILES, RANKS, SQUARE_COUNT, toIndex } from './board.js';
import { FenError } from './errors.js';
import { EMPTY, decodePiece, encodePiece } from './pieces.js';
import type { Owner, PieceType, Side, VariantConfig } from './types.js';

const TYPE_BY_LETTER: Record<string, PieceType> = {
  r: 'rock',
  p: 'paper',
  s: 'scissors',
};

const LETTER_BY_TYPE: Record<PieceType, string> = {
  rock: 'R',
  paper: 'P',
  scissors: 'S',
};

export interface ParsedPosition {
  board: Int8Array;
  turn: Side;
}

/** Structural parse. Variant rules are `validateAgainstVariant`. */
export function parsePosition(fen: string): ParsedPosition {
  const parts = fen.trim().split(/\s+/);
  if (parts.length !== 2) {
    throw new FenError(
      `a position is "<9 ranks> <side to move>", got ${parts.length} field(s): "${fen}"`,
    );
  }

  const [boardField, sideField] = parts as [string, string];
  if (sideField !== 'blue' && sideField !== 'red') {
    throw new FenError(`side to move must be "blue" or "red", got "${sideField}"`);
  }

  const ranks = boardField.split('/');
  if (ranks.length !== RANKS) {
    throw new FenError(`a position has ${RANKS} ranks, got ${ranks.length}: "${boardField}"`);
  }

  const board = new Int8Array(SQUARE_COUNT);

  for (let row = 0; row < RANKS; row++) {
    const rank = ranks[row]!;
    const rankName = RANKS - row;
    let col = 0;

    for (let i = 0; i < rank.length; i++) {
      const ch = rank[i]!;

      if (ch >= '1' && ch <= '9') {
        col += Number(ch);
        continue;
      }

      let owner: Owner;
      let type: PieceType;

      if (ch === 'n') {
        const next = rank[i + 1];
        if (next === undefined) {
          throw new FenError(`rank ${rankName} ends with a bare "n": "${rank}"`);
        }
        if (!'RPS'.includes(next)) {
          throw new FenError(
            `a neutral piece is written nR, nP or nS, got "n${next}" in rank ${rankName}`,
          );
        }
        owner = 'neutral';
        type = TYPE_BY_LETTER[next.toLowerCase()]!;
        i++;
      } else {
        const found = TYPE_BY_LETTER[ch.toLowerCase()];
        if (!found) {
          throw new FenError(`unknown character "${ch}" in rank ${rankName}: "${rank}"`);
        }
        owner = ch === ch.toUpperCase() ? 'red' : 'blue';
        type = found;
      }

      if (col >= FILES) {
        throw new FenError(`rank ${rankName} runs past file i: "${rank}"`);
      }

      board[toIndex(row, col)] = encodePiece({ owner, type });
      col++;
    }

    if (col !== FILES) {
      throw new FenError(
        `rank ${rankName} accounts for ${col} files, expected ${FILES}: "${rank}"`,
      );
    }
  }

  return { board, turn: sideField };
}

export type Tally = Record<Side, Record<PieceType, number>>;

export function tallySides(board: Int8Array): Tally {
  const tally: Tally = {
    blue: { rock: 0, paper: 0, scissors: 0 },
    red: { rock: 0, paper: 0, scissors: 0 },
  };
  for (let square = 0; square < SQUARE_COUNT; square++) {
    const piece = decodePiece(board[square]!);
    if (piece && piece.owner !== 'neutral') tally[piece.owner][piece.type]++;
  }
  return tally;
}

function hasNeutral(board: Int8Array): boolean {
  for (let square = 0; square < SQUARE_COUNT; square++) {
    const piece = decodePiece(board[square]!);
    if (piece?.owner === 'neutral') return true;
  }
  return false;
}

const startTallies = new WeakMap<VariantConfig, Tally>();

/** How many of each type a side starts this variant with — the cap below. */
function startTally(variant: VariantConfig): Tally {
  const cached = startTallies.get(variant);
  if (cached) return cached;
  const tally = tallySides(parsePosition(variant.start).board);
  startTallies.set(variant, tally);
  return tally;
}

/**
 * Rejects a neutral piece in a variant without neutrals, and more pieces for a
 * side than the variant starts with.
 *
 * Neutral counts are deliberately NOT capped by the start position: a neutral of
 * a type the variant never places is a legal position (spec 11.2 loads a neutral
 * Rock, which no variant starts with).
 */
export function validateAgainstVariant(board: Int8Array, variant: VariantConfig): void {
  if (!variant.neutrals && hasNeutral(board)) {
    throw new FenError(`the ${variant.name} variant has no neutral pieces`);
  }

  const tally = tallySides(board);
  const limits = startTally(variant);

  for (const side of ['blue', 'red'] as const) {
    for (const type of ['rock', 'paper', 'scissors'] as const) {
      if (tally[side][type] > limits[side][type]) {
        throw new FenError(
          `${side} has ${tally[side][type]} ${type}, more than the ${limits[side][type]} ` +
            `the ${variant.name} variant starts with`,
        );
      }
    }
  }
}

export function boardToFen(board: Int8Array, turn: Side): string {
  const ranks: string[] = [];

  for (let row = 0; row < RANKS; row++) {
    let rank = '';
    let gap = 0;

    for (let col = 0; col < FILES; col++) {
      const code = board[toIndex(row, col)]!;
      if (code === EMPTY) {
        gap++;
        continue;
      }
      if (gap > 0) {
        rank += String(gap);
        gap = 0;
      }
      const piece = decodePiece(code)!;
      const letter = LETTER_BY_TYPE[piece.type];
      rank +=
        piece.owner === 'neutral'
          ? `n${letter}`
          : piece.owner === 'red'
            ? letter
            : letter.toLowerCase();
    }

    if (gap > 0) rank += String(gap);
    ranks.push(rank);
  }

  return `${ranks.join('/')} ${turn}`;
}
