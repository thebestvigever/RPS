// Search — spec 9.1.
//
// Negamax with alpha-beta pruning. Quiescence search at the leaves: captures
// and moves that reach the goal, up to 4 extra plies, with a stand-pat score —
// PLUS, when the side to move has a piece attacked with no defender
// (docs/engine/02-EVALUATION.md's "hanging"), the moves that walk it to safety.
// Move ordering: captures first, then moves that bring the moving piece closer
// to its goal, then the rest, with ties broken by the seeded generator.
//
// The extra case is the analogue of "no stand-pat while in check" (chess): a
// hanging piece means captures alone would never find the move that actually
// fixes the position, and the static score alone would just report the loss as
// if it were unavoidable. See docs/engine/03-SEARCH.md §5 and
// docs/engine/01-DIAGNOSIS.md for the measured cost of not doing this — Hard
// left a piece hanging on 32.7% of its moves.
//
// This walks the board with make/unmake on one mutable Int8Array rather than
// calling `applyMove`, which allocates a board and a Map per node and re-checks
// sealing four times. Spec 7.2 sanctions exactly that for search. Move
// generation, threat detection and sealing still come from the engine, so
// there is only ever one implementation of the rules.

import {
  EMPTY,
  SQUARE_COUNT,
  dangerAfter,
  decodePiece,
  defendersOf,
  isGoalSquare,
  legalMoves,
  other,
  threatenedBy,
} from '@sps/engine';
import type { GameState, Move, Side, VariantConfig } from '@sps/engine';
import { LEVELS, QUIESCENCE_MAX_PLIES } from './levels.js';
import type { Level } from './levels.js';
import { evaluate, terminalScore } from './evaluate.js';
import { distanceTables } from './tables.js';
import type { DistanceTables } from './tables.js';
import { mulberry32, randomInt, stableJitter } from './random.js';
import type { Random } from './random.js';

export interface SearchStats {
  depth: number;
  nodes: number;
  ms: number;
}

export interface SearchResult {
  move: Move;
  score: number;
  stats: SearchStats;
}

/** Thrown rather than returning a bogus move when there is nothing to play. */
export class NoMovesError extends Error {
  constructor() {
    super('no legal moves in this position');
    this.name = 'NoMovesError';
  }
}

interface Context {
  /** Reused across every node; `board` is mutated in place and `turn` flipped. */
  scratch: GameState;
  variant: VariantConfig;
  tables: DistanceTables;
  rng: Random;
  seed: number;
  keepTerms: boolean;
  rootPly: number;
  maxPlies: number;
  nodes: number;
  deadline: number;
  aborted: boolean;
}

function make(board: Int8Array, move: Move): number {
  const captured = board[move.to]!;
  board[move.to] = board[move.from]!;
  board[move.from] = EMPTY;
  return captured;
}

function unmake(board: Int8Array, move: Move, captured: number): void {
  board[move.from] = board[move.to]!;
  board[move.to] = captured;
}

/** Does this move end the game by reaching the goal? A neutral never can (4.2.5). */
function winsNow(context: Context, move: Move, mover: Side): boolean {
  return move.piece.owner !== 'neutral' && isGoalSquare(context.variant, mover, move.to);
}

function orderMoves(context: Context, moves: Move[], mover: Side): Move[] {
  const toGoal = context.tables.toGoal[mover];
  const keyed = moves.map((move) => {
    let key: number;
    if (winsNow(context, move, mover)) {
      key = 10_000;
    } else if (move.captured) {
      key = 1_000;
    } else if (move.piece.owner === 'neutral') {
      key = 0;
    } else {
      // How much closer to its goal this piece gets.
      key = 100 + (toGoal[move.from]! - toGoal[move.to]!) * 10;
    }
    // Break ties deterministically from the seed and the move itself, so equal
    // moves don't always come out in board order and the root generator stays
    // untouched by how much of the tree the search visits.
    return { move, key: key + stableJitter(context.seed, move.from, move.to) };
  });

  keyed.sort((a, b) => b.key - a.key);
  return keyed.map((entry) => entry.move);
}

function outOfTime(context: Context): boolean {
  if (context.aborted) return true;
  if (context.deadline === Infinity) return false;
  // Date.now() is not free; check it every so often.
  if ((context.nodes & 1023) !== 0) return false;
  if (Date.now() >= context.deadline) {
    context.aborted = true;
    return true;
  }
  return false;
}

/**
 * Squares holding one of `mover`'s own pieces that is attacked and has no
 * defender — the analogue of "in check" for `quiesce` below (03-SEARCH.md
 * §5). A permanent piece never appears here: `threatenedBy` is already empty
 * for it, since permanence means no predator exists anywhere on the board.
 */
