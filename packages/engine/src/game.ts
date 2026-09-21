// Game lifecycle — spec 7.3 and 7.5.
//
// applyMove MUST do these steps in this order:
//   1. If the game is over or the move is not in legalMoves, throw IllegalMoveError.
//   2. Remove any captured piece from `to`; move the piece from `from` to `to`.
//   3. ply += 1
//   4. Emit events: `move`, then `capture`, then `type-extinct` for each type whose
//      count just reached zero, then `sealed` for each side just sealed.
//   5. Corner check. Mover has a piece on any of its goal squares -> winner: mover,
//      reason 'corner'. Stop. (A neutral move can never trigger this.)
//   6. Switch turn.
//   7. No-moves check. New side to move has no legal moves -> winner: previous mover,
//      reason 'no-moves'. Stop.
//   8. Repetition. Increment positionKey count; at 3 -> draw, reason 'repetition'. Stop.
//   9. Move limit. ply >= variant.draw.maxPlies -> draw, reason 'move-limit'.
//  10. If a result was set, emit 'game-over'.
//
// The corner check comes first: a move that reaches the goal wins even if it also
// leaves the opponent with no moves.
//
// createGame and fromFen MUST record the initial position with count 1, and MUST
// detect an already-finished position.
//
// The engine is pure: same state plus same move always gives the same result, state
// is plain serialisable data, and nothing here knows about screens, clocks or networks.

import { NotImplementedError } from './errors.js';
import type {
  GameEvent,
  GameResult,
  GameState,
  MoveInput,
  VariantConfig,
} from './types.js';

export function createGame(_variant: VariantConfig): GameState {
  throw new NotImplementedError('createGame', '7.3');
}

export function applyMove(
  _state: GameState,
  _move: MoveInput,
): { state: GameState; events: GameEvent[] } {
  throw new NotImplementedError('applyMove', '7.5');
}

export function getResult(_state: GameState): GameResult | null {
  throw new NotImplementedError('getResult', '7.3');
}

/** board + side to move. Backs threefold repetition (spec 2.9). */
export function positionKey(_state: GameState): string {
  throw new NotImplementedError('positionKey', '7.3');
}

/** The move list is the source of truth: state is always replay(variant, moves). */
export function replay(
  _variant: VariantConfig,
  _moves: string[],
): { state: GameState; events: GameEvent[][] } {
  throw new NotImplementedError('replay', '8.3');
}
