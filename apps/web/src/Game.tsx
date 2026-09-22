// Pass-and-play — spec 10.1 "Game" screen, M3b (docs/VISUAL_SYSTEM.md 8).
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
// a package with no DOM, so it lives here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMove,
  createGame,
  decodePiece,
  distance,
  legalMoves,
  moveToText,
  replay,
  resign as engineResign,
  toFen,
  typeCounts,
} from '@sps/engine';
import type { GameState, Move, PieceType, Side, Square, VariantConfig } from '@sps/engine';
import {
  MOTION_MS,
  THEMES,
  captureMotion,
  illegalCaptureReason,
  pieceTypeName,
  renderBoard,
  renderPieceSample,
} from '@sps/board';
import type { Appearance, FamilyId, MotionKind, ThemeId } from '@sps/board';
import { clampSquare, slideOffsetPx, squareAt } from './board-geometry.js';
import { describeResult, describeTurn, whoseTurn } from './announce.js';
import './game.css';

export interface GameProps {
  variant: VariantConfig;
  theme: ThemeId;
  family: FamilyId;
  appearance: Appearance;
  onExit: () => void;
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

export default function Game({ variant, theme, family, appearance, onExit }: GameProps) {
  const boardPx = useBoardPx();
  const squarePx = boardPx / 9;
  const reducedMotion = usePrefersReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const dragOriginRef = useRef<Square | null>(null);

  const [history, setHistory] = useState<string[]>([]);
  const [gameState, setGameState] = useState<GameState>(() => createGame(variant));
  const [selected, setSelected] = useState<Square | null>(null);
  const [focus, setFocus] = useState<Square>(0);
  const [status, setStatus] = useState<string>(() => whoseTurn(gameState.turn));
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [anim, setAnim] = useState<PendingAnim | null>(null);

  const legal = useMemo(() => legalMoves(gameState), [gameState]);
  const fen = useMemo(() => toFen(gameState), [gameState]);
  const counts = useMemo(() => typeCounts(gameState), [gameState]);
  const gameOver = gameState.result != null;

  const isSelectable = useCallback((square: Square) => legal.some((m) => m.from === square), [legal]);

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
        appearance,
        lastMove,
        selection,
        focusSquare: focus,
      }),
    [fen, variant, boardPx, theme, family, appearance, lastMove, selection, focus],
  );

  const doMove = useCallback(
    (move: Move) => {
      const applied = applyMove(gameState, move);
      const text = moveToText(gameState, move);
      setHistory((h) => [...h, text]);
      setGameState(applied.state);
      setLastMove({ from: move.from, to: move.to });
      setSelected(null);
      setFocus(move.to);
      setStatus(describeTurn(applied.events));
      setAnim({ move, motion: move.captured ? captureMotion(move.piece.type) : null });
    },
    [gameState],
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
      if (gameOver) return;
      const rect = rectFor();
      if (!rect) return;
      const square = squareAt(rect, event.clientX, event.clientY);
      if (square == null) return;
      dragOriginRef.current = square;
    },
    [gameOver, rectFor],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const origin = dragOriginRef.current;
      dragOriginRef.current = null;
      if (gameOver || origin == null) return;
      const rect = rectFor();
      if (!rect) return;
      const square = squareAt(rect, event.clientX, event.clientY);
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
    [gameOver, rectFor, selected, isSelectable, resolveClick, resolveDestination],
  );

  // --- Keyboard: arrow keys move the cursor; Enter/Space is exactly a tap on
  // it (spec 10.4) — reusing resolveClick is what makes this a complete input
  // method rather than a second, easily-diverging implementation.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const arrows: Record<string, [number, number]> = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      };
      const delta = arrows[event.key];
      if (delta) {
        event.preventDefault();
        setFocus((f) => clampSquare(f, delta[0], delta[1]));
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
    [focus, resolveClick],
  );

  function undo() {
    if (history.length === 0 || gameOver) return;
    const nextHistory = history.slice(0, -1);
    const replayed = replay(variant, nextHistory);
    setHistory(nextHistory);
    setGameState(replayed.state);
    setSelected(null);
    setAnim(null);
    const lastEvents = replayed.events.at(-1);
    const moveEvent = lastEvents?.find((e): e is Extract<typeof e, { type: 'move' }> => e.type === 'move');
    setLastMove(moveEvent ? { from: moveEvent.from, to: moveEvent.to } : null);
    setStatus(whoseTurn(replayed.state.turn));
  }

  function doResign() {
    if (gameOver) return;
    const resigned = engineResign(gameState, gameState.turn);
    setGameState(resigned);
    setSelected(null);
    setStatus(describeResult(resigned.result!));
  }

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
    const { dx, dy } = slideOffsetPx(anim.move.from, anim.move.to, squarePx);
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
      const col = square % 9;
      const row = Math.floor(square / 9);
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
        color: appearance.sideColors[captured.owner],
        // The overlay sits exactly over the real square, so painting a
        // knockout mark in the theme's actual square colour reads as
        // seamless against what's already underneath it.
        squareColor: THEMES[theme].square,
        isOpponent: captured.owner !== appearance.viewerSide,
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

  return (
    <div className="game">
      <button className="back" onClick={onExit} type="button">
        ← Home
      </button>

      <Panel side="red" counts={counts.red} />

      <div
        ref={containerRef}
        className="board-wrap"
        style={{ width: boardPx, height: boardPx }}
        tabIndex={0}
        role="group"
        aria-label={`${variant.name} board. Use arrow keys to move the cursor, Enter to select or move.`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      <Panel side="blue" counts={counts.blue} />

      <p className="status" aria-live="polite">
        {status}
      </p>

      <div className="bar">
        <button type="button" onClick={undo} disabled={history.length === 0 || gameOver} title="Undo">
          ↺
        </button>
        <button type="button" onClick={doResign} disabled={gameOver} className="resign" title="Resign">
          ⚐
        </button>
      </div>

      {gameState.result && (
        <div className="game-over">
          <p>{describeResult(gameState.result)}</p>
        </div>
      )}
    </div>
  );
}

function Panel({ side, counts }: { side: Side; counts: Record<PieceType, number> }) {
  return (
    <div className={`panel panel--${side}`}>
      <span className="panel-name">{side === 'blue' ? 'Blue' : 'Red'}</span>
      <span className="panel-counts">
        {(['rock', 'paper', 'scissors'] as const).map((type) => (
          <span key={type} className={`count${counts[type] === 0 ? ' count--out' : counts[type] === 1 ? ' count--last' : ''}`}>
            {pieceTypeName(type)[0]}
            {counts[type]}
          </span>
        ))}
      </span>
    </div>
  );
}