function hangingSquaresOf(state: GameState, mover: Side): number[] {
  const { board } = state;
  const hanging: number[] = [];

  for (let square = 0; square < SQUARE_COUNT; square++) {
    const code = board[square]!;
    if (code === EMPTY) continue;
    if (decodePiece(code)!.owner !== mover) continue;
    if (threatenedBy(state, square).length === 0) continue;
    if (defendersOf(state, square).length > 0) continue;
    hanging.push(square);
  }

  return hanging;
}

/**
 * Quiet moves that walk a hanging piece to a square nothing attacks — the
 * escapes half of the "in check" analogy. Captures are excluded; they are
 * already in `quiesce`'s own tactical list.
 */
function evasions(context: Context, moves: Move[], hanging: readonly number[]): Move[] {
  if (hanging.length === 0) return [];
  const { scratch } = context;
  const out: Move[] = [];

  for (const move of moves) {
    if (move.captured || !hanging.includes(move.from)) continue;
    if (!dangerAfter(scratch, move)) out.push(move);
  }

  return out;
}

/**
 * Captures and winning moves, so the search doesn't stop on a position where
 * a piece is hanging — plus, when the mover already has a hanging piece, the
 * moves that walk it to safety (see the header comment). `moves` is passed in
 * when the caller has already generated it, which it has whenever it needed
 * the no-moves check.
 */
function quiesce(
  context: Context,
  alpha: number,
  beta: number,
  depthFromRoot: number,
  extra: number,
  generated?: Move[],
): number {
  context.nodes++;
  const { scratch } = context;
  const mover = scratch.turn;
  const moves = generated ?? legalMoves(scratch);

  if (moves.length === 0) return terminalScore('loss', depthFromRoot);

  const standPat = evaluate(scratch, context.keepTerms);
  if (extra >= QUIESCENCE_MAX_PLIES || outOfTime(context)) return standPat;

  const hanging = hangingSquaresOf(scratch, mover);

  // Stand-pat assumes the mover could do nothing further and be no worse off
  // than the static score. That assumption is unsound exactly the way it is
  // unsound "in check" in chess: there may be an escape worth far more than
  // this static estimate, and captures alone would never find it. So a
  // hanging piece disables the early cutoff below — but the static score,
  // now that it prices the hang (docs/engine/02-EVALUATION.md), still stands
  // as the fallback if no escape or capture helps.
  if (hanging.length === 0 && standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;

  // Only captures and winning moves are worth looking at here, and there are
  // usually two or three of them. Ordering the whole move list first would
  // sort forty entries to explore two.
  const tactical: Move[] = [];
  for (const move of moves) {
    if (winsNow(context, move, mover)) return terminalScore('win', depthFromRoot + 1);
    if (move.captured) tactical.push(move);
  }
  if (hanging.length > 0) tactical.push(...evasions(context, moves, hanging));

  for (const move of orderMoves(context, tactical, mover)) {
    const captured = make(scratch.board, move);
    scratch.turn = other(mover);
    const score = -quiesce(context, -beta, -alpha, depthFromRoot + 1, extra + 1);
    scratch.turn = mover;
    unmake(scratch.board, move, captured);

    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }

  return alpha;
}

function negamax(
  context: Context,
  depth: number,
  alpha: number,
  beta: number,
  depthFromRoot: number,
): number {
  context.nodes++;
  const { scratch } = context;
  const mover = scratch.turn;
  const moves = legalMoves(scratch);

  // The side to move with no legal move loses (2.8).
  if (moves.length === 0) return terminalScore('loss', depthFromRoot);

  // The move limit is a draw (2.9). Repetition is not tracked inside the search:
  // the reference engine didn't either, and a shallow search cannot see one.
  if (context.rootPly + depthFromRoot >= context.maxPlies) return 0;

  if (depth <= 0) return quiesce(context, alpha, beta, depthFromRoot, 0, moves);

  let best = -Infinity;

  for (const move of orderMoves(context, moves, mover)) {
    let score: number;

    if (winsNow(context, move, mover)) {
      score = terminalScore('win', depthFromRoot + 1);
    } else {
      const captured = make(scratch.board, move);
      scratch.turn = other(mover);
      score = -negamax(context, depth - 1, -beta, -alpha, depthFromRoot + 1);
      scratch.turn = mover;
      unmake(scratch.board, move, captured);
    }

    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
    if (outOfTime(context)) break;
  }

  return best;
}

/**
 * Scores the root moves, exactly where it matters.
 *
 * `jitter` only ever picks among moves within a few points of the best, so only
 * those need exact scores. Each move is therefore searched with alpha set just
 * below "best so far minus jitter": anything that cannot become a candidate
 * fails low and returns a bound, which is all it is worth. Searching every root
 * move with a full window instead — which is the obvious way to keep the scores
 * honest — turns alpha-beta off at the root and costs about twenty times the
 * nodes.
 */
function scoreRootMoves(
  context: Context,
  moves: Move[],
  depth: number,
  jitter: number,
): number[] {
  const { scratch } = context;
  const mover = scratch.turn;
  const scores = new Array<number>(moves.length);
  let best = -Infinity;

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i]!;
    let score: number;

    if (winsNow(context, move, mover)) {
      score = terminalScore('win', 1);
    } else {
      // Below this, a move cannot end up within `jitter` of the best.
      const alpha = best === -Infinity ? -Infinity : best - jitter - 1;
      const captured = make(scratch.board, move);
      scratch.turn = other(mover);
      score = -negamax(context, depth - 1, -Infinity, -alpha, 1);
      scratch.turn = mover;
      unmake(scratch.board, move, captured);
    }

    scores[i] = score;
    if (score > best) best = score;
  }

  return scores;
}

