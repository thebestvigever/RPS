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
import './styles.css';

// Placeholder home screen. The real one is spec 10.1 and lands with M3, once
// there is visual direction to build to.
//
// It reads everything from the engine rather than hard-coding it, which is the
// point: variants are data, and the app never restates the rules.
export default function App() {
  const [selected, setSelected] = useState<VariantId>('original');

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

      <div className="status">
        <p>
          Engine and computer opponent are done. Blue has <strong>{opening.length}</strong>{' '}
          legal opening moves in {VARIANTS[selected].name}.
        </p>
        <p className="moves">{opening.join('  ')}</p>
        <p>
          The board itself is next (M3), once there is visual direction to build
          to. Until then this page only proves the engine reaches the browser.
        </p>
      </div>
    </main>
  );
}
