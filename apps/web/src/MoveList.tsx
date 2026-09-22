// Spec 10.8's move list: "the notation of 8.1, numbered by full moves:
// `1. Sd4-d5 Se7-d6  2. …`. Tapping a move shows that position read-only."
//
// It renders the history Game.tsx already keeps — the same array that IS the
// game (CLAUDE.md: the move list is the source of truth, full state is always
// `replay(variant, moves)`). Nothing here derives a position; it reports a ply
// number upward and Game.tsx replays to it, so the list and the board can
// never disagree about what move 7 was.
//
// On a phone it lives in a drawer (spec 10.11). `<details>` rather than a
// hand-rolled disclosure: it is keyboard accessible, announces its own state,
// and survives having no JavaScript opinions about it.

import { fullMoveOf } from './announce.js';

export interface MoveListProps {
  moves: readonly string[];
  /** How many plies are being shown — null when the live position is. */
  viewPly: number | null;
  /** Open by default on a screen with room for it. */
  defaultOpen: boolean;
  onPick: (ply: number) => void;
}

export default function MoveList({ moves, viewPly, defaultOpen, onPick }: MoveListProps) {
  // Ply n is shown by `viewPly === n`; live shows the last move as current.
  const current = viewPly ?? moves.length;

  const rows = [];
  for (let ply = 0; ply < moves.length; ply += 2) {
    rows.push({
      number: fullMoveOf(ply + 1),
      blue: { text: moves[ply]!, ply: ply + 1 },
      red: moves[ply + 1] ? { text: moves[ply + 1]!, ply: ply + 2 } : null,
    });
  }

  return (
    <details className="movelist" open={defaultOpen}>
      <summary>
        Moves <span className="movelist-count">{moves.length === 0 ? '—' : fullMoveOf(moves.length)}</span>
      </summary>
      {moves.length === 0 ? (
        <p className="movelist-empty">No moves yet.</p>
      ) : (
        <ol className="movelist-rows">
          {rows.map((row) => (
            <li key={row.number}>
              <span className="movelist-number">{row.number}.</span>
              {[row.blue, row.red].map((entry) =>
                entry === null ? null : (
                  <button
                    key={entry.ply}
                    type="button"
                    className={`movelist-move${current === entry.ply ? ' movelist-move--on' : ''}`}
                    onClick={() => onPick(entry.ply)}
                    aria-current={current === entry.ply}
                  >
                    {entry.text}
                  </button>
                ),
              )}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
