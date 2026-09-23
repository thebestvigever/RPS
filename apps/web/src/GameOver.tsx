// Spec 10.7's game-over overlay. It shows the winner and the reason in words,
// "plus moves played, captures each side, and which types were wiped out and
// when", and carries four buttons.
//
// Every number comes from `summarise` over the engine's own event stream, not
// from comparing the start position with the end one (spec 7.7) — "when a type
// went extinct" is not recoverable from two boards at all.
//
// Spec 10.7's "local stats per variant and difficulty: wins, losses, draws
// and current streak" now lands here (M8) — App.tsx owns the localStorage
// read/write (spec 10.13) and hands down the number for whichever variant
// and difficulty this game was actually played at; this component only
// ever renders what it's given, same as every other fact on this overlay.

import { sideName } from '@sps/board';
import type { SideNames } from '@sps/board';
import type { GameResult, GameSummary, Side } from '@sps/engine';
import { describeExtinction, describeResult, fullMoveOf } from './announce.js';
import type { VariantStats } from './stats.js';

export interface GameOverProps {
  result: GameResult;
  summary: GameSummary;
  /** null in pass-and-play, where there is no "your side" to swap. */
  humanSide: Side | null;
  /** Pass-and-play's optional player names — see Game's own `names` prop. */
  names?: SideNames;
  onRematch: () => void;
  onSwapSides: (() => void) | null;
  onReview: () => void;
  onCopyLink: () => void;
  /** Feedback for Copy link — the clipboard can simply refuse, and silence reads as a broken button. */
  copyNote: string | null;
  /** Spec 10.7's stats for this variant and difficulty — null in pass-and-play, where there's no fixed "you" to keep one for (stats.ts's own header). */
  stats?: VariantStats | null;
}

export default function GameOver({
  result,
  summary,
  humanSide,
  names,
  onRematch,
  onSwapSides,
  onReview,
  onCopyLink,
  copyNote,
  stats,
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
      <p className={headline ? 'game-over-reason' : 'game-over-result'}>{describeResult(result, names)}</p>

      <dl className="game-over-facts">
        <div>
          <dt>Moves</dt>
          <dd>{fullMoveOf(summary.plies)}</dd>
        </div>
        <div>
          <dt>{sideName('blue', names)} took</dt>
          <dd>{summary.captures.blue}</dd>
        </div>
        <div>
          <dt>{sideName('red', names)} took</dt>
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
          Wiped out: {summary.extinctions.map((extinction) => describeExtinction(extinction, names)).join(' · ')}
        </p>
      )}

      {stats && (
        <p className="game-over-stats">
          Record: {stats.wins}W {stats.losses}L {stats.draws}D
          {stats.streak > 1 ? ` · ${stats.streak}-win streak` : ''}
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
        <p className="game-over-note">You played {sideName(humanSide, names)}.</p>
      )}
      {copyNote && <p className="game-over-note" role="status">{copyNote}</p>}
    </div>
  );
}
