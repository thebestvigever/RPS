// Spec 10.1's "Tutorial" screen and 10.9's six puzzles — M7's gate: "a new
// player finishes all six puzzles."
//
// Deliberately not a cut-down copy of Game.tsx's whole state machine. A
// puzzle position has one to three pieces a side and exactly one correct
// move (or, for puzzle 1, any of eight), so the interesting job here is
// judging an attempt against the puzzle's OWN answer, on top of the same
// legality Game.tsx already gets from the engine — not replaying its clock,
// offers, undo or review machinery, none of which a puzzle has any use for.
//
// Click/drag and keyboard share `resolveClick`/`resolveDestination`, same
// split as Game.tsx and for the same reason: one input method that quietly
// diverges from the other is how a tutorial ends up teaching the wrong thing
// to whichever one nobody tested.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EMPTY,
  TUTORIAL_PUZZLES,
  applyMove,
  decodePiece,
  distance,
  fromFen,
  getVariant,
  legalMoves,
  moveToText,
  parseMove,
  toFen,
} from '@sps/engine';
import type { GameState, Move, Square } from '@sps/engine';
import { illegalCaptureReason, renderBoard } from '@sps/board';
import type { Orientation } from '@sps/board';
import { clampSquare, squareAt } from './board-geometry.js';
import { defaultAppearance } from './Board.js';
import { describeSquare } from './describe-square.js';
import { loadSettings, loadTutorialProgress, saveTutorialProgress } from './storage.js';
import { playCapture, playChime, playIllegal, playTick } from './sound.js';
import './game.css'; // reuses .board-wrap, .shake and .bar as-is (see header note)
import './tutorial.css';

export interface TutorialProps {
  onExit: () => void;
}

/** Smaller than Game's 640px ceiling on purpose: every puzzle position has a
 * handful of pieces, and a smaller board keeps this screen one column with
 * no rail, matching how little chrome a puzzle actually needs around it. */
const MAX_BOARD_PX = 420;
const MIN_BOARD_PX = 240;

