// Position notation — spec 8.2.
//
// <rank 9>/<rank 8>/.../<rank 1> <side to move>
//   - within a rank, files run a to i
//   - a digit 1-9 is that many empty squares
//   - blue pieces are `r p s`, red `R P S`, neutral `nR nP nS`
//
// M1. fromFen MUST reject: a rank that does not add up to 9 files, an unknown
// character, a missing side to move, a neutral piece in a variant without
// neutrals, and more pieces for a side than the variant starts with. It MUST
// record the initial position with count 1 and detect an already-finished
// position (a side on its goal, or no legal moves for the side to move) --
// spec 7.5.

import { NotImplementedError } from './errors.js';
import type { GameState, VariantConfig } from './types.js';

export function fromFen(_fen: string, _variant: VariantConfig): GameState {
  throw new NotImplementedError('fromFen', '8.2');
}

export function toFen(_state: GameState): string {
  throw new NotImplementedError('toFen', '8.2');
}
