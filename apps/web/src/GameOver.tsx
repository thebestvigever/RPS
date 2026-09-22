// Spec 10.7's game-over overlay. It shows the winner and the reason in words,
// "plus moves played, captures each side, and which types were wiped out and
// when", and carries four buttons.
//
// Every number comes from `summarise` over the engine's own event stream, not
// from comparing the start position with the end one (spec 7.7) — "when a type
// went extinct" is not recoverable from two boards at all.
//
// Not here, and not pretended: spec 10.7's "local stats per variant and
// difficulty: wins, losses, draws and current streak". Those are localStorage
// (spec 10.13), which is M8's persistence work — the same milestone that owns
// resuming an in-progress game. A streak counter that resets every reload
// would be worse than none.

import type { GameResult, GameSummary, Side } from '@sps/engine';
import { describeExtinction, describeResult, fullMoveOf } from './announce.js';

export interface GameOverProps {
  result: GameResult;
  summary: GameSummary;
  /** null in pass-and-play, where there is no "your side" to swap. */
  humanSide: Side | null;
  onRematch: () => void;
  onSwapSides: (() => void) | null;
  onReview: () => void;
  onCopyLink: () => void;
  /** Feedback for Copy link — the clipboard can simply refuse, and silence reads as a broken button. */
  copyNote: string | null;
}

function sideLabel(side: Side): string {
  return side === 'blue' ? 'Blue' : 'Red';
}

export default function GameOver({
  result,
  summary,
  humanSide,
  onRematch,
  onSwapSides,
  onReview,
  onCopyLink,
  copyNote,
}: GameOverProps) {
  // Spec 10.7 asks for "the winner and the reason in words", which
  // `describeResult` already writes — so it stays verbatim, and the personal
  // framing is a separate line above it rather than a rewrite of it.
  // Splicing "You lose" into the reason sentence produced "You lose — reached
  // the corner", which reads as though the loser was the one who got there.
  const headline =
    humanSide === null ? null : result.winner === null ? 'Draw' : result.winner === humanSide ? 'You win' : 'You lose';

  return (
    <div className="game-over" role="dialog" aria-label="Game over">
      {headline && <p className="game-over-result">{headline}</p>}
      <p className={headline ? 'game-over-reason' : 'game-over-result'}>{describeResult(result)}</p>

      <dl className="game-over-facts">
        <div>
          <dt>Moves</dt>
          <dd>{fullMoveOf(summary.plies)}</dd>
        </div>
        <div>
          <dt>Blue took</dt>
          <dd>{summary.captures.blue}</dd>
        </div>
        <div>
          <dt>Red took</dt>
          <dd>{summary.captures.red}</dd>
        </div>
        {summary.neutralCaptures > 0 && (
          <div>
            <dt>By a neutral</dt>
            <dd>{summary.neutralCaptures}</dd>
          </div>
        )}
      </dl>

      {summary.extinctions.length > 0 && (
        <p className="game-over-extinct">
          Wiped out: {summary.extinctions.map(describeExtinction).join(' · ')}
        </p>
      )}

      <div className="game-over-buttons">
        <button type="button" className="play" onClick={onRematch}>
          Rematch
        </button>
        {onSwapSides && (
          <button type="button" onClick={onSwapSides}>
            Swap sides
          </button>
        )}
        <button type="button" onClick={onReview}>
          Review
        </button>
        <button type="button" onClick={onCopyLink}>
          Copy link
        </button>
      </div>

      {humanSide && onSwapSides && (
        <p className="game-over-note">You played {sideLabel(humanSide)}.</p>
      )}
      {copyNote && <p className="game-over-note" role="status">{copyNote}</p>}
    </div>
  );
}
