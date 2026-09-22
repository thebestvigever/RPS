import { useMemo, useState } from 'react';
import { VARIANTS, VARIANT_BLURBS, VARIANT_IDS } from '@sps/engine';
import type { VariantId } from '@sps/engine';
import { PRESETS, presetById } from '@sps/match';
import { LEVELS } from '@sps/ai';
import type { Level } from '@sps/ai';
import Game from './Game.js';
import type { Computer } from './Game.js';
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
type Screen = { name: 'home' } | { name: 'game'; variant: VariantId; computer: Computer | null };
type Mode = 'pass-and-play' | 'vs-computer';

// docs/BUILD_PLAN.md's C1 leftover: "the time-control picker... waits on
// visual direction." M3c is that direction, so it's built here rather than
// defaulting silently — a clock with no way to choose its length would be an
// odd thing to ship. "10+5" reads as a reasonable first game on this game's
// own pace (spec 6.1: ~67 moves a side, not chess's 40).
const DEFAULT_CONTROL_ID = '10+5';
const LEVEL_IDS = Object.keys(LEVELS) as Level[];
const LEVEL_LABEL: Record<Level, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [selected, setSelected] = useState<VariantId>('original');
  const [controlId, setControlId] = useState(DEFAULT_CONTROL_ID);
  const [mode, setMode] = useState<Mode>('pass-and-play');
  const [level, setLevel] = useState<Level>('medium');
  const appearance = useMemo(defaultAppearance, []);
  const control = useMemo(() => presetById(controlId), [controlId]);

  if (screen.name === 'game') {
    return (
      <Game
        variant={VARIANTS[screen.variant]}
        control={control}
        computer={screen.computer}
        theme="field-notes"
        family="cut-stone"
        appearance={appearance}
        onExit={() => setScreen({ name: 'home' })}
      />
    );
  }

  const startGame = () => {
    setScreen({
      name: 'game',
      variant: selected,
      // Always Red, always Blue for the human — see Game.tsx's own note on
      // `humanSide` for why "which side" waits on board orientation.
      computer: mode === 'vs-computer' ? { side: 'red', level } : null,
    });
  };

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

      <div className="mode-picker" role="radiogroup" aria-label="Mode">
        {(['pass-and-play', 'vs-computer'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            className={`mode-option${mode === m ? ' mode-option--on' : ''}`}
            onClick={() => setMode(m)}
          >
            {m === 'pass-and-play' ? 'Pass-and-play' : 'vs Computer'}
          </button>
        ))}
      </div>

      {mode === 'vs-computer' && (
        <label className="time-control">
          Difficulty
          <select value={level} onChange={(event) => setLevel(event.target.value as Level)}>
            {LEVEL_IDS.map((id) => (
              <option key={id} value={id}>
                {LEVEL_LABEL[id]}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="time-control">
        Time control
        <select value={controlId} onChange={(event) => setControlId(event.target.value)}>
          {PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </label>

      <button className="play" type="button" onClick={startGame}>
        {mode === 'vs-computer'
          ? `Play vs Computer (${LEVEL_LABEL[level]}) — ${VARIANTS[selected].name}`
          : `Play pass-and-play — ${VARIANTS[selected].name}`}
      </button>

      <div className="status">
        <p>Aids beyond type counts — threat lines, the race meter, the Keep lock — are M6.</p>
      </div>
    </main>
  );
}
