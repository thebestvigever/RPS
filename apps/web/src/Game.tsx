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
  SHARE_PREFIX,
  abortGame,
  agreeDraw,
  applyMove,
  decodePiece,
  distance,
  encodeRecord,
  flag as engineFlag,
  legalMoves,
  moveToText,
  other,
  parseMove,
  replay,
  resign as engineResign,
  summarise,
  toFen,
  typeCounts,
} from '@sps/engine';
import type { GameRecord, GameResult, GameState, Move, PieceType, Side, Square, VariantConfig } from '@sps/engine';
import {
  MOTION_MS,
  THEMES,
  captureMotion,
  illegalCaptureReason,
  displayCell,
  pieceTypeName,
  renderBoard,
  renderPieceSample,
} from '@sps/board';
import type { Appearance, FamilyId, MotionKind, Orientation, ThemeId } from '@sps/board';
import {
  GIFT_POLICIES,
  OFFER_POLICIES,
  canAbort,
  canGive,
  canOffer,
  clockRecord,
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
} from '@sps/match';
import type { ClockState, MatchMode, OfferState, TimeControl, Urgency } from '@sps/match';
import { shouldAcceptDraw } from '@sps/ai';
import type { FromWorker, Level, ToWorker } from '@sps/ai';
import { clampSquare, slideOffsetPx, squareAt } from './board-geometry.js';
import { describeResult, describeTurn, fullMoveOf, whoseTurn } from './announce.js';
import { formatClock } from './clock-format.js';
import { createAiWorker } from './ai-worker.js';
import MoveList from './MoveList.js';
import GameOver from './GameOver.js';
import './game.css';

export interface Computer {
  side: Side;
  level: Level;
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
}

