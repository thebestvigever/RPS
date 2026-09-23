// Pass-and-play and vs-computer — spec 10.1 "Game" screen (docs/VISUAL_SYSTEM.md
// 8, M3b/M3c/M4).
//
// This is where the state machine spec 10.4 describes lives: tap to select,
// tap a destination to move, tap the piece again or empty space to cancel,
// drag and drop with the same targets, and the same keyboard cursor. Click
// and drag share one core (`resolveDestination`) so they can't disagree about
// what a given gesture means; keyboard's Enter/Space reuses the exact same
// `resolveClick` a tap uses, which is what makes "keyboard plays a complete
// game" (spec 11.6) fall out for free rather than needing its own logic.
//
// @sps/board stays pure — it draws whatever `selection`/`focusSquare` say to.
// Everything about WHEN those change, and the two animations layered on top
// (the 150ms slide, the capture motion), is DOM work that has no business in
// a package with no DOM, so it lives here. The computer opponent (M4) reuses
// every bit of this: its move arrives from the worker as text, gets parsed
// into the same Move type a tap produces, and goes through the same `doMove`.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PIECE_TYPES,
  SHARE_PREFIX,
  abortGame,
  agreeDraw,
  applyMove,
  beats,
  capturesFrom,
  dangerAfter,
  decodePiece,
  distance,
  EMPTY,
  encodeRecord,
  flag as engineFlag,
  isPermanent,
  isSealed,
  legalMoves,
  moveToText,
  nearestRunner,
  other,
  parseMove,
  permanentMask,
  replay,
  resign as engineResign,
  summarise,
  threatenedBy,
  toFen,
  typeCounts,
} from '@sps/engine';
import type { GameRecord, GameResult, GameState, Move, PieceType, Side, Square, VariantConfig } from '@sps/engine';
import {
  MOTION_MS,
  PIECE_MOTION_CLASS,
  THEMES,
  captureMotion,
  illegalCaptureReason,
  keepLockText,
  neutralSelectionText,
  displayCell,
  permanentPieceText,
  pieceTypeName,
  raceMeterText,
  renderBoard,
  renderPieceSample,
  sideName,
} from '@sps/board';
import type { Appearance, FamilyId, MotionKind, Orientation, SideNames, ThemeId, ThreatOverlay } from '@sps/board';
import {
  DEFAULT_SETTINGS,
  GIFT_POLICIES,
  OFFER_POLICIES,
  canAbort,
  canGive,
  canOffer,
  clockRecord,
  controlsSide,
  createClock,
  createOffers,
  flaggedAt,
  giveTime,
  offer as makeOffer,
  accept as acceptOffer,
  decline as declineOffer,
  onMove as offersOnMove,
  press as pressClock,
  remainingAt,
  rewind,
  startTurn,
  stop as stopClock,
  urgencyOf,
  visibleAids,
} from '@sps/match';
import type { Aids, ClockStack, ClockState, MatchMode, OfferState, TimeControl, Urgency } from '@sps/match';
import { shouldAcceptDraw } from '@sps/ai';
import type { FromWorker, Level, ToWorker } from '@sps/ai';
import { clampSquare, slideOffsetPx, squareAt } from './board-geometry.js';
import { describeResult, describeTurn, fullMoveOf, whoseTurn } from './announce.js';
import { formatClock } from './clock-format.js';
import { describeSquare } from './describe-square.js';
import { createAiWorker } from './ai-worker.js';
import { playCapture, playChime, playTick } from './sound.js';
import type { VariantStats } from './stats.js';
import MoveList from './MoveList.js';
import GameOver from './GameOver.js';
import './game.css';

export interface Computer {
  side: Side;
  level: Level;
}

/**
 * Playing somebody else, through the room (docs/ONLINE.md).
 *
 * The room is the authority, and this component is not — but it still owns
 * the board, because the alternative is a second board that behaves almost
 * like this one. So a move is played HERE first, drawn and announced and
 * sounded exactly as an offline move is, and sent at the same instant; the
 * room's answer arrives a moment later and `moves` is what the position is
 * rebuilt from. The two agree essentially always, because the check the room
 * runs is the same `legalMoves` this component already ran. When they do not
 * — a move that arrived after the flag, a takeback, a rejected ply — the
 * room's list wins and the board is put back without asking.
 *
 * That is optimistic, and it is the reason an online move feels the same as
 * an offline one on a connection with any latency at all.
 */
