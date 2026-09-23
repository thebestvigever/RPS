// Playing a friend by link — spec 13.2's first online feature, and the screen
// around it.
//
// The board is `Game` with an `online` prop: the same board, the same
// gestures, the same aids. Everything here is the part that has no offline
// equivalent — waiting for somebody to open the link, saying so when the
// connection drops, and the two buttons you get when your opponent stops
// being there.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { VARIANTS } from '@sps/engine';
import type { VariantConfig } from '@sps/engine';
import { UNLIMITED, fischer, presetById } from '@sps/match';
import type { TimeControl } from '@sps/match';
import type { Appearance, FamilyId, SideNames, ThemeId } from '@sps/board';
import type { Aids } from '@sps/match';
import type { CreatedMatch } from '@sps/referee';
import Game from './Game.js';
import type { OnlineControl } from './Game.js';
import {
  claimableAtLocal,
  clockFromServer,
  opponentAway,
  phaseOf,
} from './match-client.js';
import type { MatchState } from './match-client.js';
import { useMatch } from './useMatch.js';
import './online.css';

/**
 * Thirty seconds to play the first move (Vig, 23 Sep 2026). The room is what
 * enforces it — this is only the countdown, and it is deliberately read from
 * the same constant rather than a second 30 written here.
 */
const FIRST_MOVE_MS = 30_000;

export interface OnlineEntry {
  matchId: string;
  token: string | null;
  /** Set when this browser created the match, and so has a link to hand out. */
  created?: CreatedMatch;
}

export interface OnlineProps {
  entry: OnlineEntry;
  theme: ThemeId;
  family: FamilyId;
  appearance: Appearance;
  aids?: Aids;
  coordinates?: boolean;
  zen?: boolean;
  onToggleZen?: () => void;
  sound?: boolean;
  onToggleSound?: () => void;
  onExit: () => void;
}

