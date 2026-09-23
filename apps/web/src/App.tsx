import { useCallback, useEffect, useMemo, useState } from 'react';
import { SHARE_PREFIX, VARIANTS, VARIANT_BLURBS, VARIANT_IDS, decodeRecord, other } from '@sps/engine';
import { parseInvite } from '@sps/referee';
import type { GameRecord, GameResult, Side, VariantId } from '@sps/engine';
import { PRESETS, presetById } from '@sps/match';
import type { ClockStack, DisplaySettings } from '@sps/match';
import { LEVELS } from '@sps/ai';
import type { Level } from '@sps/ai';
import type { SideNames, ThemeId } from '@sps/board';
import Game from './Game.js';
import type { Computer } from './Game.js';
import Online from './Online.js';
import type { OnlineEntry } from './Online.js';
import { createMatch } from './referee-api.js';
import Tutorial from './Tutorial.js';
import Settings from './Settings.js';
import { defaultAppearance } from './Board.js';
import { recordOutcome, statsFor } from './stats.js';
import {
  clearInProgressGame,
  loadInProgressGame,
  loadSettings,
  loadStats,
  loadThemeId,
  saveInProgressGame,
  saveSettings,
  saveStats,
  saveThemeId,
} from './storage.js';
import './styles.css';
// Home shows the "play a friend" copy and its error line before `Online` is
// ever mounted, so its stylesheet has to be here too.
import './online.css';

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
      /** Resume-after-reload (spec 10.13): a previous session's moves and clock, matched to Game's `initialMoves`/`resumeClock` props. Absent for an ordinary new game. */
      resume?: { moves: string[]; clockStack: ClockStack };
    }
  | { name: 'review'; record: GameRecord }
  /** Playing a friend by link — docs/ONLINE.md. The room holds the game; this only holds the way in. */
  | { name: 'online'; entry: OnlineEntry }
  | { name: 'tutorial' }
  | { name: 'settings' };

type Mode = 'pass-and-play' | 'vs-computer' | 'online';
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
const MODE_LABEL: Record<Mode, string> = {
  'pass-and-play': 'Pass-and-play',
  'vs-computer': 'vs Computer',
  online: 'Play a friend',
};

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

/**
 * An invite link in the address bar (docs/ONLINE.md), read once at startup.
 *
 * `#m=<match>.<token>` is a seat in a live game; `#m=<match>` alone is the
 * same room with no seat, which is how spectating works. Anything malformed
 * is ignored, exactly as a mangled share link is — a bad link should land on
 * Home with a working game to start, not on an error about base64.
 */
function invitedScreen(): Screen | null {
  if (typeof window === 'undefined') return null;
  const invite = parseInvite(window.location.hash);
  if (!invite) return null;
  return { name: 'online', entry: { matchId: invite.matchId, token: invite.token } };
}

/**
 * Resume-after-reload (spec 10.13), read once at startup: a shared link
 * always wins (it's a link somebody was just given), and a finished game was
 * never left in storage to begin with (`onProgress` below clears it the
 * moment a result lands) — so anything this finds really is a game in
 * progress.
 */