function useBoardPx(): number {
  // spec 10.2: min(viewport - 32, space left by panels, 640). This app has no
  // side rail yet (that's the Rail layout, deferred past M3 — decision 4 of
  // docs/VISUAL_SYSTEM.md), so "space left by panels" is the full width.
  const [px, setPx] = useState(() => (typeof window === 'undefined' ? 360 : Math.min(window.innerWidth - 32, 640)));
  useEffect(() => {
    const onResize = () => setPx(Math.min(window.innerWidth - 32, 640));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return px;
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

/** Captor keyframes: the 150ms slide every move gets, with the matchup's own
 * shape (README 3b) layered on for a capture. Eased as one curve rather than
 * per-segment — a reasonable simplification of a CSS animation, not a rules
 * question, and noted here rather than left silent. */
function captorKeyframes(motion: MotionKind | null, dx: number, dy: number): Keyframe[] {
  const arrive = `translate(${dx}px, ${dy}px)`;
  if (!motion) return [{ transform: arrive }, { transform: 'translate(0, 0)' }];
  if (motion === 'crush') {
    return [
      { transform: `${arrive} scale(1)`, offset: 0 },
      { transform: 'translate(0, 0) scale(1.16)', offset: 0.55 },
      { transform: 'translate(0, 0) scale(0.94)', offset: 0.8 },
      { transform: 'translate(0, 0) scale(1)', offset: 1 },
    ];
  }
  if (motion === 'cut') {
    return [
      { transform: `${arrive} rotate(0deg)`, offset: 0 },
      { transform: 'translate(0, 0) rotate(-8deg)', offset: 0.4 },
      { transform: 'translate(0, 0) rotate(6deg)', offset: 0.75 },
      { transform: 'translate(0, 0) rotate(0deg)', offset: 1 },
    ];
  }
  // wrap
  return [
    { transform: `${arrive} scale(1)`, offset: 0 },
    { transform: 'translate(0, 0) scale(1.45)', offset: 0.5 },
    { transform: 'translate(0, 0) scale(1.45)', offset: 0.7 },
    { transform: 'translate(0, 0) scale(1)', offset: 1 },
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
}: GameProps) {
  const boardPx = useBoardPx();
  const squarePx = boardPx / 9;
  const reducedMotion = usePrefersReducedMotion();
  const wideEnoughForList = useWideEnoughForList();
  const containerRef = useRef<HTMLDivElement>(null);
  const dragOriginRef = useRef<Square | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const mode: MatchMode = computer ? 'vs-computer' : 'pass-and-play';
  const humanSide: Side = computer ? other(computer.side) : 'blue';

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
  const initialClock = useMemo(
    () => (reviewOnly ? createClock(control) : startTurn(createClock(control), 'blue', Date.now())),
    [control, reviewOnly],
  );

  const [history, setHistory] = useState<string[]>(() => [...(initialMoves ?? [])]);
  const [gameState, setGameState] = useState<GameState>(opening.state);
  const [selected, setSelected] = useState<Square | null>(null);
  const [focus, setFocus] = useState<Square>(0);
  const [status, setStatus] = useState<string>(() =>
    initialResult ? describeResult(initialResult) : whoseTurn(opening.state.turn),
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
  const [clockStack, setClockStack] = useState<ClockState[]>(() => [initialClock]);

  /**
   * How many plies the board is showing — null for the live position.
   *
   * One piece of state covers both of spec 10.8's readers: tapping a move in
   * the list, and Review's own stepper. A shared link is just a game that
   * opens with this already set.
   */
  const [viewPly, setViewPly] = useState<number | null>(reviewOnly ? 0 : null);
  const reviewing = viewPly !== null;

  const legal = useMemo(() => legalMoves(gameState), [gameState]);
  const counts = useMemo(() => typeCounts(gameState), [gameState]);
  const gameOver = gameState.result != null;
  const humanTurn = gameState.turn === humanSide;

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
        lastMove: shownLastMove,
        selection,
        // No cursor over a position that cannot be played — its dashed ring
        // would promise an input that does nothing.
        focusSquare: reviewing ? null : focus,
      }),
    [fen, variant, boardPx, theme, family, view, orientation, shownLastMove, selection, focus, reviewing],
  );

  const doMove = useCallback(
    (move: Move) => {
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
      setStatus(describeTurn(applied.events));
      setAnim({ move, motion: move.captured ? captureMotion(move.piece.type) : null });
      // Moving answers a pending draw offer by playing on — declined (offers.ts's
      // own rule; a rematch offer is exempt, but nothing pends one mid-game).
      setOffers((o) => offersOnMove(o));
      setClock(next);
      setClockStack((stack) => [...stack, next]);
    },
    [gameState, clock],
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
        setSelected(to); // your own other piece: reselect to it
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
    [legal, isSelectable, doMove, gameState.board],
  );

  const resolveClick = useCallback(
    (square: Square) => {
      if (gameOver) return;
      if (selected == null) {
        if (isSelectable(square)) setSelected(square);
        return;
      }
      if (square === selected) {
        setSelected(null); // tap the selected piece again: cancel
        return;
      }
      resolveDestination(selected, square);
    },
    [gameOver, selected, isSelectable, resolveDestination],
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
    setStatus(whoseTurn(replayed.state.turn));

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
    const resigned = engineResign(gameState, gameState.turn);
    setGameState(resigned);
    setSelected(null);
    setStatus(describeResult(resigned.result!));
    setClock((c) => stopClock(c, Date.now()));
  }

  function doAbort() {
    if (gameOver) return;
    if (!canAbort(gameState.ply, mode).ok) return;
    const aborted = abortGame(gameState);
    setGameState(aborted);
    setSelected(null);
    setStatus(describeResult(aborted.result!));
    setClock((c) => stopClock(c, Date.now()));
  }

  function offerDraw() {
    if (gameOver) return;
    const by = gameState.turn;
    if (!canOffer(offers, 'draw', by, gameState.ply).ok) return;
    const outcome = makeOffer(offers, 'draw', by, gameState.ply);
    setOffers(outcome.state);
    if (outcome.accepted) settleDraw();
  }

  function settleDraw() {
    const agreed = agreeDraw(gameState);
    setGameState(agreed);
    setStatus(describeResult(agreed.result!));
    setClock((c) => stopClock(c, Date.now()));
  }

  function respondToDraw(accept: boolean) {
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
          setStatus(describeResult(flagged.result!));
          return flagged;
        });
        setClock((c) => stopClock(c, current));
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [gameOver, reviewOnly, control.unlimited, clock]);

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

    const captorEl = container.querySelector(`[data-square="${anim.move.to}"]`);
    const { dx, dy } = slideOffsetPx(anim.move.from, anim.move.to, squarePx, orientation);
    const duration = anim.motion ? MOTION_MS.capture : MOTION_MS.slide;
    captorEl?.animate(captorKeyframes(anim.motion, dx, dy), {
      duration,
      easing: anim.motion === 'crush' ? 'cubic-bezier(.3,1.6,.4,1)' : 'ease-out',
    });

    let overlay: HTMLDivElement | null = null;
    const captured = anim.move.captured;
    // Neutrals never trigger this in Original (M3's only variant, spec 5), and
    // renderPieceSample only knows the yours/opponent side treatment, not a
    // neutral's dashed ring — so a neutral capture skips the overlay rather
    // than drawing it wrong. M5 (Neutrals in the UI) owns fixing that.
    // (Narrowing `captured.owner` directly, rather than through an
    // intermediate alias, is what lets TS carry "not neutral" through to
    // `Record<Side, string>` below.)
    if (anim.motion && captured && captured.owner !== 'neutral') {
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
        color: view.sideColors[captured.owner],
        // The overlay sits exactly over the real square, so painting a
        // knockout mark in the theme's actual square colour reads as
        // seamless against what's already underneath it.
        squareColor: THEMES[theme].square,
        isOpponent: captured.owner !== view.viewerSide,
      });
      container.appendChild(overlay);
      const victimAnim = overlay.animate(victimKeyframes(anim.motion), { duration, fill: 'forwards' });
      victimAnim.onfinish = () => overlay?.remove();
    }

    const timer = window.setTimeout(() => setAnim(null), duration + 50);
    return () => {
      window.clearTimeout(timer);
      overlay?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim]);

  const drawOfferPending = offers.pending?.kind === 'draw' ? offers.pending : null;
  const opponentSide = other(humanSide);

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
    <div className="game" style={{ '--board-px': `${boardPx}px` } as React.CSSProperties}>
      <button className="back" onClick={onExit} type="button">
        ← Home
      </button>

      <Panel
        side={opponentSide}
        place="opponent"
        counts={counts[opponentSide]}
        remainingMs={reviewOnly ? null : remainingAt(clock, opponentSide, now)}
        urgency={urgencyOf(clock, opponentSide, now)}
        running={clock.running === opponentSide}
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
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      <Panel
        side={humanSide}
        place="you"
        counts={counts[humanSide]}
        remainingMs={reviewOnly ? null : remainingAt(clock, humanSide, now)}
        urgency={urgencyOf(clock, humanSide, now)}
        running={clock.running === humanSide}
        onGiveTime={
          canGive(GIFT_POLICIES[mode], giftFrom(humanSide), humanSide).ok
            ? () => giveTimeTo(humanSide)
            : null
        }
      />

      <p className="status" aria-live="polite">
        {thinking ? 'Computer is thinking…' : status}
      </p>

      {drawOfferPending && !gameOver && (
        <div className="offer-banner">
          <p>{drawOfferPending.by === 'blue' ? 'Blue' : 'Red'} offers a draw.</p>
          <button type="button" onClick={() => respondToDraw(true)}>
            Accept
          </button>
          <button type="button" onClick={() => respondToDraw(false)}>
            Decline
          </button>
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
          <button type="button" onClick={undo} disabled={history.length === 0 || gameOver} title="Undo">
            ↺
          </button>
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
        </div>
      )}

      <MoveList
        moves={history}
        viewPly={viewPly}
        defaultOpen={wideEnoughForList}
        onPick={(ply) => setViewPly(ply)}
      />

      {gameState.result && summary && !reviewing && (
        <GameOver
          result={gameState.result}
          summary={summary}
          humanSide={computer ? humanSide : null}
          onRematch={() => rematch(false)}
          // Nothing to swap in pass-and-play: both players are on the one
          // device and neither of them "is" a side the board is drawn for.
          onSwapSides={computer ? () => rematch(true) : null}
          onReview={() => setViewPly(0)}
          onCopyLink={copyLink}
          copyNote={copyNote}
        />
      )}
    </div>
  );
}

interface PanelProps {
  side: Side;
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
  /** null when this mode/direction can't gift time (spec: e.g. self-gift, off outside vs-computer). */
  onGiveTime: (() => void) | null;
}

function Panel({ side, place, counts, remainingMs, urgency, running, onGiveTime }: PanelProps) {
  const name = side === 'blue' ? 'Blue' : 'Red';
  return (
    <div className={`panel panel--${place} panel--${side}`}>
      <span className="panel-name">
        {/* Colour alone never carries ownership (spec 10.3, CLAUDE.md), so the
            swatch is decoration beside a name that already says which side. */}
        <span className="panel-dot" aria-hidden="true" />
        {name}
      </span>
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
    </div>
  );
}