function useTutorialBoardPx(): number {
  const measure = useCallback(
    () => (typeof window === 'undefined' ? 360 : Math.max(MIN_BOARD_PX, Math.min(window.innerWidth - 32, MAX_BOARD_PX))),
    [],
  );
  const [px, setPx] = useState(measure);
  useEffect(() => {
    const onResize = () => setPx(measure());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);
  return px;
}

const ORIENTATION: Orientation = 'blue'; // every puzzle fen is written from Blue's side (spec 10.9)

export default function Tutorial({ onExit }: TutorialProps) {
  const boardPx = useTutorialBoardPx();
  const view = useMemo(defaultAppearance, []);
  const [soundOn] = useState(() => loadSettings().sound);

  const [puzzleIndex, setPuzzleIndex] = useState(0);
  const puzzle = TUTORIAL_PUZZLES[puzzleIndex]!;
  const variant = useMemo(() => getVariant(puzzle.variant), [puzzle.variant]);

  const [gameState, setGameState] = useState<GameState>(() => fromFen(puzzle.fen, variant));
  /** Index into `puzzle.line` (multi-ply puzzle 6); 0 for every single-move puzzle. */
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<Square | null>(null);
  const [focus, setFocus] = useState<Square>(0);
  const [keyboardCursor, setKeyboardCursor] = useState(false);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [status, setStatus] = useState(puzzle.note ?? 'Find the move.');
  const [cellText, setCellText] = useState('');
  const [solved, setSolved] = useState<number[]>(() => loadTutorialProgress());

  const containerRef = useRef<HTMLDivElement>(null);
  const dragOriginRef = useRef<Square | null>(null);
  const replyTimerRef = useRef<number | null>(null);

  // A fresh puzzle is a fresh position — nothing here carries over from the
  // last one, including a reply that hadn't fired yet if the player clicked
  // away mid-line.
  useEffect(() => {
    if (replyTimerRef.current !== null) {
      window.clearTimeout(replyTimerRef.current);
      replyTimerRef.current = null;
    }
    setGameState(fromFen(puzzle.fen, variant));
    setStep(0);
    setSelected(null);
    setLastMove(null);
    setStatus(puzzle.note ?? 'Find the move.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzleIndex]);

  useEffect(
    () => () => {
      if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current);
    },
    [],
  );

  const legal = useMemo(() => legalMoves(gameState), [gameState]);
  const isPlayerTurn = gameState.turn === 'blue' && gameState.result == null;
  const isSelectable = useCallback((square: Square) => isPlayerTurn && legal.some((m) => m.from === square), [isPlayerTurn, legal]);

  const selection = useMemo(() => {
    if (selected == null) return null;
    return {
      square: selected,
      destinations: legal.filter((m) => m.from === selected).map((m) => ({ square: m.to, capture: m.captured != null })),
    };
  }, [selected, legal]);

  const fen = useMemo(() => toFen(gameState), [gameState]);
  const svg = useMemo(
    () =>
      renderBoard({
        fen,
        variant,
        boardPx,
        theme: 'field-notes',
        family: 'cut-stone',
        appearance: view,
        orientation: ORIENTATION,
        lastMove,
        selection,
        focusSquare: keyboardCursor ? focus : null,
      }),
    [fen, variant, boardPx, view, lastMove, selection, focus, keyboardCursor],
  );

  useEffect(() => {
    if (!keyboardCursor) return;
    setCellText(describeSquare(gameState, focus));
  }, [focus, keyboardCursor, gameState]);

  function shakeSquare(square: Square) {
    const el = containerRef.current?.querySelector(`[data-square="${square}"]`);
    if (!el) return;
    el.classList.remove('shake');
    void (el as HTMLElement).offsetWidth; // restart the animation on a second wrong attempt at the same square
    el.classList.add('shake');
  }

  function markSolved() {
    setSolved((prev) => {
      if (prev.includes(puzzle.n)) return prev;
      const next = [...prev, puzzle.n];
      saveTutorialProgress(next);
      return next;
    });
  }

  /** What text the puzzle wants at this step — null means "any legal move is correct" (puzzle 1 only). */
  function expectedText(atStep: number): string | null {
    if (puzzle.line) return puzzle.line[atStep] ?? null;
    return atStep === 0 ? puzzle.solution : null;
  }

  function applyAccepted(move: Move) {
    const applied = applyMove(gameState, move);
    setGameState(applied.state);
    setLastMove({ from: move.from, to: move.to });
    setSelected(null);
    setFocus(move.to);
    if (soundOn) (move.captured ? playCapture : playTick)();

    const lineLength = puzzle.line?.length ?? 1;
    const newStep = step + 1;
    setStep(newStep);

    if (newStep >= lineLength) {
      setStatus(puzzle.line ? "Solved — you kept the lead all the way in." : 'Solved!');
      if (soundOn) playChime();
      markSolved();
      return;
    }

    // A multi-ply puzzle's odd steps are the SCRIPTED reply (spec 10.9's own
    // line), not a second thing to solve — it plays itself, on a short delay
    // so it reads as a reply rather than as the board doing something on its
    // own for no reason.
    setStatus('Correct. Watch the reply…');
    const replyText = puzzle.line![newStep]!;
    replyTimerRef.current = window.setTimeout(() => {
      const replyMove = parseMove(applied.state, replyText);
      const afterReply = applyMove(applied.state, replyMove);
      setGameState(afterReply.state);
      setLastMove({ from: replyMove.from, to: replyMove.to });
      setStep(newStep + 1);
      setStatus('Your move.');
      if (soundOn) (replyMove.captured ? playCapture : playTick)();
      replyTimerRef.current = null;
    }, 700);
  }

  function attemptMove(move: Move) {
    const text = moveToText(gameState, move);
    const expected = expectedText(step);
    if (expected !== null && text !== expected) {
      setStatus(puzzle.note ? `Not quite — ${puzzle.note}` : 'Not quite — try again.');
      if (soundOn) playIllegal();
      shakeSquare(move.to);
      setSelected(null);
      return;
    }
    applyAccepted(move);
  }

  const resolveDestination = useCallback(
    (from: Square, to: Square) => {
      const legalHere = legal.find((m) => m.from === from && m.to === to);
      if (legalHere) {
        attemptMove(legalHere);
        return;
      }
      if (isSelectable(to)) {
        setSelected(to);
        return;
      }
      const fromPiece = decodePiece(gameState.board[from]!);
      const toCode = gameState.board[to]!;
      if (fromPiece && toCode !== EMPTY && distance(from, to) === 1) {
        const toPiece = decodePiece(toCode)!;
        setStatus(illegalCaptureReason(fromPiece.type, toPiece.type));
        if (soundOn) playIllegal();
        shakeSquare(to);
        return;
      }
      setSelected(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [legal, isSelectable, gameState.board, step, puzzleIndex, soundOn],
  );

  const resolveClick = useCallback(
    (square: Square) => {
      if (!isPlayerTurn) return;
      if (selected == null) {
        if (isSelectable(square)) setSelected(square);
        return;
      }
      if (square === selected) {
        setSelected(null);
        return;
      }
      resolveDestination(selected, square);
    },
    [isPlayerTurn, selected, isSelectable, resolveDestination],
  );

  const rectFor = useCallback(() => {
    const node = containerRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { left: rect.left, top: rect.top, size: boardPx };
  }, [boardPx]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const rect = rectFor();
      if (!rect) return;
      const square = squareAt(rect, event.clientX, event.clientY, ORIENTATION);
      if (square != null) dragOriginRef.current = square;
    },
    [rectFor],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const origin = dragOriginRef.current;
      dragOriginRef.current = null;
      if (origin == null) return;
      const rect = rectFor();
      if (!rect) return;
      const square = squareAt(rect, event.clientX, event.clientY, ORIENTATION);
      if (square == null) return;
      if (square === origin) {
        resolveClick(square);
        return;
      }
      if (selected != null) resolveDestination(selected, square);
      else if (isSelectable(origin)) resolveDestination(origin, square);
    },
    [rectFor, resolveClick, resolveDestination, selected, isSelectable],
  );

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
        setKeyboardCursor(true);
        setFocus((f) => clampSquare(f, delta[0], delta[1], ORIENTATION));
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        resolveClick(focus);
        return;
      }
      if (event.key === 'Escape') setSelected(null);
    },
    [focus, resolveClick],
  );

  const allSolved = solved.length >= TUTORIAL_PUZZLES.length;

  return (
    <div className="tutorial">
      <button className="back" onClick={onExit} type="button">
        ← Home
      </button>

      <h1 className="tutorial-title">Tutorial</h1>
      <p className="tutorial-progress">
        Puzzle {puzzle.n} of {TUTORIAL_PUZZLES.length} — {puzzle.teaches}
      </p>

      <div
        ref={containerRef}
        className="board-wrap"
        style={{ width: boardPx, height: boardPx }}
        tabIndex={0}
        role="group"
        aria-label={`${variant.name} puzzle board. Use arrow keys to move the cursor, Enter to select or move.`}
        aria-describedby="tutorial-cell"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
        onFocus={(event) => {
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

      <p className="status" aria-live="polite">
        {status}
      </p>
      <p id="tutorial-cell" className="sr-only" aria-live="polite">
        {cellText}
      </p>

      <div className="tutorial-nav">
        <button
          type="button"
          onClick={() => setPuzzleIndex((i) => Math.max(0, i - 1))}
          disabled={puzzleIndex === 0}
        >
          ‹ Previous
        </button>
        <div className="tutorial-dots" role="group" aria-label="Jump to puzzle">
          {TUTORIAL_PUZZLES.map((p, i) => (
            <button
              key={p.n}
              type="button"
              className={`tutorial-dot${i === puzzleIndex ? ' tutorial-dot--on' : ''}${solved.includes(p.n) ? ' tutorial-dot--solved' : ''}`}
              onClick={() => setPuzzleIndex(i)}
              aria-current={i === puzzleIndex}
              aria-label={`Puzzle ${p.n}${solved.includes(p.n) ? ', solved' : ''}`}
            >
              {solved.includes(p.n) ? '✓' : p.n}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPuzzleIndex((i) => Math.min(TUTORIAL_PUZZLES.length - 1, i + 1))}
          disabled={puzzleIndex === TUTORIAL_PUZZLES.length - 1}
        >
          Next ›
        </button>
      </div>

      {allSolved && (
        <div className="tutorial-done">
          <p>All six solved — you know the rules that matter.</p>
          <button className="play" type="button" onClick={onExit}>
            Play a game
          </button>
        </div>
      )}
    </div>
  );
}