function resumedScreen(): Screen | null {
  const saved = loadInProgressGame();
  if (!saved) return null;
  return {
    name: 'game',
    variant: saved.variant,
    computer: saved.computer,
    round: 0,
    names: saved.names,
    resume: { moves: saved.history, clockStack: saved.clockStack },
  };
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => {
    const shared = sharedRecord();
    if (shared) return { name: 'review', record: shared };
    // An invite beats a game left in progress: somebody is waiting at the
    // other end of it, and the local game is still there afterwards.
    return invitedScreen() ?? resumedScreen() ?? { name: 'home' };
  });
  const [selected, setSelected] = useState<VariantId>('original');
  // Doubles as "the control a resumed game is using" — resuming reopens on
  // the control it was actually played with, and a fresh Home visit still
  // gets a sensible default either way.
  const [controlId, setControlId] = useState(() => loadInProgressGame()?.controlId ?? DEFAULT_CONTROL_ID);
  const [mode, setMode] = useState<Mode>('pass-and-play');
  const [level, setLevel] = useState<Level>('medium');
  const [sideChoice, setSideChoice] = useState<SideChoice>('blue');
  const [blueName, setBlueName] = useState('');
  const [redName, setRedName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  /**
   * Zen (C2) and the sound mute (spec 10.12) both live here rather than in
   * Game, for the same reason: a rematch remounts Game, and a player who
   * asked for quiet — visual or aural — shouldn't have to ask again every
   * game. `loadSettings`/`saveSettings` (spec 10.13) is the M8 half of what
   * used to be session-only.
   */
  const [settings, setSettings] = useState(loadSettings);
  const [stats, setStats] = useState(loadStats);
  /**
   * The colour scheme (spec 10.1's Settings, docs/VISUAL_SYSTEM.md 7) — its
   * own piece of state and its own storage key, not folded into `settings`:
   * a theme is a local, cosmetic choice that never leaves the device, where
   * `DisplaySettings` is what the game shows and stays readable by a server
   * later. Piece family sits beside it in Settings.tsx but isn't stateful at
   * all yet — only Cut stone is built, so there is nothing to pick.
   */
  const [themeId, setThemeId] = useState<ThemeId>(loadThemeId);
  const appearance = useMemo(defaultAppearance, []);
  const control = useMemo(() => presetById(controlId), [controlId]);

  /**
   * A link opened while the app is already running.
   *
   * The startup read is not enough: clicking an invite for a second game in a
   * tab that already has this page open changes only the hash, which no
   * navigation and no reload follows. Without this, the link appeared to do
   * nothing at all — the most confusing possible failure for the one feature
   * whose entire interface is a link.
   *
   * `replaceState` does not fire this, so the creator writing its own match
   * into the address bar, and "← Home" clearing it, both stay quiet.
   */
  useEffect(() => {
    const onHashChange = () => {
      const shared = sharedRecord();
      if (shared) {
        setScreen({ name: 'review', record: shared });
        return;
      }
      const invited = invitedScreen();
      if (invited) setScreen(invited);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function updateSettings(patch: Partial<DisplaySettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }

  function updateTheme(id: ThemeId) {
    setThemeId(id);
    saveThemeId(id);
  }

  /**
   * App.tsx's half of spec 10.13's resume-after-reload and local stats:
   * Game.tsx only ever reports what changed, never touches storage itself.
   * A result clears the in-progress record (nothing left to resume) and,
   * against the computer, records the outcome — aborted games count as
   * neither a win, a loss nor a draw, same as the overlay's own reading of
   * that reason (spec 10.7's stats are scoped to vs-computer: "per variant
   * and difficulty" only means something there, and pass-and-play has no
   * fixed "you" to keep a streak for — see stats.ts's header).
   *
   * `useCallback` here is load-bearing, not tidiness: Game.tsx's own
   * `onProgress` effect lists this callback in its dependency array (it has
   * to — using a prop inside an effect without listing it is a stale
   * closure). An unmemoized function is a new reference on every App render,
   * including the render `setStats` itself causes — so a plain `const`
   * here reran the effect after every result it recorded, which called
   * `setStats` again, which reran the effect again, forever. `[screen,
   * controlId]` is genuinely all this reads; `screen`'s own reference stays
   * the same across a stats-only re-render (nothing here calls `setScreen`),
   * which is what actually breaks the loop.
   */
  const handleProgress = useCallback(
    (info: { history: readonly string[]; clockStack: ClockStack; result: GameResult | null }) => {
      if (screen.name !== 'game') return; // only ever handed to Game while this holds
      if (info.result) {
        clearInProgressGame();
        if (info.result.reason !== 'aborted' && screen.computer) {
          const humanSide = other(screen.computer.side);
          const outcome: 'win' | 'loss' | 'draw' =
            info.result.winner === null ? 'draw' : info.result.winner === humanSide ? 'win' : 'loss';
          setStats((prev) => {
            const next = recordOutcome(prev, screen.variant, screen.computer!.level, outcome);
            saveStats(next);
            return next;
          });
        }
        return;
      }
      saveInProgressGame({
        variant: screen.variant,
        controlId,
        computer: screen.computer,
        names: screen.names,
        history: [...info.history],
        clockStack: [...info.clockStack],
      });
    },
    [screen, controlId],
  );

  const goHome = () => {
    // A shared or invite link that stays in the address bar would reopen the
    // same game on the next reload, which is not what "← Home" was asked for.
    if (typeof window !== 'undefined' && window.location.hash !== '') {
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
        theme={themeId}
        family="cut-stone"
        appearance={appearance}
        aids={settings.aids}
        coordinates={settings.coordinates}
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
        theme={themeId}
        family="cut-stone"
        appearance={appearance}
        names={screen.names}
        onExit={goHome}
        zen={settings.zen}
        onToggleZen={() => updateSettings({ zen: !settings.zen })}
        sound={settings.sound}
        onToggleSound={() => updateSettings({ sound: !settings.sound })}
        aids={settings.aids}
        coordinates={settings.coordinates}
        onProgress={handleProgress}
        stats={screen.computer ? statsFor(stats, screen.variant, screen.computer.level) : null}
        // `exactOptionalPropertyTypes` wants these keys OMITTED for an
        // ordinary new game, not set to `undefined` — spreading a
        // conditional object is what makes that distinction rather than
        // handing Game an explicit `initialMoves: undefined`.
        {...(screen.resume ? { initialMoves: screen.resume.moves, resumeClock: screen.resume.clockStack } : {})}
        onRematch={(swapSides) =>
          setScreen((current) => {
            if (current.name !== 'game') return current;
            // A rematch is a fresh game (the comment on `round` above), so it
            // must not reopen with the PREVIOUS game's moves and clock — only
            // ever set when this screen was itself built from a resumed one.
            // Destructuring `resume` out (rather than setting it undefined)
            // is what actually omits the key under `exactOptionalPropertyTypes`.
            const { resume: _resume, ...rest } = current;
            return {
              ...rest,
              computer:
                swapSides && current.computer
                  ? { ...current.computer, side: other(current.computer.side) }
                  : current.computer,
              round: current.round + 1,
            };
          })
        }
      />
    );
  }

  if (screen.name === 'online') {
    return (
      <Online
        // A different match is a different game, not the same one with new
        // props: remounting is what stops the previous room's moves, clocks
        // and presence surviving into it.
        key={screen.entry.matchId}
        entry={screen.entry}
        theme={themeId}
        family="cut-stone"
        appearance={appearance}
        aids={settings.aids}
        coordinates={settings.coordinates}
        zen={settings.zen}
        onToggleZen={() => updateSettings({ zen: !settings.zen })}
        sound={settings.sound}
        onToggleSound={() => updateSettings({ sound: !settings.sound })}
        onExit={goHome}
      />
    );
  }

  if (screen.name === 'tutorial') {
    return <Tutorial onExit={goHome} />;
  }

  if (screen.name === 'settings') {
    return (
      <Settings
        settings={settings}
        onUpdateSettings={updateSettings}
        themeId={themeId}
        onThemeChange={updateTheme}
        onExit={goHome}
      />
    );
  }

  /**
   * Creating an online match talks to the referee, so unlike every other way
   * to start a game it can fail and it can take a moment. Both are said out
   * loud rather than left to a button that appears to do nothing.
   */
  const startOnline = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createMatch({
        variant: selected,
        control: controlId,
        side: sideChoice,
      });
      // The invite link goes in the address bar too, so a reload during the
      // wait comes back to the same seat rather than to Home.
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', `#m=${created.matchId}.${created.token}`);
      }
      setScreen({
        name: 'online',
        entry: { matchId: created.matchId, token: created.token, created },
      });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'could not create that game');
    } finally {
      setCreating(false);
    }
  };

  const startGame = () => {
    if (mode === 'online') {
      void startOnline();
      return;
    }
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
        {(['pass-and-play', 'vs-computer', 'online'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            className={`mode-option${mode === m ? ' mode-option--on' : ''}`}
            onClick={() => setMode(m)}
          >
            {MODE_LABEL[m]}
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

        </>
      )}

      {/* Spec 10.1's side picker. It can be offered now that the board turns
          around for a Red-playing human (spec 10.2) — before that, choosing
          Red would have shown you your own pieces starting in the far corner.
          Pass-and-play has no side to pick: one device, one orientation.
          Playing a friend does: the side you keep is the side they do not. */}
      {mode !== 'pass-and-play' && (
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

      <button className="play" type="button" onClick={startGame} disabled={creating}>
        {creating
          ? 'Opening a room…'
          : mode === 'online'
            ? `Play a friend — ${VARIANTS[selected].name}`
            : mode === 'vs-computer'
              ? `Play vs Computer (${LEVEL_LABEL[level]}) — ${VARIANTS[selected].name}`
              : `Play pass-and-play — ${VARIANTS[selected].name}`}
      </button>

      {mode === 'online' && !createError && (
        <p className="stats-line">
          You get a link to send. The first person to open it takes the other side.
        </p>
      )}
      {createError && <p className="online-error">{createError}</p>}

      {/* Spec 10.7's stats, scoped to vs-computer (stats.ts's own header says
          why): the record for whichever variant and difficulty is currently
          picked, so it changes as the pickers above do rather than needing
          its own selector. */}
      {mode === 'vs-computer' && (
        <p className="stats-line">
          {(() => {
            const s = statsFor(stats, selected, level);
            return `Your record at ${LEVEL_LABEL[level]}, ${VARIANTS[selected].name}: ${s.wins}W ${s.losses}L ${s.draws}D${s.streak > 1 ? ` · ${s.streak}-win streak` : ''}`;
          })()}
        </p>
      )}

      <button className="tutorial-link" type="button" onClick={() => setScreen({ name: 'tutorial' })}>
        Tutorial — learn the six things that matter
      </button>
      <button className="settings-link" type="button" onClick={() => setScreen({ name: 'settings' })}>
        Settings — aids and colour scheme
      </button>
    </main>
  );
}
