// Game lifecycle — spec 7.3 and 7.5.
//
// The engine is pure: same state plus same move always gives the same result,
// state is plain serialisable data, and nothing here knows about screens, clocks
// or networks. `applyMove` returns a new state; it never mutates its input.

import { IllegalMoveError } from './errors.js';
import { boardToFen, parsePosition, tallySides, validateAgainstVariant } from './fen.js';
import { goalSquares } from './goals.js';
import { findLegalMove, legalMoves } from './moves.js';
import { parseMove } from './notation.js';
import { EMPTY, decodePiece, other } from './pieces.js';
import { isSealed } from './analysis.js';
import type {
  GameEvent,
  GameResult,
  GameState,
  MoveInput,
  Side,
  VariantConfig,
} from './types.js';

/** board + side to move (2.9). */
export function positionKey(state: GameState): string {
  return keyOf(state.board, state.turn);
}

function keyOf(board: Int8Array, turn: Side): string {
  return (turn === 'blue' ? 'b' : 'r') + String.fromCharCode(...board);
}

function sideOnGoal(state: GameState, side: Side): boolean {
  for (const square of goalSquares(state.variant, side)) {
    const code = state.board[square]!;
    if (code === EMPTY) continue;
    if (decodePiece(code)!.owner === side) return true;
  }
  return false;
}

/**
 * Seeds the repetition count and settles whether the position is already over.
 * Both loaders go through here, so they can't disagree (7.5).
 */
function settleLoadedPosition(state: GameState): GameState {
  state.positionCounts.set(positionKey(state), 1);

  // A side already standing on its goal has won: mark the position over rather
  // than letting play continue (2.7). If somehow both are, the side that is not
  // to move is the one who just played.
  const onGoal = (['blue', 'red'] as const).filter((side) => sideOnGoal(state, side));
  if (onGoal.length > 0) {
    const winner = onGoal.find((side) => side !== state.turn) ?? onGoal[0]!;
    state.result = { winner, reason: 'corner' };
    return state;
  }

  if (legalMoves(state).length === 0) {
    state.result = { winner: other(state.turn), reason: 'no-moves' };
  }

  return state;
}

export function fromFen(fen: string, variant: VariantConfig): GameState {
  const { board, turn } = parsePosition(fen);
  validateAgainstVariant(board, variant);

  return settleLoadedPosition({
    variant,
    board,
    turn,
    ply: 0,
    positionCounts: new Map(),
    result: null,
  });
}

export function toFen(state: GameState): string {
  return boardToFen(state.board, state.turn);
}

export function createGame(variant: VariantConfig): GameState {
  return fromFen(variant.start, variant);
}

export function getResult(state: GameState): GameResult | null {
  return state.result;
}

