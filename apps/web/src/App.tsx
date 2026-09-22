import { useMemo, useState } from 'react';
import { SHARE_PREFIX, VARIANTS, VARIANT_BLURBS, VARIANT_IDS, decodeRecord, other } from '@sps/engine';
import type { GameRecord, Side, VariantId } from '@sps/engine';
import { PRESETS, presetById } from '@sps/match';
import { LEVELS } from '@sps/ai';
import type { Level } from '@sps/ai';
import type { SideNames } from '@sps/board';
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
type Screen =
  | { name: 'home' }
  | {
      name: 'game';
      variant: VariantId;
      computer: Computer | null;
      /**
       * Bumped on every rematch, and used as Game's `key`. A rematch is a
       * remount, not a reset: clearing a dozen pieces of state by hand is a
       * list that silently rots as state is added, and this way the clock
       * stack, the worker and the move history cannot survive into a game
       * that is supposed to be new.
       */
      round: number;
      /** Pass-and-play's optional player names, set from Home. Empty for vs-computer — that panel still reads Blue/Red. */
      names: SideNames;
    }
  | { name: 'review'; record: GameRecord };

type Mode = 'pass-and-play' | 'vs-computer';
/** Spec 10.1's side picker. Random is resolved once, when the game starts. */
type SideChoice = Side | 'random';

// docs/BUILD_PLAN.md's C1 leftover: "the time-control picker... waits on
// visual direction." M3c is that direction, so it's built here rather than
// defaulting silently — a clock with no way to choose its length would be an
// odd thing to ship. "10+5" reads as a reasonable first game on this game's
// own pace (spec 6.1: ~67 moves a side, not chess's 40).
const DEFAULT_CONTROL_ID = '10+5';
const LEVEL_IDS = Object.keys(LEVELS) as Level[];
const LEVEL_LABEL: Record<Level, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const SIDE_LABEL: Record<SideChoice, string> = { blue: 'Blue', red: 'Red', random: 'Random' };

/**
 * A shared game in the address bar (spec 8.4), read once at startup.
 *
 * Anything unreadable is ignored rather than shown as an error: a mangled
 * link should land the player on Home with a working game to start, not on a
 * dead end explaining a base64 problem they did not cause.
 */
function sharedRecord(): GameRecord | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash.startsWith(SHARE_PREFIX)) return null;
  try {
    return decodeRecord(hash);
  } catch {
    return null;
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => {
    const shared = sharedRecord();
    return shared ? { name: 'review', record: shared } : { name: 'home' };
  });
  const [selected, setSelected] = useState<VariantId>('original');
  const [controlId, setControlId] = useState(DEFAULT_CONTROL_ID);
  const [mode, setMode] = useState<Mode>('pass-and-play');
  const [level, setLevel] = useState<Level>('medium');
  const [sideChoice, setSideChoice] = useState<SideChoice>('blue');
  const [blueName, setBlueName] = useState('');
  const [redName, setRedName] = useState('');
  /**
   * Zen (C2) lives here, not in Game, because a rematch remounts Game — and a
   * player who asked for a quiet board should not have to ask again every
   * game. It is session-only for now; persisting it is M8's `localStorage`
   * work (spec 10.13), along with the rest of `DisplaySettings`.
   */
  const [zen, setZen] = useState(false);
  const appearance = useMemo(defaultAppearance, []);
  const control = useMemo(() => presetById(controlId), [controlId]);

  const goHome = () => {
    // A shared link that stays in the address bar would reopen the shared
    // game on the next reload, which is not what "← Home" was asked for.
    if (typeof window !== 'undefined' && window.location.hash.startsWith(SHARE_PREFIX)) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    setScreen({ name: 'home' });
  };

  if (screen.name === 'review') {
    return (
      <Game
        variant={VARIANTS[screen.record.variant]}
        control={control}
        computer={null}
        theme="field-notes"
        family="cut-stone"
        appearance={appearance}
        initialMoves={screen.record.moves}
        initialResult={screen.record.result ?? null}
        reviewOnly
        onExit={goHome}
        // A shared game is somebody else's; there is nothing here to rematch.
        onRematch={goHome}
      />
    );
  }

  if (screen.name === 'game') {
    return (
      <Game
        key={screen.round}
        variant={VARIANTS[screen.variant]}
        control={control}
        computer={screen.computer}
        theme="field-notes"
        family="cut-stone"
        appearance={appearance}
        names={screen.names}
        onExit={goHome}
        zen={zen}
        onToggleZen={() => setZen((on) => !on)}
        onRematch={(swapSides) =>
          setScreen((current) =>
            current.name !== 'game'
              ? current
              : {
                  ...current,
                  computer:
                    swapSides && current.computer
                      ? { ...current.computer, side: other(current.computer.side) }
                      : current.computer,
                  round: current.round + 1,
                },
          )
        }
      />
    );
  }

  const startGame = () => {
    // Random is settled here, once, rather than inside Game — so a rematch
    // keeps the sides it was actually played with and "Swap sides" means
    // something definite.
    const humanSide: Side = sideChoice === 'random' ? (Math.random() < 0.5 ? 'blue' : 'red') : sideChoice;
    // Names are pass-and-play's own thing (there's no "your side" to name
    // against a computer) — a blank field just falls back to Blue/Red.
    const names: SideNames =
      mode === 'pass-and-play'
        ? { ...(blueName.trim() && { blue: blueName.trim() }), ...(redName.trim() && { red: redName.trim() }) }
        : {};
    setScreen({
      name: 'game',
      variant: selected,
      computer: mode === 'vs-computer' ? { side: other(humanSide), level } : null,
      round: 0,
      names,
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

      {mode === 'pass-and-play' && (
        // Optional — a blank field is Blue/Red, same as before this existed.
        // Pass-and-play only: vs-computer already has "You" (GameOver.tsx)
        // and the computer doesn't need a name of its own.
        <div className="name-fields">
          <label className="time-control">
            Blue's name
            <input
              type="text"
              value={blueName}
              onChange={(event) => setBlueName(event.target.value)}
              placeholder="Blue"
              maxLength={24}
            />
          </label>
          <label className="time-control">
            Red's name
            <input
              type="text"
              value={redName}
              onChange={(event) => setRedName(event.target.value)}
              placeholder="Red"
              maxLength={24}
            />
          </label>
        </div>
      )}

      {mode === 'vs-computer' && (
        <>
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

          {/* Spec 10.1's side picker. It can be offered now that the board
              turns around for a Red-playing human (spec 10.2) — before that,
              choosing Red would have shown you your own pieces starting in
              the far corner. Pass-and-play has no side to pick: one device,
              one orientation. */}
          <div className="mode-picker" role="radiogroup" aria-label="Your side">
            {(['blue', 'red', 'random'] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={sideChoice === choice}
                className={`mode-option${sideChoice === choice ? ' mode-option--on' : ''}`}
                onClick={() => setSideChoice(choice)}
              >
                {SIDE_LABEL[choice]}
              </button>
            ))}
          </div>
        </>
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