function createContext(
  state: GameState,
  options: { keepTerms: boolean; seed: number; deadline: number },
): Context {
  return {
    // The board is copied once; make/unmake works on this copy, so the caller's
    // state is never touched.
    scratch: {
      variant: state.variant,
      board: Int8Array.from(state.board),
      turn: state.turn,
      ply: state.ply,
      positionCounts: new Map(),
      result: null,
    },
    variant: state.variant,
    tables: distanceTables(state.variant),
    rng: mulberry32(options.seed),
    seed: options.seed,
    keepTerms: options.keepTerms,
    rootPly: state.ply,
    maxPlies: state.variant.draw.maxPlies,
    nodes: 0,
    deadline: options.deadline,
    aborted: false,
  };
}

export interface RootMoveScore {
  move: Move;
  score: number;
}

/**
 * Every root move with its score, strongest first.
 *
 * Exposed because the root window is an optimisation with a real invariant
 * behind it — pruning must not change which move comes out on top — and because
 * the Hint button (9.5) and post-game analysis (13.5) want the same numbers.
 *
 * A `jitter` of Infinity disables the root window and scores every move with a
 * full window, which is the slow, obviously-correct version to compare against.
 */
export function analyseRoot(
  state: GameState,
  options: { depth: number; keepTerms: boolean; seed: number; jitter: number },
): RootMoveScore[] {
  const unordered = legalMoves(state);
  if (unordered.length === 0) throw new NoMovesError();

  const context = createContext(state, { ...options, deadline: Infinity });
  const moves = orderMoves(context, unordered, state.turn);
  const scores = scoreRootMoves(context, moves, options.depth, options.jitter);

  return moves
    .map((move, index) => ({ move, score: scores[index]! }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Picks a move for `level`. Deterministic given the position, level and seed, so
 * any computer game replays exactly (7.8).
 */
export function chooseMove(state: GameState, level: Level, seed: number): SearchResult {
  const unordered = legalMoves(state);
  if (unordered.length === 0) throw new NoMovesError();

  const config = LEVELS[level];
  const started = Date.now();

  const context = createContext(state, {
    keepTerms: config.keepTerms,
    seed,
    deadline: config.depth === 'iterative' ? started + config.budgetMs : Infinity,
  });

  // A good first move makes every later one cheaper to reject.
  const moves = orderMoves(context, unordered, state.turn);

  let scores: number[];
  let reached: number;

  if (config.depth === 'iterative') {
    // Iterative deepening: keep the last depth that finished inside the budget.
    // The shallowest search always runs to completion — the AI must return a
    // move even when the budget is already spent.
    reached = config.minDepth;
    scores = scoreRootMoves(context, moves, reached, config.jitter);

    for (let depth = reached + 1; !context.aborted; depth++) {
      if (Date.now() >= context.deadline) break;
      const attempt = scoreRootMoves(context, moves, depth, config.jitter);
      if (context.aborted) break;
      scores = attempt;
      reached = depth;
    }
  } else {
    reached = config.depth;
    scores = scoreRootMoves(context, moves, reached, config.jitter);
  }

  const best = Math.max(...scores);
  // Pick uniformly among moves within `jitter` points of the best. Without this
  // the AI plays the identical game every time (9.1).
  const candidates = moves.filter((_, index) => scores[index]! >= best - config.jitter);
  const move = candidates[randomInt(context.rng, candidates.length)]!;

  return {
    move,
    score: scores[moves.indexOf(move)]!,
    stats: { depth: reached, nodes: context.nodes, ms: Date.now() - started },
  };
}