export function applyMove(
  state: GameState,
  move: MoveInput,
): { state: GameState; events: GameEvent[] } {
  // 1. Reject anything that isn't legal right now.
  if (state.result) {
    throw new IllegalMoveError('the game is over');
  }
  const legal = findLegalMove(state, move);
  if (!legal) {
    throw new IllegalMoveError(
      `illegal move ${move.from}->${move.to} for ${state.turn} in this position`,
    );
  }

  const mover = state.turn;
  const sealedBefore = {
    blue: isSealed(state, 'blue'),
    red: isSealed(state, 'red'),
  };
  const countsBefore = tallySides(state.board);

  // 2. Remove any captured piece; move the piece from `from` to `to`.
  const board = Int8Array.from(state.board);
  board[legal.to] = board[legal.from]!;
  board[legal.from] = EMPTY;

  const next: GameState = {
    variant: state.variant,
    board,
    turn: mover,
    // 3. ply += 1
    ply: state.ply + 1,
    positionCounts: new Map(state.positionCounts),
    result: null,
  };

  // 4. Events, in order: move, capture, type-extinct, sealed.
  const events: GameEvent[] = [
    { type: 'move', from: legal.from, to: legal.to, piece: legal.piece },
  ];

  if (legal.captured) {
    events.push({
      type: 'capture',
      at: legal.to,
      captured: legal.captured,
      by: legal.piece,
    });

    const victim = legal.captured;
    if (victim.owner !== 'neutral') {
      const countsAfter = tallySides(board);
      if (countsBefore[victim.owner][victim.type] > 0 && countsAfter[victim.owner][victim.type] === 0) {
        events.push({ type: 'type-extinct', side: victim.owner, pieceType: victim.type });
      }
    }
  }

  for (const side of ['blue', 'red'] as const) {
    if (!sealedBefore[side] && isSealed(next, side)) {
      events.push({ type: 'sealed', side });
    }
  }

  // 5. Corner check, before anything else: a move that reaches the goal wins
  //    even if it also leaves the opponent with no moves. A neutral move can
  //    never trigger this, because a neutral is nobody's piece.
  if (sideOnGoal(next, mover)) {
    next.result = { winner: mover, reason: 'corner' };
    events.push({ type: 'game-over', result: next.result });
    return { state: next, events };
  }

  // 6. Switch turn.
  next.turn = other(mover);

  // 7. No legal moves for the new side to move: they lose (2.8).
  if (legalMoves(next).length === 0) {
    next.result = { winner: mover, reason: 'no-moves' };
    events.push({ type: 'game-over', result: next.result });
    return { state: next, events };
  }

  // 8. Threefold repetition (2.9).
  const key = positionKey(next);
  const seen = (next.positionCounts.get(key) ?? 0) + 1;
  next.positionCounts.set(key, seen);
  if (seen >= next.variant.draw.repetitions) {
    next.result = { winner: null, reason: 'repetition' };
    events.push({ type: 'game-over', result: next.result });
    return { state: next, events };
  }

  // 9. Move limit (2.9).
  if (next.ply >= next.variant.draw.maxPlies) {
    next.result = { winner: null, reason: 'move-limit' };
    events.push({ type: 'game-over', result: next.result });
  }

  return { state: next, events };
}

/** Ends the game for the resigning side. Always allowed (2.9). */
export function resign(state: GameState, side: Side): GameState {
  if (state.result) throw new IllegalMoveError('the game is over');
  return { ...state, result: { winner: other(side), reason: 'resign' } };
}

/**
 * `side` ran out of time, so the opponent wins.
 *
 * The engine has no timers and never decides this for itself — the caller owns
 * the clock and says when it has fallen. This exists so that a flagged game
 * carries a result like any other.
 */
export function flag(state: GameState, side: Side): GameState {
  if (state.result) throw new IllegalMoveError('the game is over');
  return { ...state, result: { winner: other(side), reason: 'flag' } };
}

/**
 * `side` stopped being there, and the opponent claimed the game.
 *
 * Like `flag`, the engine never decides this for itself: it has no notion of
 * a connection, and the only thing that does is the room (docs/ONLINE.md).
 * This exists so that the ending has a name of its own rather than borrowing
 * `resign`, which would put words in the mouth of somebody whose wifi died.
 */
export function abandon(state: GameState, side: Side): GameState {
  if (state.result) throw new IllegalMoveError('the game is over');
  return { ...state, result: { winner: other(side), reason: 'abandoned' } };
}

/** Both players agreed a draw (2.9). */
export function agreeDraw(state: GameState): GameState {
  if (state.result) throw new IllegalMoveError('the game is over');
  return { ...state, result: { winner: null, reason: 'agreed' } };
}

/** Abandoned before it became a game. Counts for nothing. */
export function abortGame(state: GameState): GameState {
  if (state.result) throw new IllegalMoveError('the game is over');
  return { ...state, result: { winner: null, reason: 'aborted' } };
}

/**
 * The move list is the source of truth: full state is always replay(variant,
 * moves). Saved games, undo, shareable links and any future server log all use
 * this (8.3).
 */
export function replay(
  variant: VariantConfig,
  moves: string[],
): { state: GameState; events: GameEvent[][] } {
  let state = createGame(variant);
  const events: GameEvent[][] = [];

  for (const text of moves) {
    const move = parseMove(state, text);
    const applied = applyMove(state, move);
    state = applied.state;
    events.push(applied.events);
  }

  return { state, events };
}