export interface OnlineControl {
  /** Which side this browser plays. */
  you: Side;
  mode: MatchMode;
  /** The room's move list. The only version of the game that counts. */
  moves: readonly string[];
  /** The room's result — a resignation leaves no trace in the moves. */
  result: GameResult | null;
  /** The room's clocks, already read as a `ClockState` (match-client.ts). */
  clock: ClockState | null;
  /** A pending offer as the room sees it, which survives a reconnect. */
  offer: { kind: 'draw' | 'takeback'; by: Side } | null;
  send: {
    move: (ply: number, move: string) => void;
    resign: () => void;
    abort: () => void;
    offerDraw: () => void;
    acceptDraw: () => void;
    declineDraw: () => void;
  };
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export interface GameProps {
  variant: VariantConfig;
  control: TimeControl;
  /** null for pass-and-play. Set, this side is the computer's. */
  computer: Computer | null;
  theme: ThemeId;
  family: FamilyId;
  appearance: Appearance;
  onExit: () => void;
  /**
   * Rematch and Swap sides (spec 10.7). Handled by the caller rather than in
   * here, because swapping changes which side the computer is — a prop — and
   * because remounting is a more honest reset than clearing a dozen pieces of
   * state by hand: that list silently rots every time new state is added, and
   * a rematch that quietly kept the old clock stack would be exactly that bug.
   */
  onRematch: (swapSides: boolean) => void;
  /** A game to open already played out — a shared link (spec 8.4), read-only. */
  initialMoves?: readonly string[];
  /**
   * How that game ended. It cannot be replayed from the moves — a resignation
   * leaves no trace in them — so without it a shared game that somebody
   * resigned would open looking like an ongoing position waiting for a move.
   */
  initialResult?: GameResult | null;
  /** Spec 10.1's Review screen: a finished or shared game, nothing playable. */
  reviewOnly?: boolean;
  /**
   * The quiet board (C2). Held by the caller so it survives a rematch, which
   * remounts this component — a player who asked for quiet should not have to
   * ask again every game.
   */
  zen?: boolean;
  onToggleZen?: () => void;
  /** The mute toggle spec 10.12 asks to be remembered — App.tsx owns the persistence, same split as Zen. */
  sound?: boolean;
  onToggleSound?: () => void;
  /**
   * The player's own aid choices (spec 10.5, 10.13) — Settings' per-aid
   * toggles, before Zen or a Hard computer quiet any of them further.
   * Defaults to every aid on, matching `DEFAULT_SETTINGS.aids`, so a caller
   * that hasn't wired Settings yet (a shared review link, say) still shows
   * the full aid layer rather than none of it.
   */
  aids?: Aids;
  /** Spec 10.2/10.13's coordinate labels. Default true, matching `renderBoard`'s own default. */
  coordinates?: boolean;
  /**
   * Pass-and-play's optional player names (Home's name fields), keyed by
   * side. Blank or missing falls back to the colour name — this is wording
   * only; `humanSide`/`viewerSide` and the rules still mean Blue and Red.
   */
  names?: SideNames;
  /**
   * Resume-after-reload's clock (spec 10.13): the clock stack a previous
   * session left off with, matched to `initialMoves`. `undefined` for an
   * ordinary new game, which is what makes this additive rather than a
   * second code path — `initialClock` below falls back to today's "start
   * fresh" behaviour whenever it's absent.
   */
  resumeClock?: ClockStack;
  /**
   * Fires whenever the live position changes, and once more when the game
   * ends — everything App.tsx needs to persist the in-progress game (or
   * clear it once there's a result) without owning any of this component's
   * state itself.
   */
  onProgress?: (info: { history: readonly string[]; clockStack: ClockStack; result: GameResult | null }) => void;
  /** Spec 10.7's stats for this variant and difficulty, passed straight through to `GameOver` — App.tsx owns computing and persisting them. */
  stats?: VariantStats | null;
  /** Set when this game is being refereed elsewhere — see `OnlineControl`. */
  online?: OnlineControl;
}

/** Spec 10.2's ceiling, and a floor so the board never collapses to nothing. */
const MAX_BOARD_PX = 640;
const MIN_BOARD_PX = 240;
/** The page's own left+right gutters, spec 10.2's "viewport minus 32". */
const BOARD_GUTTERS_PX = 32;
/** Matches `.game--rail .game-side` (20rem) and `.game--rail`'s gap (1.5rem). */
const RAIL_WIDTH_PX = 320;
const RAIL_GAP_PX = 24;

/**
 * Spec 10.2: the board is the smaller of the viewport minus 32, **the space
 * left after the panels**, and 640.
 *
 * `railed` is that middle term — the only thing that ever takes width away
 * from the board here. It is passed in rather than read from a media query so
 * that one constant (`RAIL_MIN_PX`) decides both the layout and the size, and
 * so Zen — which collapses the rail — gets the wider board for free.
 *
 * A `ResizeObserver` rather than `window.resize` alone. The resize event can
 * lag or be missed when the viewport changes without a user gesture (a device
 * rotating, a desktop pane being dragged, a devtools viewport being set), and
 * a missed one leaves the board sized for the OLD viewport — which is how a
 * 475px board ended up inside a 425px phone, clipping the a-file off the edge.
 * The observer reports the real box every time.
 */
function useBoardPx(railed: boolean): number {
  const measure = useCallback(() => {
    if (typeof window === 'undefined') return 360;
    const available = window.innerWidth - BOARD_GUTTERS_PX - (railed ? RAIL_WIDTH_PX + RAIL_GAP_PX : 0);
    return Math.max(MIN_BOARD_PX, Math.min(available, MAX_BOARD_PX));
  }, [railed]);

  const [px, setPx] = useState(measure);

  useEffect(() => {
    const update = () => setPx(measure());
    update(); // `railed` may have just changed under us
    const observer = new ResizeObserver(update);
    observer.observe(document.documentElement);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [measure]);

  return px;
}

/**
 * Spec 10.11: "Desktop: board on the left; panels and move list on the right."
 *
 * The breakpoint is defined here, once, and applied as a class rather than as
 * a CSS media query, so the stylesheet and this file cannot drift apart about
 * where the layout changes.
 *
 * 1024 is not arbitrary. Spec 10.2 sizes the board as the smaller of the
 * viewport minus 32, the space left after the panels, and 640 — so the rail
 * must not squeeze the board. A 640 board, a 20rem rail and the gap between
 * them come to just under 1024 with the page's own padding, which is the
 * narrowest width where the board still gets its full size. Below it the
 * column stacks instead, which is what a phone gets (spec 10.11's own
 * portrait order: opponent, board, you, controls).
 */
const RAIL_MIN_PX = 1024;

function useRail(): boolean {
  const query = `(min-width: ${RAIL_MIN_PX}px)`;
  const [railed, setRailed] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setRailed(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return railed;
}

/**
 * Spec 10.11: on a phone the move list "lives in a drawer"; a desktop has room
 * to leave it open. Read once, at mount — this decides an initial `<details
 * open>` and nothing else, so re-deciding it on every resize would fight a
 * player who had just closed it.
 */
function useWideEnoughForList(): boolean {
  const [wide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 700);
  return wide;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

interface PendingAnim {
  move: Move;
  motion: MotionKind | null;
}

/**
 * Captor keyframes: the 150ms slide every move gets (spec 10.4), with the
 * matchup's own shape layered on for a capture (docs/VISUAL_SYSTEM.md 6).
 *
 * Every segment carries its own `easing`. WAAPI applies a keyframe's easing to
 * the interval that STARTS at it, so a four-keyframe capture gets four curves
 * rather than one stretched across the whole thing — which is what flattened
 * the overshoot the design asks for: a single `ease-out` spends its
 * deceleration on the travel and leaves the bounce linear.
 *
 * These animate the inner, untransformed group, so `translate(0, 0)` really is
 * "where this piece belongs" and the scales pivot about the mark itself.
 */
const TRAVEL = 'cubic-bezier(.22,.61,.36,1)'; // decelerate into the square
const SETTLE = 'cubic-bezier(.33,0,.67,1)'; // symmetric, for a bounce coming to rest

function captorKeyframes(motion: MotionKind | null, dx: number, dy: number): Keyframe[] {
  const arrive = `translate(${dx}px, ${dy}px)`;
  if (!motion) {
    return [
      { transform: arrive, easing: TRAVEL },
      { transform: 'translate(0px, 0px)' },
    ];
  }
  if (motion === 'crush') {
    // Drops in and overshoots — the weight of a rock landing.
    return [
      { transform: `${arrive} scale(1)`, offset: 0, easing: 'cubic-bezier(.4,0,.6,1)' },
      { transform: 'translate(0px, 0px) scale(1.16)', offset: 0.55, easing: SETTLE },
      { transform: 'translate(0px, 0px) scale(0.94)', offset: 0.8, easing: SETTLE },
      { transform: 'translate(0px, 0px) scale(1)', offset: 1 },
    ];
  }
  if (motion === 'cut') {
    // Closes past centre and back — the snip.
    return [
      { transform: `${arrive} rotate(0deg)`, offset: 0, easing: TRAVEL },
      { transform: 'translate(0px, 0px) rotate(-8deg)', offset: 0.4, easing: SETTLE },
      { transform: 'translate(0px, 0px) rotate(6deg)', offset: 0.75, easing: SETTLE },
      { transform: 'translate(0px, 0px) rotate(0deg)', offset: 1 },
    ];
  }
  // wrap: swells over the victim, holds, then settles
  return [
    { transform: `${arrive} scale(1)`, offset: 0, easing: TRAVEL },
    { transform: 'translate(0px, 0px) scale(1.45)', offset: 0.5, easing: 'linear' },
    { transform: 'translate(0px, 0px) scale(1.45)', offset: 0.7, easing: SETTLE },
    { transform: 'translate(0px, 0px) scale(1)', offset: 1 },
  ];
}

/** The victim's own animation, per matchup (README 3b). Cut is a fade/scale
 * approximation rather than the two-halves split — a real simplification,
 * not an oversight: splitting one silhouette into two convincing halves
 * needs its own geometry per family, which is more than this pass owns. */
function victimKeyframes(motion: MotionKind): Keyframe[] {
  if (motion === 'crush') {
    return [
      { transform: 'scaleY(1)', opacity: 1, transformOrigin: 'bottom center' },
      { transform: 'scaleY(0.18)', opacity: 0, transformOrigin: 'bottom center' },
    ];
  }
  if (motion === 'cut') {
    return [
      { transform: 'scale(1) rotate(0deg)', opacity: 1 },
      { transform: 'scale(0.7) rotate(20deg)', opacity: 0 },
    ];
  }
  return [{ opacity: 1 }, { opacity: 0 }]; // wrap: fades under the captor
}

export default function Game({
  variant,
  control,
  computer,
  theme,
  family,
  appearance,
  onExit,
  onRematch,
  initialMoves,
  initialResult = null,
  reviewOnly = false,
  names = {},
  zen = false,
  onToggleZen,
  sound = true,
  onToggleSound,
  aids: aidSettings = DEFAULT_SETTINGS.aids,
  coordinates = true,
  resumeClock,
  onProgress,
  stats = null,
  online,
}: GameProps) {
  const railed = useRail();
  // Zen collapses the rail, so the board gets that width back (see `.game--zen`).
  const showRail = railed && !zen;
  const boardPx = useBoardPx(showRail);
  const squarePx = boardPx / 9;
  const reducedMotion = usePrefersReducedMotion();
  const wideEnoughForList = useWideEnoughForList();
  const containerRef = useRef<HTMLDivElement>(null);
  const dragOriginRef = useRef<Square | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const mode: MatchMode = online ? online.mode : computer ? 'vs-computer' : 'pass-and-play';
  // Online, `controlsSide` reduces to "your own side", which is what stops
  // this browser moving the opponent's pieces even before the room refuses.
  const humanSide: Side = online ? online.you : computer ? other(computer.side) : 'blue';

  // Spec 10.2: "your own corner sits bottom-left. Playing Red against the
  // computer rotates the board 180°." Pass-and-play keeps one orientation
  // (its optional flip-each-turn setting is Settings work, and off by
  // default), which `humanSide` already gives as Blue — so this is one
  // expression rather than a branch on mode.
  const orientation: Orientation = humanSide;

  // The ownership cue follows the same person the orientation does. These are
  // two inputs to the renderer on purpose (see `Appearance.viewerSide`), but
  // this app sets them together: whoever is looking gets their own corner
  // bottom-left AND their own pieces as filled discs.
  const view = useMemo<Appearance>(() => ({ ...appearance, viewerSide: humanSide }), [appearance, humanSide]);

  // A game that arrives already played — a shared link (spec 8.4). Both of
  // these are first-render values only; `useMemo` is here so the state below
  // starts from ONE object rather than two that were built a millisecond
  // apart. A rematch or a new link arrives as a remount, not as a prop change.
  const opening = useMemo(() => replay(variant, [...(initialMoves ?? [])]), [variant, initialMoves]);
  // A review's clock is never started. It has nothing to measure — the game
  // is already played — and a running one would tick a finished game down to
  // a flag, inventing a result nobody played for.
  //
  // `resumeClock` (spec 10.13) is resume-after-reload's clock stack, matched
  // to `initialMoves` by the caller. `rewind` to its last entry is the same
  // primitive Undo already uses to fetch a historical snapshot; `startTurn`
  // re-anchors it to now, exactly as a fresh game's clock is anchored below —
  // resuming is "start a turn from a snapshot that isn't move zero," not a
  // second way of building a clock.
  const initialClock = useMemo(() => {
    if (reviewOnly) return createClock(control);
    if (resumeClock && resumeClock.length > 0) {
      return startTurn(rewind(resumeClock, resumeClock.length - 1), opening.state.turn, Date.now());
    }
    return startTurn(createClock(control), 'blue', Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [control, reviewOnly, resumeClock, opening.state.turn]);

  const [history, setHistory] = useState<string[]>(() => [...(initialMoves ?? [])]);
  const [gameState, setGameState] = useState<GameState>(opening.state);
  const [selected, setSelected] = useState<Square | null>(null);
  const [focus, setFocus] = useState<Square>(0);
  /**
   * The square a mouse is currently over (spec 10.4/10.5's "selected or
   * hovered") — mouse only, set from `onPointerMove`/`onPointerLeave` below.
   * A touch tap fires the same pointer events with no corresponding "leave"
   * until the next tap lands somewhere else, which would leave a phantom
   * highlight and phantom threat arrows stuck on the last thing a finger
   * touched — `pointerType` is what tells the two apart.
   */
  const [hoverSquare, setHoverSquare] = useState<Square | null>(null);
  const [status, setStatus] = useState<string>(() =>
    initialResult ? describeResult(initialResult, names) : whoseTurn(opening.state.turn, names),
  );
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [anim, setAnim] = useState<PendingAnim | null>(null);
  const [clock, setClock] = useState<ClockState>(initialClock);
  const [offers, setOffers] = useState<OfferState>(() => createOffers(OFFER_POLICIES[mode]));
  const [now, setNow] = useState(() => Date.now());
  const [thinking, setThinking] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);

  /**
   * The clock as it stood at each ply: `clockStack[n]` is the clock with n
   * moves played, so it is always one longer than `history`.
   *
   * This is what makes Undo refund time (spec 10.8) instead of resuming
   * wherever the clock happened to be — and it is the same per-move
   * `remainingMs` spec 8.3's record carries, which is why Copy link can tell
   * the truth about a timed game rather than shipping a link that quietly
   * drops the clock.
   */
  const [clockStack, setClockStack] = useState<ClockState[]>(() =>
    resumeClock && resumeClock.length > 0 ? [...resumeClock] : [initialClock],
  );

  /**
   * How many plies the board is showing — null for the live position.
   *
   * One piece of state covers both of spec 10.8's readers: tapping a move in
   * the list, and Review's own stepper. A shared link is just a game that
   * opens with this already set.
   */
  const [viewPly, setViewPly] = useState<number | null>(reviewOnly ? 0 : null);
  const reviewing = viewPly !== null;

  /**
   * Whether the keyboard cursor is being shown at all.
   *
   * `focus` starts at square 0 — a9, the top-left corner — and the ring used
   * to be drawn unconditionally, so every game opened with a dashed circle
   * parked in an empty corner that nothing had put there and nothing was
   * using. It reads as a rendering artefact, which is exactly what it was.
   *
   * `:focus-visible` is the right test rather than plain focus: tabbing to
   * the board is someone about to use the arrow keys, clicking it is not.
   */
  const [keyboardCursor, setKeyboardCursor] = useState(false);
  const [cellText, setCellText] = useState('');

  const legal = useMemo(() => legalMoves(gameState), [gameState]);
  const counts = useMemo(() => typeCounts(gameState), [gameState]);
  const gameOver = gameState.result != null;
  /**
   * Whether the person at this device may move the side to move.
   *
   * NOT `turn === humanSide`: pass-and-play is one person playing both sides,
   * and `humanSide` is Blue there by construction — so that comparison went
   * false the moment Blue moved and left no Red piece selectable, with the
   * clock still ticking over for Red. The mode decides this, so the mode
   * package owns it (`controlsSide`) and a test pins it.
   */
  const humanTurn = controlsSide(mode, gameState.turn, humanSide);

  /**
   * What the BOARD shows, which is the live game until somebody steps back
   * through it. Replaying rather than keeping a stack of positions is the
   * cheap, correct option: the move list is the source of truth (CLAUDE.md),
   * and a 140-ply replay is well under a frame.
   */
  const viewState = useMemo(
    () => (viewPly === null ? gameState : replay(variant, history.slice(0, viewPly)).state),
    [viewPly, gameState, variant, history],
  );
  const fen = useMemo(() => toFen(viewState), [viewState]);

  /**
   * Spec 10.10: "The board is exposed as a grid of labelled cells (e5, Blue
   * Scissors)." The SVG board is one `role="img"` (docs/VISUAL_SYSTEM.md,
   * M3a), not a grid of focusable cells, so that labelling comes from this
   * visually-hidden live region instead — read off wherever the keyboard
   * cursor actually is (or, while reviewing, the read-only position being
   * looked at), updated only while the cursor is showing, since a mouse
   * user already sees the board and doesn't need a square narrated on
   * every move.
   */
  useEffect(() => {
    if (!keyboardCursor) return;
    setCellText(describeSquare(viewState, focus));
  }, [keyboardCursor, focus, viewState]);

  /** While reviewing, the highlight belongs to the move being looked at. */
  const shownLastMove = useMemo(() => {
    if (viewPly === null) return lastMove;
    if (viewPly === 0) return null;
    const { events } = replay(variant, history.slice(0, viewPly));
    const moveEvent = events
      .at(-1)
      ?.find((event): event is Extract<typeof event, { type: 'move' }> => event.type === 'move');
    return moveEvent ? { from: moveEvent.from, to: moveEvent.to } : null;
  }, [viewPly, lastMove, variant, history]);

  /** Reviewing is read-only (spec 10.8), so nothing on the board is pickable. */
  const isSelectable = useCallback(
    (square: Square) => humanTurn && !reviewing && legal.some((m) => m.from === square),
    [legal, humanTurn, reviewing],
  );

  const selection = useMemo(() => {
    if (selected == null) return null;
    return {
      square: selected,
      destinations: legal
        .filter((m) => m.from === selected)
        .map((m) => ({ square: m.to, capture: m.captured != null })),
    };
  }, [selected, legal]);

  /**
   * Spec 10.4's "subtle pulse": every neutral piece with a capture on offer
   * right now. `legal` is already `legalMoves` for whoever's turn it is, so
   * this needs no separate "is it their turn" check — a neutral's capture
   * only ever appears here when the side to move could actually play it.
   * Reviewing shows a finished position, not a turn to take, so it pulses
   * nothing, the same reasoning `focusSquare` below already uses.
   */
  const pulseSquares = useMemo(() => {
    if (reviewing) return [];
    const squares = new Set<Square>();
    for (const move of legal) {
      if (move.captured != null && decodePiece(gameState.board[move.from]!)?.owner === 'neutral') {
        squares.add(move.from);
      }
    }
    return [...squares];
  }, [legal, reviewing, gameState.board]);

  /**
   * Spec 10.5's aid layer (M6). `visibleAids` is the same function Zen
   * already runs through — a Hard computer is the other override on top of
   * it (spec 14.5, Vig's call: no aids at Hard beyond the counts, same
   * reasoning as Zen's own "counts report, everything else advises").
   * `aidSettings` is the player's own choice from Settings (`aids` prop
   * above); Zen and Hard are the two things that can quiet it further,
   * neither of which ever turns an aid back ON that the player chose off.
   */
  const aids = useMemo(
    () => visibleAids({ ...DEFAULT_SETTINGS, zen, aids: aidSettings }, computer?.level === 'hard'),
    [zen, aidSettings, computer],
  );

  /** Shields (spec 2.10, 10.5): every square holding a piece nothing left on the board can capture. */
  const shieldSquares = useMemo(() => {
    if (reviewing || !aids.permanentPieces) return [];
    const mask = permanentMask(gameState);
    const squares: Square[] = [];
    for (let square = 0; square < mask.length; square++) if (mask[square]) squares.push(square);
    return squares;
  }, [gameState, reviewing, aids.permanentPieces]);

  /** Which sides' own corner is sealed right now (spec 7.6, 10.5) — feeds both the lock badge and the panel line below. */
  const sealedSides = useMemo(() => {
    if (reviewing || !aids.keepLock) return [];
    return (['blue', 'red'] as const).filter((side) => isSealed(gameState, side));
  }, [gameState, reviewing, aids.keepLock]);

  /**
   * Danger marks (spec 10.5): among the selected piece's own legal
   * destinations, which ones leave it next to its predator. `dangerAfter`
   * plays each candidate move on a scratch board — it never touches
   * `gameState` — so this stays a read of "what if", not a second source of
   * truth about where the piece actually is.
   */
  const dangerSquares = useMemo(() => {
    if (selected == null || !aids.dangerMarks) return [];
    return legal.filter((m) => m.from === selected && dangerAfter(gameState, m)).map((m) => m.to);
  }, [selected, legal, gameState, aids.dangerMarks]);

  /**
   * Threat lines (spec 10.5), for whichever square is "selected or hovered"
   * — hover wins while it's active (it's the more immediate signal: moving
   * the mouse off a piece and onto another should switch what the arrows
   * describe), falling back to the selected piece once the mouse leaves the
   * board. `capturesFrom`/`threatenedBy` are both the engine's own
   * structural reads rather than a `legal`-list filter, which is what makes
   * hovering the OPPONENT's own piece (or an unselected one at all) show
   * anything — `legal` only ever has moves for the side to move.
   */
  const threatSquare = hoverSquare ?? selected;
  const threats = useMemo<ThreatOverlay | null>(() => {
    if (threatSquare == null || !aids.threatLines || reviewing) return null;
    if (gameState.board[threatSquare] === EMPTY) return null;
    return {
      square: threatSquare,
      capturing: capturesFrom(gameState, threatSquare),
      threatenedBy: threatenedBy(gameState, threatSquare),
    };
  }, [threatSquare, gameState, aids.threatLines, reviewing]);

  const svg = useMemo(
    () =>
      renderBoard({
        fen,
        variant,
        boardPx,
        theme,
        family,
        appearance: view,
        orientation,
        coordinates,
        lastMove: shownLastMove,
        // Reviewing shows a finished position to look at, not one to point
        // at — same reasoning `focusSquare` below already uses.
        hoverSquare: reviewing ? null : hoverSquare,
        selection,
        pulseSquares,
        shieldSquares,
        sealedSides,
        dangerSquares,
        threats,
        // No cursor over a position that cannot be played — its dashed ring
        // would promise an input that does nothing — and none until the
        // keyboard is actually driving.
        focusSquare: reviewing || !keyboardCursor ? null : focus,
      }),
    [
      fen,
      variant,
      boardPx,
      theme,
      family,
      view,
      orientation,
      coordinates,
      shownLastMove,
      hoverSquare,
      selection,
      pulseSquares,
      shieldSquares,
      sealedSides,
      dangerSquares,
      threats,
      focus,
      reviewing,
      keyboardCursor,
    ],
  );

  const doMove = useCallback(
    /**
     * `fromRoom` is set when this move is one the room has told us about —
     * the opponent's. Everything else about it is identical, which is the
     * point: the animation, the sound, the announcement and the clock press
     * are one code path whether the move came from a tap, the computer's
     * worker or a socket. The only difference is that a move from the room
     * must not be sent back to it.
     */
    (move: Move, fromRoom = false) => {
      const applied = applyMove(gameState, move);
      const text = moveToText(gameState, move);
      const at = Date.now();
      // Pressed once, here, and then both stored and stacked — rather than
      // computed inside each setter, which would press the clock twice and
      // bank two different times for the one move.
      const pressed = pressClock(clock, at);
      const next = applied.state.result ? stopClock(pressed, at) : pressed;

      setHistory((h) => [...h, text]);
      setGameState(applied.state);
      setLastMove({ from: move.from, to: move.to });
      setSelected(null);
      setFocus(move.to);
      setStatus(describeTurn(applied.events, names));
      setAnim({ move, motion: move.captured ? captureMotion(move.piece.type) : null });
      // Moving answers a pending draw offer by playing on — declined (offers.ts's
      // own rule; a rematch offer is exempt, but nothing pends one mid-game).
      setOffers((o) => offersOnMove(o));
      setClock(next);
      setClockStack((stack) => [...stack, next]);
      // Spec 10.12: a tick on a move, a thud on a capture — for the human's
      // tap AND the computer's reply, since both arrive through this one
      // function (see the file header). The win chime is separate: it fires
      // off `gameState.result` below, so every way a game can end plays it
      // once, not just the ones that happen to go through doMove.
      if (sound) (move.captured ? playCapture : playTick)();
      // The room hears about it at the same instant the board shows it.
      // `gameState.ply` is the ply this move IS; the room rejects a stale or
      // duplicate one rather than playing it twice (docs/ONLINE.md).
      if (online && !fromRoom) online.send.move(gameState.ply, text);
    },
    [gameState, clock, names, sound, online],
  );

  /**
   * The room's move list, applied here.
   *
   * Three cases, and they are deliberately not the same:
   *
   *   * Nothing new — the usual answer, including the echo of a move this
   *     browser just played and drew for itself.
   *   * Exactly one move on the end — the opponent's. It goes through
   *     `doMove` like any other, so it slides, captures, announces and
   *     sounds exactly as an offline move does.
   *   * Anything else — a rejected ply, a takeback, or a reconnect that
   *     missed several. The room's list wins and the board is rebuilt from
   *     it without animation, because there is no single move to animate and
   *     pretending otherwise would draw a move that never happened.
   */
  useEffect(() => {
    if (!online) return;
    const server = online.moves;
    const unchanged =
      server.length === history.length && server.every((move, ply) => move === history[ply]);
    if (unchanged) return;

    const appended =
      server.length === history.length + 1 && history.every((move, ply) => move === server[ply]);
    if (appended && !gameState.result) {
      try {
        doMove(parseMove(gameState, server[server.length - 1]!), true);
        return;
      } catch {
        // Not playable from here, so this client's idea of the position is
        // the one that is wrong. Fall through and take the room's.
      }
    }

    const replayed = replay(variant, [...server]);
    setHistory([...server]);
    setGameState(replayed.state);
    setSelected(null);
    setAnim(null);
    setClockStack((stack) => stack.slice(0, server.length + 1));
    const events = replayed.events.at(-1);
    const moveEvent = events?.find((e): e is Extract<typeof e, { type: 'move' }> => e.type === 'move');
    setLastMove(moveEvent ? { from: moveEvent.from, to: moveEvent.to } : null);
    setStatus(whoseTurn(replayed.state.turn, names));
  }, [online, history, gameState, doMove, variant, names]);

  /**
   * The room owns the clock (spec 13.2), so this one is told rather than run.
   * `online.clock` is the room's own reading in the shape the clock display
   * already takes, which is why nothing about how a clock is drawn, warned
   * about or read aloud needed a second version for online play.
   */
  useEffect(() => {
    if (!online?.clock) return;
    setClock(online.clock);
  }, [online?.clock]);

  /**
   * The room's result, which the moves cannot imply: a resignation, a flag, a
   * draw agreed, an abort, or an opponent who stopped being there. It is set
   * straight onto the state rather than through the engine's helpers because
   * the room has already decided, and the engine has a helper for some of
   * these and not others.
   */
  useEffect(() => {
    const result = online?.result;
    if (!result) return;
    setGameState((current) => (current.result ? current : { ...current, result }));
    setStatus(describeResult(result, names));
    setClock((current) => stopClock(current, Date.now()));
  }, [online?.result, names]);

  /**
   * `setSelected` plus spec 10.4's neutral-only wording: selecting a neutral
   * with a capture on offer names it ("Using the neutral Paper — capture a
   * Red Rock"); selecting one with nothing to capture explains why tapping
   * it did not queue a move. A side's own piece says nothing extra here — the
   * status line already reads "Blue's move." for that.
   */
  const selectSquare = useCallback(
    (square: Square) => {
      setSelected(square);
      const piece = decodePiece(gameState.board[square]!);
      if (piece?.owner === 'neutral') {
        const hasCapture = legal.some((m) => m.from === square && m.captured != null);
        setStatus(neutralSelectionText(piece.type, other(gameState.turn), hasCapture, names));
      }
    },
    [gameState.board, gameState.turn, legal, names],
  );

  /** The shared core of a tap-elsewhere and a drag-release: what happens when
   * the piece at `from` is aimed at `to`. */
  const resolveDestination = useCallback(
    (from: Square, to: Square) => {
      const legalHere = legal.find((m) => m.from === from && m.to === to);
      if (legalHere) {
        doMove(legalHere);
        return;
      }
      if (isSelectable(to)) {
        selectSquare(to); // your own other piece: reselect to it
        return;
      }
      const fromPiece = decodePiece(gameState.board[from]!);
      const toCode = gameState.board[to]!;
      if (fromPiece && toCode !== 0 && distance(from, to) === 1) {
        const toPiece = decodePiece(toCode)!;
        setStatus(illegalCaptureReason(fromPiece.type, toPiece.type));
        const el = containerRef.current?.querySelector(`[data-square="${to}"]`);
        if (el) {
          el.classList.remove('shake');
          // Force a reflow so re-adding the class restarts the animation on
          // a second tap of the same illegal target.
          void (el as HTMLElement).offsetWidth;
          el.classList.add('shake');
        }
        return; // keep the selection — spec 10.4: illegal target, no penalty
      }
      setSelected(null); // empty, out of reach, or anything else: cancel
    },
    [legal, isSelectable, doMove, gameState.board, selectSquare],
  );

  const resolveClick = useCallback(
    (square: Square) => {
      if (gameOver) return;
      if (selected == null) {
        if (isSelectable(square)) {
          selectSquare(square);
          return;
        }
        // A neutral with nothing to capture has no legal move, so it never
        // passes `isSelectable` — but spec 10.4 still wants the tap explained
        // rather than silently doing nothing.
        if (humanTurn && !reviewing) {
          const piece = decodePiece(gameState.board[square]!);
          if (piece?.owner === 'neutral') {
            setStatus(neutralSelectionText(piece.type, other(gameState.turn), false, names));
          }
        }
        return;
      }
      if (square === selected) {
        setSelected(null); // tap the selected piece again: cancel
        return;
      }
      resolveDestination(selected, square);
    },
    [gameOver, selected, isSelectable, selectSquare, resolveDestination, humanTurn, reviewing, gameState.board, gameState.turn, names],
  );

  // --- Pointer input: tap AND drag share resolveClick/resolveDestination.
  const rectFor = useCallback(() => {
    const node = containerRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { left: rect.left, top: rect.top, size: boardPx };
  }, [boardPx]);

  // pointerdown only remembers where the gesture began — it changes no
  // state. Every gesture (a plain tap, or a drag that ends elsewhere) is
  // resolved once, entirely on release. An earlier version had pointerdown
  // eagerly select the piece too, so a single tap raced itself: press set
  // `selected`, and release — now seeing that same square as "the selected
  // one" — matched the deselect branch and immediately cleared it again,
  // which looked like clicks doing nothing at all. One state change per
  // gesture is what removes the race, not a special case for it.
  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (gameOver || reviewing) return;
      const rect = rectFor();
      if (!rect) return;
      const square = squareAt(rect, event.clientX, event.clientY, orientation);
      if (square == null) return;
      dragOriginRef.current = square;
    },
    [gameOver, reviewing, rectFor, orientation],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const origin = dragOriginRef.current;
      dragOriginRef.current = null;
      if (gameOver || reviewing || origin == null) return;
      const rect = rectFor();
      if (!rect) return;
      const square = squareAt(rect, event.clientX, event.clientY, orientation);
      if (square == null) return;

      if (square === origin) {
        resolveClick(square); // a plain tap
        return;
      }
      // A drag: resolve against whichever piece is selected once this
      // release is handled — the one already selected, or (nothing was
      // selected yet) the gesture's own origin, so "press a piece and drag
      // it to a destination" works as one gesture, not two.
      if (selected != null) {
        resolveDestination(selected, square);
      } else if (isSelectable(origin)) {
        resolveDestination(origin, square);
      }
    },
    [gameOver, reviewing, rectFor, orientation, selected, isSelectable, resolveClick, resolveDestination],
  );

  // --- Hover (spec 10.4/10.5): a subtle highlight, and — if the threat-lines
  // aid is on — arrows for whichever piece the mouse is over. Deliberately
  // NOT the legal-move dots: those stay tied to an actual `selected` piece,
  // an intent to move, not merely a pointer passing over the board.
  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      // Touch fires the same pointer events on tap, with no "leave" until a
      // later tap lands elsewhere — treating that as hover would leave a
      // highlight and a set of arrows stuck on whatever was touched last.
      if (event.pointerType !== 'mouse' || gameOver || reviewing) {
        setHoverSquare(null);
        return;
      }
      const rect = rectFor();
      setHoverSquare(rect ? squareAt(rect, event.clientX, event.clientY, orientation) : null);
    },
    [gameOver, reviewing, rectFor, orientation],
  );
  const onPointerLeave = useCallback(() => setHoverSquare(null), []);