/** A clock that re-renders once a second, for the countdowns. */
function useSecond(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * Which control this game is on, read off the record the room sent.
 *
 * The record's clock section carries the preset's id (spec 8.3), so a player
 * who arrives by link — and therefore never chose anything — still gets the
 * right clock face, low-time warning and category. An unlimited game has no
 * clock section at all, which is the same thing said by omission.
 */
function controlFrom(state: MatchState): TimeControl {
  const control = state.control;
  // No clock section means an unlimited game — the same thing said by
  // omission, because a record full of Infinity would not survive JSON.
  if (!control) return UNLIMITED;
  try {
    return presetById(control.id);
  } catch {
    // A control this build has never heard of. Rebuilding one from the two
    // numbers the record does carry beats showing no clock at all.
    return fischer(control.initialMs / 60_000, control.incrementMs / 1_000);
  }
}

function readableTime(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${seconds}s`;
}

export default function Online(props: OnlineProps) {
  const { entry, onExit } = props;
  const { state, connected, actions } = useMatch(entry.matchId, entry.token);
  const phase = phaseOf(state);
  const you = state.you === 'blue' || state.you === 'red' ? state.you : null;

  const [copied, setCopied] = useState(false);
  const invite = entry.created?.invite ?? null;

  const copyInvite = useCallback(() => {
    if (!invite) return;
    void navigator.clipboard
      .writeText(invite)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  }, [invite]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(id);
  }, [copied]);

  const variant: VariantConfig = VARIANTS[state.variant ?? 'original'];
  const control = useMemo(() => controlFrom(state), [state.control]);

  const clock = useMemo(
    () => (state.clocks ? clockFromServer(control, state.clocks, state.clocksAt, state.gifts) : null),
    [control, state.clocks, state.clocksAt, state.gifts],
  );

  const names: SideNames = useMemo(
    () => ({
      ...(state.names.blue ? { blue: state.names.blue } : {}),
      ...(state.names.red ? { red: state.names.red } : {}),
    }),
    [state.names.blue, state.names.red],
  );

  const online: OnlineControl | null = useMemo(
    () =>
      you === null || state.mode === null
        ? null
        : {
            you,
            mode: state.mode as OnlineControl['mode'],
            moves: state.moves,
            result: state.result,
            clock,
            offer: state.offer,
            send: {
              move: actions.move,
              resign: actions.resign,
              abort: actions.abort,
              offerDraw: actions.offerDraw,
              acceptDraw: actions.acceptDraw,
              declineDraw: actions.declineDraw,
            },
          },
      [you, state.mode, state.moves, state.result, clock, state.offer, actions],
  );

  const watching = state.you === 'spectator';
  const waitingOnFirstMove = phase === 'playing' && state.moves.length === 0 && !watching;
  const away = you !== null && opponentAway(state, you);
  const now = useSecond(phase === 'playing' && (waitingOnFirstMove || away));

  if (state.fatal) {
    return (
      <main className="online-screen">
        <h1>That link did not open a game</h1>
        <p className="sub">{state.fatal}</p>
        <button className="play" type="button" onClick={onExit}>
          ← Home
        </button>
      </main>
    );
  }

  if (phase === 'connecting') {
    return (
      <main className="online-screen">
        <h1>Connecting…</h1>
        <p className="sub">Finding the room for this game.</p>
        <button className="tutorial-link" type="button" onClick={onExit}>
          ← Home
        </button>
      </main>
    );
  }

  if (phase === 'waiting') {
    return (
      <main className="online-screen">
        <h1>Waiting for your opponent</h1>
        {invite ? (
          <>
            <p className="sub">
              Send this link. <strong>The first person to open it joins the game</strong> — they
              take {you === 'blue' ? 'Red' : 'Blue'}, and play starts the moment they arrive.
            </p>
            <div className="invite">
              <input
                className="invite-link"
                type="text"
                readOnly
                value={invite}
                onFocus={(event) => event.currentTarget.select()}
                aria-label="Invite link"
              />
              <button type="button" className="play" onClick={copyInvite}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <p className="sub online-note">
              Anyone you send it to can take the seat, so send it to one person. You are{' '}
              {you === 'blue' ? 'Blue' : 'Red'}, on {variant.name}.
            </p>
          </>
        ) : (
          <p className="sub">
            This game is waiting for its other player. It will start on its own when they arrive.
          </p>
        )}
        {!connected && <p className="online-banner online-banner--warn">Reconnecting…</p>}
        <button className="tutorial-link" type="button" onClick={onExit}>
          ← Home
        </button>
      </main>
    );
  }

  const claimAt = you === null ? null : claimableAtLocal(state, you);
  const canClaim = claimAt !== null && now >= claimAt;
  const firstMoveLeft =
    state.startedAt === null ? 0 : state.startedAt - state.skewMs + FIRST_MOVE_MS - now;

  return (
    <>
      <div className="online-banners" role="status" aria-live="polite">
        {!connected && (
          <p className="online-banner online-banner--warn">
            Reconnecting… your clock is still running.
          </p>
        )}
        {state.notice && <p className="online-banner">{state.notice}</p>}
        {waitingOnFirstMove && !state.result && (
          <p className="online-banner">
            {you !== null && state.clocks?.running === you
              ? `Your move — ${readableTime(firstMoveLeft)} to start, or the game is called off.`
              : `Waiting for the first move — ${readableTime(firstMoveLeft)}.`}
          </p>
        )}
        {away && !state.result && (
          <div className="online-banner online-banner--warn">
            <span>
              Your opponent has gone.{' '}
              {canClaim ? 'You can end the game.' : claimAt === null ? '' : `Claimable in ${readableTime(claimAt - now)}.`}
            </span>
            {canClaim && (
              <span className="online-claims">
                <button type="button" onClick={actions.claimWin}>
                  Claim victory
                </button>
                <button type="button" onClick={actions.claimDraw}>
                  Call it a draw
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Watching, rather than playing: the same board with nothing to press.
          It is remounted as each move arrives rather than animated in, which
          is a real difference from playing and an honest first cut — a
          spectator sees the position, in time, and nothing pretends a move
          slid across the board when it did not. */}
      {!online && state.you === 'spectator' && (
        <Game
          key={state.moves.length}
          variant={variant}
          control={control}
          computer={null}
          theme={props.theme}
          family={props.family}
          appearance={props.appearance}
          names={names}
          initialMoves={state.moves}
          initialResult={state.result}
          reviewOnly
          onExit={onExit}
          onRematch={onExit}
          {...(props.aids ? { aids: props.aids } : {})}
          {...(props.coordinates === undefined ? {} : { coordinates: props.coordinates })}
        />
      )}

      {online && (
        <Game
          variant={variant}
          control={control}
          computer={null}
          theme={props.theme}
          family={props.family}
          appearance={props.appearance}
          names={names}
          online={online}
          onExit={onExit}
          onRematch={onExit}
          {...(props.aids ? { aids: props.aids } : {})}
          {...(props.coordinates === undefined ? {} : { coordinates: props.coordinates })}
          {...(props.zen === undefined ? {} : { zen: props.zen })}
          {...(props.onToggleZen ? { onToggleZen: props.onToggleZen } : {})}
          {...(props.sound === undefined ? {} : { sound: props.sound })}
          {...(props.onToggleSound ? { onToggleSound: props.onToggleSound } : {})}
        />
      )}
    </>
  );
}

/** Exported for the test that pins the countdown's wording. */
export { readableTime };
