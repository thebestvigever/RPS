// Status-line and aria-live text — spec 10.6. Pure formatting over engine
// events and results; no rendering, no state. Kept close to moveToText's own
// spirit (spec 8.1's grammar is the engine's; this is the same information in
// the sentence a screen reader or a glance at the status line wants).

import { pieceTypeName } from '@sps/board';
import { squareName } from '@sps/engine';
import type { Extinction, GameEvent, GameResult, Move, Side } from '@sps/engine';

function sideName(side: Side): string {
  return side === 'blue' ? 'Blue' : 'Red';
}

/** "Blue Scissors d4 to e5." / "Red Rock captures Blue Scissors on e5." */
export function describeMove(move: Move): string {
  const mover = move.piece.owner === 'neutral' ? 'The neutral' : sideName(move.piece.owner);
  const type = pieceTypeName(move.piece.type);
  const to = squareName(move.to);

  if (!move.captured) {
    return `${mover} ${type} ${squareName(move.from)} to ${to}.`;
  }

  const victimSide = move.captured.owner === 'neutral' ? 'the neutral' : sideName(move.captured.owner);
  const victimType = pieceTypeName(move.captured.type);
  return move.piece.owner === 'neutral'
    ? `Using the neutral ${type} to capture ${victimSide} ${victimType} on ${to}.`
    : `${mover} ${type} captures ${victimSide} ${victimType} on ${to}.`;
}

const REASON_TEXT: Record<string, string> = {
  corner: 'reached the corner',
  'no-moves': 'had no legal moves',
  resign: 'resigned',
  flag: 'ran out of time',
  repetition: 'the same position three times',
  'move-limit': 'the move limit',
  agreed: 'agreement',
};

/**
 * "Blue wins — reached the corner." / "The game is a draw — the move limit."
 * `aborted` gets its own sentence: the addendum is explicit that it "counts
 * for nothing", which "a draw" would misstate — a draw is a result, and an
 * abort is the absence of one.
 */
export function describeResult(result: GameResult): string {
  if (result.reason === 'aborted') return 'Aborted — no result.';
  const reason = REASON_TEXT[result.reason] ?? result.reason;
  if (result.winner) return `${sideName(result.winner)} wins — ${reason}.`;
  return `The game is a draw — ${reason}.`;
}

/**
 * The full status line for one turn: the move that was just made, plus the
 * result if that move ended the game. `events` is what `applyMove` returned;
 * this never re-derives it from a board diff (CLAUDE.md, spec 7.7).
 */
export function describeTurn(events: readonly GameEvent[]): string {
  const moveEvent = events.find((event): event is Extract<GameEvent, { type: 'move' }> => event.type === 'move');
  const captureEvent = events.find((event): event is Extract<GameEvent, { type: 'capture' }> => event.type === 'capture');
  const gameOver = events.find((event): event is Extract<GameEvent, { type: 'game-over' }> => event.type === 'game-over');

  const parts: string[] = [];
  if (moveEvent) {
    const move: Move = {
      from: moveEvent.from,
      to: moveEvent.to,
      piece: moveEvent.piece,
      captured: captureEvent?.captured ?? null,
    };
    parts.push(describeMove(move));
  }
  if (gameOver) parts.push(describeResult(gameOver.result));
  return parts.join(' ');
}

export function whoseTurn(side: Side): string {
  return `${sideName(side)}'s move.`;
}

/**
 * Spec 10.7's overlay copy: "which types were wiped out and when".
 * "Red's Paper, move 7" — numbered by full moves, the way the move list does
 * (spec 10.8), so the two can be read against each other.
 */
export function describeExtinction(extinction: Extinction): string {
  return `${sideName(extinction.side)}'s ${pieceTypeName(extinction.pieceType)}, move ${fullMoveOf(extinction.ply)}`;
}

/** Ply 1 and 2 are both move 1 — the move list's own numbering (spec 10.8). */
export function fullMoveOf(ply: number): number {
  return Math.ceil(ply / 2);
}
