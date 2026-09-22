import { useMemo, useState } from 'react';
import { VARIANTS, VARIANT_BLURBS, VARIANT_IDS } from '@sps/engine';
import type { VariantId } from '@sps/engine';
import Game from './Game.js';
import { defaultAppearance } from './Board.js';
import './styles.css';

// Home -> Game, spec 10.1's two smallest screens. M3b's gate (docs/VISUAL_SYSTEM.md
// 8, BUILD_PLAN.md): two people finish a game of Original on one phone. The
// variant picker offers all three because nothing in Game.tsx is Original-
// specific — it plays a Move wherever legalMoves() says one exists, which
// already covers a neutral capture and a 2x2 goal block for free. That is a
// consequence of "variants are data" (CLAUDE.md), not separate M5 work pulled
// forward; M5 is the polish these variants are still owed (the neutral pulse
// cue, danger diamonds, the rest of spec 10.5's aids).
type Screen = { name: 'home' } | { name: 'game'; variant: VariantId };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [selected, setSelected] = useState<VariantId>('original');
  const appearance = useMemo(defaultAppearance, []);

  if (screen.name === 'game') {
    return (
      <Game
        variant={VARIANTS[screen.variant]}
        theme="field-notes"
        family="cut-stone"
        appearance={appearance}
        onExit={() => setScreen({ name: 'home' })}
      />
    );
  }

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

      <button className="play" type="button" onClick={() => setScreen({ name: 'game', variant: selected })}>
        Play pass-and-play — {VARIANTS[selected].name}
      </button>

      <div className="status">
        <p>
          vs Computer is next (M4). Aids beyond type counts — threat lines, the
          race meter, the Keep lock — are M6.
        </p>
      </div>
    </main>
  );
}