  // --- Keyboard: arrow keys move the cursor; Enter/Space is exactly a tap on
  // it (spec 10.4) — reusing resolveClick is what makes this a complete input
  // method rather than a second, easily-diverging implementation.
  //
  // In review the same arrows step through the game instead (spec 10.8).
  // That is not a clash: reviewing has no cursor to move and nothing to
  // select, so the two readings of an arrow key never both apply.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (reviewing) {
        const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
        const step = steps[event.key];
        if (step !== undefined) {
          event.preventDefault();
          setViewPly((ply) => Math.min(history.length, Math.max(0, (ply ?? 0) + step)));
          return;
        }
        if (event.key === 'Home') {
          event.preventDefault();
          setViewPly(0);
          return;
        }
        if (event.key === 'End') {
          event.preventDefault();
          setViewPly(history.length);
          return;
        }
        if (event.key === 'Escape' && !reviewOnly) {
          event.preventDefault();
          setViewPly(null); // back to the live game
          return;
        }
        return;
      }

      const arrows: Record<string, [number, number]> = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      };
      const delta = arrows[event.key];
      if (delta) {
        event.preventDefault();
        // Pressing an arrow IS the keyboard taking over, whatever
        // `:focus-visible` decided when the board was focused.
        setKeyboardCursor(true);
        // Screen directions, not board ones — the cursor follows the arrow a
        // player actually pressed, whichever way round the board is.
        setFocus((f) => clampSquare(f, delta[0], delta[1], orientation));
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        resolveClick(focus);
        return;
      }
      if (event.key === 'Escape') {
        setSelected(null);
        return;
      }
      if (event.key === 'u' || event.key === 'U') {
        event.preventDefault();
        undo();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focus, resolveClick, reviewing, reviewOnly, history.length, orientation],
  );

  function undo() {
    if (history.length === 0 || gameOver || reviewing) return;
    // Online there is no unilateral undo: taking a move back needs the
    // opponent's agreement, which is a takeback offer the room arbitrates.
    // The button is disabled, so this is the keyboard shortcut's guard.
    if (online) return;
    // Against the computer, Undo takes back your move AND its reply — two
    // plies (spec 10.8) — so you land back on your own turn, not its.
    // Exactly one ply is available while the reply hasn't arrived yet
    // (`thinking`): only your move exists to take back, and the effect
    // above cancels the in-flight think as soon as `history` changes.
    const plies = computer && !thinking && history.length >= 2 ? 2 : 1;
    const target = history.length - plies;
    const nextHistory = history.slice(0, target);
    const replayed = replay(variant, nextHistory);
    setHistory(nextHistory);
    setGameState(replayed.state);
    setSelected(null);
    setAnim(null);
    setThinking(false);
    const lastEvents = replayed.events.at(-1);
    const moveEvent = lastEvents?.find((e): e is Extract<typeof e, { type: 'move' }> => e.type === 'move');
    setLastMove(moveEvent ? { from: moveEvent.from, to: moveEvent.to } : null);
    setStatus(whoseTurn(replayed.state.turn, names));

    // The clock goes back to what it read when that position was first
    // reached — both sides, and the stage each was in, not just the player
    // who pressed Undo. `rewind` is the pure part and knows nothing about
    // the time of day; `startTurn` re-anchors it to now and hands the turn
    // to whoever is to move.
    //
    // Gifts made before that point survive, because they are in the snapshot.
    // One made during an undone turn does not, which is the honest reading:
    // it was given in a part of the game that no longer happened. Nothing is
    // farmable either way — a self-gift is already unlimited against the
    // computer (gifts.ts: "there is nobody to cheat"), and in pass-and-play
    // a gift only ever helps the opponent.
    const restored = rewind(clockStack, target);
    setClockStack(clockStack.slice(0, target + 1));
    setClock(startTurn(restored, replayed.state.turn, Date.now()));
  }

  function doResign() {
    if (gameOver) return;
    // Online, every ending is the room's to declare — this browser asks, and
    // the result comes back as a message like any other. Ending it locally
    // would show one player a finished game the other was still playing.
    if (online) {
      online.send.resign();
      return;
    }
    const resigned = engineResign(gameState, gameState.turn);
    setGameState(resigned);
    setSelected(null);
    setStatus(describeResult(resigned.result!, names));
    setClock((c) => stopClock(c, Date.now()));
  }

  function doAbort() {
    if (gameOver) return;
    if (!canAbort(gameState.ply, mode).ok) return;
    if (online) {
      online.send.abort();
      return;
    }
    const aborted = abortGame(gameState);
    setGameState(aborted);
    setSelected(null);
    setStatus(describeResult(aborted.result!, names));
    setClock((c) => stopClock(c, Date.now()));
  }

  function offerDraw() {
    if (gameOver) return;
    if (online) {
      // The room keeps the offer state, including lichess's rule that you
      // cannot re-offer straight after a refusal — so the etiquette is
      // enforced in one place rather than trusted to each browser.
      online.send.offerDraw();
      return;
    }
    const by = gameState.turn;
    if (!canOffer(offers, 'draw', by, gameState.ply).ok) return;
    const outcome = makeOffer(offers, 'draw', by, gameState.ply);
    setOffers(outcome.state);
    if (outcome.accepted) settleDraw();
  }

  function settleDraw() {
    const agreed = agreeDraw(gameState);
    setGameState(agreed);
    setStatus(describeResult(agreed.result!, names));
    setClock((c) => stopClock(c, Date.now()));
  }

  function respondToDraw(accept: boolean) {
    if (online) {
      if (accept) online.send.acceptDraw();
      else online.send.declineDraw();
      return;
    }
    if (!offers.pending) return;
    const responder = other(offers.pending.by);
    if (accept) {
      const outcome = acceptOffer(offers, responder);
      setOffers(outcome.state);
      settleDraw();
    } else {
      setOffers(declineOffer(offers, responder));
    }
  }

  // The button beside your OWN clock, playing the computer, is the
  // addendum's self-gift ("nobody to cheat") — from and to are the same
  // side. Every other case (either clock in pass-and-play, or the
  // computer's clock playing it) is the courtesy: from the other side. Both
  // happen to be permitted in vs-computer mode, so this doesn't change
  // whether either button is live — but `clock.gifts` is supposed to tell
  // the truth about who gave what (spec 8.3), and only one of the two is true.
  function giftFrom(to: Side): Side {
    return computer && to === humanSide ? to : other(to);
  }

  function giveTimeTo(to: Side) {
    const from = giftFrom(to);
    if (!canGive(GIFT_POLICIES[mode], from, to).ok) return;
    setClock((c) => giveTime(c, { ply: gameState.ply, from, to, ms: GIFT_POLICIES[mode].ms }));
  }

  /**
   * One click, not an offer/accept pair: both players (or the one player and
   * the computer) are already right here, so there is nothing to negotiate
   * the way a mid-game draw does — offers.ts's 'rematch' kind is for a mode
   * where the two sides aren't already agreeing in person (M5+'s online play).
   *
   * "Sides swapped" (spec 10.7) is now a real option rather than a deferred
   * one, because the board can be turned around. It is the caller's call to
   * make: which side the computer plays is a prop, and a fresh mount is a
   * more trustworthy reset than clearing each piece of state by hand.
   */
  function rematch(swapSides: boolean) {
    onRematch(swapSides);
  }

  /** Spec 8.4's shareable link — the record, minus players and seed, in the URL. */
  function shareLink(): string {
    const clock = clockRecord(clockStack);
    const record: GameRecord = {
      game: 'stone-paper-scissors',
      rulesVersion: 1,
      variant: variant.id,
      start: variant.start,
      moves: history,
      ...(gameState.result ? { result: gameState.result } : {}),
      // The clock section is what stops a shared game hiding that somebody
      // handed themselves ten extra minutes (spec 8.3's own note on it).
      ...(clock ? { clock } : {}),
    };
    const { origin, pathname } = window.location;
    return `${origin}${pathname}${SHARE_PREFIX}${encodeRecord(record)}`;
  }

  function copyLink() {
    const link = shareLink();
    // The clipboard is not always there to write to — an insecure origin, or
    // a browser that wants a user gesture it did not see. Putting the link in
    // the address bar as a fallback means the player can still copy it by
    // hand, which beats a button that silently did nothing.
    if (!navigator.clipboard) {
      window.location.hash = link.slice(link.indexOf('#') + 1);
      setCopyNote('Copy it from the address bar — this browser will not copy for the page.');
      return;
    }
    void navigator.clipboard
      .writeText(link)
      .then(() => setCopyNote('Link copied.'))
      .catch(() => {
        window.location.hash = link.slice(link.indexOf('#') + 1);
        setCopyNote('Copy it from the address bar — the clipboard refused.');
      });
  }

  // --- The clock: ticks `now` for a live display, and is the one place that
  // detects a flag. `flaggedAt` is a pure query (clock.ts) — it changes
  // nothing by itself, so the moment it reports a fallen side, THIS effect is
  // what turns that into an actual game-over via the engine's own `flag()`
  // (spec: the engine has no timers, so a flag is always something outside it
  // decides and then tells it about, exactly like resign).
  useEffect(() => {
    if (gameOver || reviewOnly || control.unlimited) return;
    const interval = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      const fallen = flaggedAt(clock, current);
      if (fallen) {
        setGameState((gs) => {
          if (gs.result) return gs;
          const flagged = engineFlag(gs, fallen);
          setStatus(describeResult(flagged.result!, names));
          return flagged;
        });
        setClock((c) => stopClock(c, current));
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [gameOver, reviewOnly, control.unlimited, clock, names]);

  // --- Sound's other half (spec 10.12): the chime marks any way a game can
  // end, not only the corner/no-moves paths `doMove` sees directly — resign,
  // abort, a flag and an agreed draw all set `gameState.result` through
  // their own engine calls above, and this is the one place that has to
  // notice every one of them rather than a chime call sprinkled into each.
  // Keyed off the result itself, which only ever goes null -> set once per
  // mounted game, so this fires exactly once per game, whichever way it ends.
  useEffect(() => {
    if (reviewOnly || !gameState.result || !sound) return;
    playChime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.result]);

  // --- Resume-after-reload and local stats (spec 10.13): App.tsx owns the
  // actual localStorage write, so this only ever hands up what changed —
  // never touching storage from a component whose whole reason to exist is
  // the rules and the board, not persistence.
  useEffect(() => {
    if (reviewOnly) return;
    onProgress?.({ history, clockStack, result: gameState.result });
  }, [reviewOnly, onProgress, history, clockStack, gameState.result]);

  // --- The computer opponent (M4): one worker for the component's life
  // (spec 9.4, "search never blocks the board"), a message handler kept
  // current with the latest doMove, and a think-trigger that fires whenever
  // it becomes the computer's side to move.
  useEffect(() => {
    const worker = createAiWorker();
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      setThinking(false);
      const move = parseMove(gameState, event.data.move);
      doMove(move);
    };
  }, [gameState, doMove]);

  useEffect(() => {
    if (!computer || gameOver || gameState.turn !== computer.side || thinking) return;
    const worker = workerRef.current;
    if (!worker) return;
    setThinking(true);
    const record: GameRecord = {
      game: 'stone-paper-scissors',
      rulesVersion: 1,
      variant: variant.id,
      start: variant.start,
      moves: history,
    };
    const message: ToWorker = { type: 'think', record, level: computer.level, seed: randomSeed() };
    worker.postMessage(message);
    // Cancels a think that's still in flight if the position changes before
    // it replies — a legitimate Undo/Rematch mid-think, and also what makes
    // StrictMode's dev-time double-effect safe: the first, cancelled attempt
    // is never posted back (worker.ts's own generation counter), so this
    // never doubles a move.
    return () => {
      const cancel: ToWorker = { type: 'cancel' };
      worker.postMessage(cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computer, gameState, gameOver, history, variant]);

  // The computer answers a human's draw offer itself — spec's own draw.ts
  // exists for exactly this. It never offers one on its own initiative.
  useEffect(() => {
    if (!computer || gameOver) return;
    const pending = offers.pending;
    if (!pending || pending.kind !== 'draw' || pending.by !== humanSide) return;
    const timer = window.setTimeout(() => {
      const decision = shouldAcceptDraw(gameState, computer.side, computer.level, randomSeed());
      if (decision.accept) {
        const outcome = acceptOffer(offers, computer.side);
        setOffers(outcome.state);
        settleDraw();
      } else {
        setOffers(declineOffer(offers, computer.side));
        setStatus(`Computer declines — ${decision.reason}.`);
      }
      // A beat, not instant: an immediate answer reads as dismissive rather
      // than considered, whatever the actual reasoning cost.
    }, 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computer, gameOver, offers, gameState, humanSide]);

  // --- Animation: the 150ms slide every move gets, and the matchup motion on
  // top of a capture. Pure arithmetic decides the slide offset (no DOM read
  // of an "old" position needed); reduced motion skips this entirely, which
  // is safe because the render above is already the correct final frame.
  useEffect(() => {
    if (!anim || reducedMotion) {
      setAnim(null);
      return;
    }
    const container = containerRef.current;
    if (!container) {
      setAnim(null);
      return;
    }

    // The INNER group, never the positioned outer one — see `piecesLayer`.
    const captorEl = container.querySelector(`[data-square="${anim.move.to}"] .${PIECE_MOTION_CLASS}`);
    const { dx, dy } = slideOffsetPx(anim.move.from, anim.move.to, squarePx, orientation);
    const duration = anim.motion ? MOTION_MS.capture : MOTION_MS.slide;
    captorEl?.animate(captorKeyframes(anim.motion, dx, dy), {
      duration,
      // `both` matters: without it the browser paints one frame of the final
      // position before the first keyframe lands, which reads as a flicker at
      // the destination just before the piece slides into it.
      fill: 'both',
      // Easing is per-keyframe (see `captorKeyframes`) so each segment of a
      // capture can have its own curve; a single curve stretched over four
      // keyframes is what made the overshoot land flat.
      easing: 'linear',
    });

    let overlay: HTMLDivElement | null = null;
    const captured = anim.move.captured;
    if (anim.motion && captured) {
      const isNeutral = captured.owner === 'neutral';
      const square = anim.move.to; // captures land ON the taken piece's square
      // Screen cell, not the raw index: the overlay sits on top of the board
      // in page coordinates, so it has to be placed where the square is DRAWN.
      // Deriving row and col from the index arithmetic directly would put the
      // dying piece in the wrong place on a rotated board.
      const { row, col } = displayCell(square, orientation);
      overlay = document.createElement('div');
      overlay.className = 'victim-overlay';
      overlay.style.left = `${col * squarePx}px`;
      overlay.style.top = `${row * squarePx}px`;
      overlay.style.width = `${squarePx}px`;
      overlay.style.height = `${squarePx}px`;
      overlay.innerHTML = renderPieceSample({
        type: captured.type,
        family,
        mode: squarePx * 0.62 >= 32 ? 'standalone' : 'knockout',
        squarePx,
        // A neutral has no side colour of its own — the theme's dedicated
        // token, same one `piecesLayer` paints it with everywhere else.
        // Narrowing `captured.owner` directly (not via `isNeutral`) is what
        // lets TS carry "not neutral" through to `Record<Side, string>`.
        color: captured.owner !== 'neutral' ? view.sideColors[captured.owner] : THEMES[theme].neutral,
        // The overlay sits exactly over the real square, so painting a
        // knockout mark in the theme's actual square colour reads as
        // seamless against what's already underneath it.
        squareColor: THEMES[theme].square,
        isOpponent: !isNeutral && captured.owner !== view.viewerSide,
        isNeutral,
      });
      container.appendChild(overlay);
      const victimAnim = overlay.animate(victimKeyframes(anim.motion), {
        duration,
        fill: 'forwards',
        easing: TRAVEL,
      });
      victimAnim.onfinish = () => overlay?.remove();
    }

    const timer = window.setTimeout(() => setAnim(null), duration + 50);
    return () => {
      window.clearTimeout(timer);
      overlay?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim]);

  const drawOfferPending = online
    ? online.offer?.kind === 'draw'
      ? online.offer
      : null
    : offers.pending?.kind === 'draw'
      ? offers.pending
      : null;
  const opponentSide = other(humanSide);

  /** The race meter's panel line (spec 10.5), one per side — null hides the row entirely rather than rendering an empty one. */
  const raceMeterLine = useMemo((): Record<Side, string | null> => {
    if (reviewing || !aids.raceMeter) return { blue: null, red: null };
    return { blue: raceMeterText(nearestRunner(gameState, 'blue')), red: raceMeterText(nearestRunner(gameState, 'red')) };
  }, [gameState, reviewing, aids.raceMeter]);

  /**
   * The Keep's panel line (spec 7.6, 10.5) — shown on the sealed side's own
   * panel, next to the lock badge `sealedSides` already puts on their
   * corner square, so the two read as one fact rather than two unrelated
   * ones.
   */
  const keepLockLine = useMemo((): Record<Side, string | null> => {
    const line = (side: Side) => (sealedSides.includes(side) ? keepLockText(side, names) : null);
    return { blue: line('blue'), red: line('red') };
  }, [sealedSides, names]);

  /**
   * The type-count aid's spelled-out consequence (spec 10.5): "Red has no
   * Paper left — Blue's Rocks are permanent." Gated on the engine's own
   * `isPermanent` for an actual piece of the beneficiary type, not on the
   * zero count alone — `permanentPieceText`'s own doc comment is why: a
   * surviving neutral of the predator type can keep the beneficiary's piece
   * capturable even after both sides' own count of it reaches zero.
   */
  const permanentNotes = useMemo(() => {
    if (reviewing || !aids.permanentPieces) return [];
    const notes: string[] = [];
    for (const outSide of ['blue', 'red'] as const) {
      for (const type of PIECE_TYPES) {
        if (counts[outSide][type] !== 0) continue;
        const beneficiary = other(outSide);
        const permanentType = beats(type);
        let square = -1;
        for (let s = 0; s < gameState.board.length; s++) {
          const piece = decodePiece(gameState.board[s]!);
          if (piece?.owner === beneficiary && piece.type === permanentType) {
            square = s;
            break;
          }
        }
        if (square >= 0 && isPermanent(gameState, square)) notes.push(permanentPieceText(outSide, type, names));
      }
    }
    return notes;
  }, [gameState, counts, reviewing, aids.permanentPieces, names]);

  /**
   * Spec 10.7's numbers, computed once the game is actually over — replaying
   * the whole game on every render of a live board would be waste, and there
   * is nothing to show until there is a result.
   */
  const summary = useMemo(
    () => (gameOver ? summarise(replay(variant, history).events) : null),
    [gameOver, variant, history],
  );

  return (
    // `--board-px` is the one number the panels, the move list and the overlay
    // all line up against, and it is the SAME number the renderer is handed —
    // so the layout cannot drift from the board it is framing.
    <div
      // Two columns on a desktop, one on a phone (spec 10.11). Zen collapses
      // back to one whatever the width: with the move list and the status
      // line gone the rail would be an empty column holding four buttons,
      // and a centred board is the whole point of the quiet view.
      className={`game${showRail ? ' game--rail' : ''}${zen ? ' game--zen' : ''}`}
      style={{ '--board-px': `${boardPx}px` } as React.CSSProperties}
    >
      <button className="back" onClick={onExit} type="button">
        ← Home
      </button>

      <div className="game-board">
      <Panel
        side={opponentSide}
        name={sideName(opponentSide, names)}
        showName={!zen}
        place="opponent"
        counts={counts[opponentSide]}
        remainingMs={reviewOnly ? null : remainingAt(clock, opponentSide, now)}
        urgency={urgencyOf(clock, opponentSide, now)}
        running={clock.running === opponentSide}
        raceMeter={raceMeterLine[opponentSide]}
        keepLock={keepLockLine[opponentSide]}
        onGiveTime={
          canGive(GIFT_POLICIES[mode], giftFrom(opponentSide), opponentSide).ok
            ? () => giveTimeTo(opponentSide)
            : null
        }
      />

      <div
        ref={containerRef}
        className="board-wrap"
        style={{ width: boardPx, height: boardPx }}
        tabIndex={0}
        role="group"
        aria-label={
          reviewing
            ? `${variant.name} board, reviewing move ${fullMoveOf(viewPly ?? 0)} of ${fullMoveOf(history.length)}. Use left and right arrows to step.`
            : `${variant.name} board. Use arrow keys to move the cursor, Enter to select or move.`
        }
        aria-describedby="game-cell"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          // `:focus-visible` is what tells a tab from a click. Wrapped
          // because a browser without it throws on the selector rather than
          // returning false, and a thrown match here would break the board.
          try {
            setKeyboardCursor(event.currentTarget.matches(':focus-visible'));
          } catch {
            setKeyboardCursor(false);
          }
        }}
        onBlur={() => setKeyboardCursor(false)}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      <Panel
        side={humanSide}
        name={sideName(humanSide, names)}
        showName={!zen}
        place="you"
        counts={counts[humanSide]}
        remainingMs={reviewOnly ? null : remainingAt(clock, humanSide, now)}
        urgency={urgencyOf(clock, humanSide, now)}
        running={clock.running === humanSide}
        raceMeter={raceMeterLine[humanSide]}
        keepLock={keepLockLine[humanSide]}
        onGiveTime={
          canGive(GIFT_POLICIES[mode], giftFrom(humanSide), humanSide).ok
            ? () => giveTimeTo(humanSide)
            : null
        }
      />
      </div>

      <div className="game-side">
      {/* Zen hides the status line to look at, not to hear: it stays in the
          DOM as the polite live region every move is announced through
          (spec 10.6, 10.10). A quiet board is a visual request, and dropping
          a screen reader's only narration to honour it would be a poor
          trade. `.sr-only` is the standard clip, not `display: none`, which
          would take it out of the accessibility tree too. */}
      <p className={`status${zen ? ' sr-only' : ''}`} aria-live="polite">
        {thinking ? 'Computer is thinking…' : status}
      </p>
      <p id="game-cell" className="sr-only" aria-live="polite">
        {cellText}
      </p>

      {/* Spec 10.5's "consequence spelled out" for a type at zero. Shared
          rather than split across the two panels — the sentence names both
          sides at once ("Red has no Paper left — Blue's Rocks are
          permanent"), so one line here reads better than half of it living
          in each panel. */}
      {permanentNotes.length > 0 && (
        <ul className="aid-notes" aria-live="polite">
          {permanentNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {drawOfferPending && !gameOver && (
        <div className="offer-banner">
          {/* Online, the offer belongs to one of the two people looking at
              this, and only the other one may answer it. Offline both sides
              are the same person, so the buttons are always live. */}
          {online && drawOfferPending.by === humanSide ? (
            <p>Draw offered. Waiting for {sideName(other(humanSide), names)}.</p>
          ) : (
            <>
              <p>{sideName(drawOfferPending.by, names)} offers a draw.</p>
              <button type="button" onClick={() => respondToDraw(true)}>
                Accept
              </button>
              <button type="button" onClick={() => respondToDraw(false)}>
                Decline
              </button>
            </>
          )}
        </div>
      )}

      {reviewing ? (
        // Spec 10.8: "steps through a game with the arrows, and jumps to the
        // start or end". The same controls the keyboard already drives, so
        // touch gets the feature too rather than only a keyboard does.
        <div className="bar bar--review">
          <button type="button" onClick={() => setViewPly(0)} disabled={viewPly === 0} title="Start">
            ⏮
          </button>
          <button
            type="button"
            onClick={() => setViewPly(Math.max(0, (viewPly ?? 0) - 1))}
            disabled={viewPly === 0}
            title="Previous move"
          >
            ‹
          </button>
          <span className="review-count">
            {fullMoveOf(viewPly ?? 0)} / {fullMoveOf(history.length)}
          </span>
          <button
            type="button"
            onClick={() => setViewPly(Math.min(history.length, (viewPly ?? 0) + 1))}
            disabled={viewPly === history.length}
            title="Next move"
          >
            ›
          </button>
          <button
            type="button"
            onClick={() => setViewPly(history.length)}
            disabled={viewPly === history.length}
            title="End"
          >
            ⏭
          </button>
          {!reviewOnly && (
            <button type="button" className="review-leave" onClick={() => setViewPly(null)}>
              Back to game
            </button>
          )}
        </div>
      ) : (
        <div className="bar">
          {/* Online, a move is taken back only by agreement — offers.ts allows
              a takeback in a casual game and the room arbitrates it. Until
              there is a button for asking, there is no button for doing. */}
          {!online && (
            <button type="button" onClick={undo} disabled={history.length === 0 || gameOver} title="Undo">
              ↺
            </button>
          )}
          <button
            type="button"
            onClick={offerDraw}
            disabled={gameOver || drawOfferPending != null || !OFFER_POLICIES[mode].allowed.includes('draw')}
            title="Offer draw"
          >
            ½
          </button>
          <button type="button" onClick={doAbort} disabled={gameOver || !canAbort(gameState.ply, mode).ok} title="Abort game">
            ⊗
          </button>
          <button type="button" onClick={doResign} disabled={gameOver} className="resign" title="Resign">
            ⚐
          </button>
          {onToggleSound && (
            // Spec 10.12's "mute toggle that's remembered" — App.tsx persists
            // it the same way it persists Zen, which is why this lives beside
            // Zen's own toggle rather than a Settings screen that doesn't
            // exist yet (M6/M8's own note on that).
            <button
              type="button"
              onClick={onToggleSound}
              className={`sound${sound ? '' : ' sound--off'}`}
              aria-pressed={!sound}
              title={sound ? 'Mute sound' : 'Unmute sound'}
            >
              {sound ? '🔊' : '🔇'}
            </button>
          )}
          {onToggleZen && (
            // The toggle lives in the bar rather than behind a Settings
            // screen because the bar is the one thing Zen keeps — so the way
            // out is always exactly where the way in was.
            <button
              type="button"
              onClick={onToggleZen}
              className={`zen${zen ? ' zen--on' : ''}`}
              aria-pressed={zen}
              title={zen ? 'Leave Zen — show names and the move list' : 'Zen — board, clocks and counts only'}
            >
              ☯
            </button>
          )}
        </div>
      )}

      {/* Zen drops the move list entirely (not merely closed): the drawer's
          own summary row is chrome too, and leaving it would half-honour the
          request. Review still opens it, because stepping through a game
          with no list of moves is not a quiet board, it is a broken one. */}
      {(!zen || reviewing) && (
        <MoveList
          moves={history}
          viewPly={viewPly}
          defaultOpen={wideEnoughForList}
          onPick={(ply) => setViewPly(ply)}
        />
      )}

      {gameState.result && summary && !reviewing && (
        <GameOver
          result={gameState.result}
          summary={summary}
          humanSide={computer ? humanSide : null}
          names={names}
          onRematch={() => rematch(false)}
          // Nothing to swap in pass-and-play: both players are on the one
          // device and neither of them "is" a side the board is drawn for.
          onSwapSides={computer ? () => rematch(true) : null}
          onReview={() => setViewPly(0)}
          onCopyLink={copyLink}
          copyNote={copyNote}
          stats={computer ? stats : null}
        />
      )}
      </div>
    </div>
  );
}

interface PanelProps {
  side: Side;
  /** Display name — the custom pass-and-play name if one was given, else the colour name (`sideName`). */
  name: string;
  /**
   * Which corner this panel belongs beside, NOT which colour it is. Each
   * player's name sits by their own corner (the Bar layout,
   * docs/VISUAL_SYSTEM.md 8) — and because the board turns around for a
   * Red-playing human (spec 10.2), the viewer's own corner is always the
   * bottom-left one on screen. So the anchoring is a function of "yours or
   * theirs", never of blue or red, and it needs no second rule for a
   * rotated board.
   */
  place: 'you' | 'opponent';
  /** Zen keeps the clocks and counts but drops the names (C2). */
  showName: boolean;
  counts: Record<PieceType, number>;
  /**
   * null hides the chip entirely, which is what a review wants: the record
   * carries a per-move `remainingMs` (spec 8.3) but nothing here replays it
   * yet, and a chip reading the control's full 10:00 over a game somebody
   * actually lost on time would be a straight lie. Reconstructing the clock
   * ply by ply is a real review feature and belongs with M8's persistence.
   */
  remainingMs: number | null;
  urgency: Urgency;
  running: boolean;
  /** The race meter's line for this side (spec 10.5) — null hides the row (Zen, Hard, or the aid switched off). */
  raceMeter: string | null;
  /** The Keep's panel line (spec 7.6, 10.5) — set only on the sealed side's own panel. */
  keepLock: string | null;
  /** null when this mode/direction can't gift time (spec: e.g. self-gift, off outside vs-computer). */
  onGiveTime: (() => void) | null;
}

function Panel({
  side,
  name,
  showName,
  place,
  counts,
  remainingMs,
  urgency,
  running,
  raceMeter,
  keepLock,
  onGiveTime,
}: PanelProps) {
  return (
    <div className={`panel panel--${place} panel--${side}`}>
      {showName ? (
        <span className="panel-name">
          {/* Colour alone never carries ownership (spec 10.3, CLAUDE.md), so the
              swatch is decoration beside a name that already says which side. */}
          <span className="panel-dot" aria-hidden="true" />
          <span className="panel-name-text">{name}</span>
        </span>
      ) : (
        // Zen drops the name, but the dot stays and keeps its label. Without
        // it the two rows would be told apart by position alone — and the
        // counts do not say whose they are, so a screen reader would read
        // two identical rows of numbers.
        <span className="panel-name panel-name--bare">
          <span className="panel-dot" aria-hidden="true" />
          <span className="sr-only">{name}</span>
        </span>
      )}
      <span className="panel-counts">
        {(['rock', 'paper', 'scissors'] as const).map((type) => (
          <span key={type} className={`count${counts[type] === 0 ? ' count--out' : counts[type] === 1 ? ' count--last' : ''}`}>
            {pieceTypeName(type)[0]}
            {counts[type]}
          </span>
        ))}
      </span>
      {remainingMs !== null && (
        <span className={`clock-chip clock-chip--${urgency}${running ? ' clock-chip--running' : ''}`}>
          {formatClock(remainingMs)}
          {onGiveTime && (
            <button type="button" className="gift" onClick={onGiveTime} title={`Give ${name} 15s`}>
              +
            </button>
          )}
        </span>
      )}
      {raceMeter && <p className="panel-aid panel-race">{raceMeter}</p>}
      {keepLock && <p className="panel-aid panel-keep-lock">{keepLock}</p>}
    </div>
  );
}
