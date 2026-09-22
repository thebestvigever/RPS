import { useMemo, useState } from 'react';
import {
  createGame,
  legalMoves,
  moveToText,
  VARIANTS,
  VARIANT_BLURBS,
  VARIANT_IDS,
} from '@sps/engine';
import type { VariantId } from '@sps/engine';
import Board, { defaultAppearance } from './Board.js';
import './styles.css';

// docs/VISUAL_SYSTEM.md 8, M3a: static board rendering, one theme (Field
// Notes), one family (Cut stone), Original's own layout. Selection, dragging,
// legal-move dots and motion are M3b — this page still only shows a position,
// it does not yet let you play one.
//
// It reads everything from the engine rather than hard-coding it, which is
// the point: variants are data, and the app never restates the rules.
export default function App() {
  const [selected, setSelected] = useState<VariantId>('original');
  const appearance = useMemo(defaultAppearance, []);

  const opening = useMemo(() => {
    const state = createGame(VARIANTS[selected]);
    return legalMoves(state).map((move) => moveToText(state, move));
  }, [selected]);

  return (
    <main>
      <h1>Stone Paper Scissors</h1>
      <p className="sub">
        Ten pieces, king moves, first to the enemy corner. Rules version{' '}
        {VARIANTS.original.rulesVersion}.
      </p>

      {VARIANT_IDS.map((id) => (
        <section
          className={`variant${id === selected ? ' variant--on' : ''}`}
          key={id}
          onClick={() => setSelected(id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setSelected(id);
            }
          }}
          tabIndex={0}
          role="button"
          aria-pressed={id === selected}
        >
          <h2>{VARIANTS[id].name}</h2>
          <p>{VARIANT_BLURBS[id]}</p>
        </section>
      ))}

      <Board
        fen={VARIANTS[selected].start}
        variant={VARIANTS[selected]}
        boardPx={360}
        theme="field-notes"
        family="cut-stone"
        appearance={appearance}
      />

      <div className="status">
        <p>
          Engine and computer opponent are done. Blue has <strong>{opening.length}</strong>{' '}
          legal opening moves in {VARIANTS[selected].name}.
        </p>
        <p className="moves">{opening.join('  ')}</p>
        <p>
          Selecting, dragging, legal-move dots, capture motion and the clock
          furniture are next (M3b/M3c, docs/VISUAL_SYSTEM.md 8).
        </p>
      </div>
    </main>
  );
}
