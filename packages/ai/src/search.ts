// Search — spec 9.1, extended by docs/engine/03-SEARCH.md §1-4 and §6.
//
// Negamax with alpha-beta pruning, a transposition table, killer/history move
// ordering and Principal Variation Search, fail-soft throughout. Quiescence
// search at the leaves: captures and moves that reach the goal, up to 4 extra
// plies, with a stand-pat score — PLUS, when the side to move has a piece
// attacked with no defender (docs/engine/02-EVALUATION.md's "hanging"), the
// moves that walk it to safety.
//
// Move ordering (03-SEARCH.md §6, folded into §3's killers/history): the hash
// move, then a win, then captures ranked by what they do to the losing side's
// piece count (wiping out a type outranks merely reducing it, which outranks
// an ordinary capture — 02-EVALUATION.md Term 3's exchangeOn() would refine the
// "ordinary capture" tier further and isn't built yet), then escapes from a
// hanging piece, then killers, then quiet moves ranked by history and by
// progress toward the goal, with ties broken by the seeded generator.
//
// The hanging case is the analogue of "no stand-pat while in check" (chess): a
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
  countsOf,
  dangerAfter,
  decodePiece,
  defendersOf,
  insertIntoPieceLists,
  isGoalSquare,
  legalMoves,
  movesFromPieceLists,
  other,
  pieceListsOf,
  relocateInPieceLists,
  removeFromPieceLists,
  threatenedBy,
} from '@sps/engine';
import type { Counts, GameState, Move, PieceLists, Side, VariantConfig } from '@sps/engine';
import { QUIESCENCE_MAX_PLIES, resolveLevelConfig } from './levels.js';
import type { Level, LevelConfig } from './levels.js';
import { WIN_SCORE, evaluate, terminalScore } from './evaluate.js';
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

// --- Zobrist hashing (03-SEARCH.md §2) --------------------------------------
//
// Two Int32Array halves rather than BigInt: BigInt XOR allocates on every
// operation and would cost more than the transposition table saves. Board
// codes run 0 (empty, never looked up) through 11 (owner*4 + type + 1, spec
// 7.2); the table is sized to the full range so a code is always a direct
// index, no remapping per lookup.
const ZOBRIST_CODES = 12;

function buildZobristHalf(seed: number): Int32Array {
  const rng = mulberry32(seed);
  const table = new Int32Array(ZOBRIST_CODES * SQUARE_COUNT);
  for (let i = 0; i < table.length; i++) {
    table[i] = Math.floor(rng() * 4294967296) | 0;
  }
  return table;
}

const ZOBRIST_PIECE_HI = buildZobristHalf(0x9e3779b9);
const ZOBRIST_PIECE_LO = buildZobristHalf(0x85ebca6b);
const zobristSideRng = mulberry32(0xc2b2ae35);
const ZOBRIST_SIDE_HI = Math.floor(zobristSideRng() * 4294967296) | 0;
const ZOBRIST_SIDE_LO = Math.floor(zobristSideRng() * 4294967296) | 0;

function initialHash(board: Int8Array, turn: Side): { hi: number; lo: number } {
  let hi = 0;
  let lo = 0;
  for (let square = 0; square < SQUARE_COUNT; square++) {
    const code = board[square]!;
    if (code === EMPTY) continue;
    hi ^= ZOBRIST_PIECE_HI[code * SQUARE_COUNT + square]!;
    lo ^= ZOBRIST_PIECE_LO[code * SQUARE_COUNT + square]!;
  }
  if (turn === 'red') {
    hi ^= ZOBRIST_SIDE_HI;
    lo ^= ZOBRIST_SIDE_LO;
  }
  return { hi, lo };
}

// --- Transposition table (03-SEARCH.md §2) ----------------------------------
//
// Sized in the low megabytes, as the doc asks: this runs in a browser worker.
// Two buckets per slot, depth-preferred then always-replace, which is what
// most engines settle on. Scores for a win/loss are stored relative to the
// node that found them (mate-distance adjustment, §2's second pitfall) so a
// win-in-3 found at one depth doesn't get read back as a win-in-3 at another.
//
// Not consulted for the maxPlies draw score in `negamax` (§2's first pitfall,
// path dependence): that check returns before the table is touched at all, so
// a draw that only holds down one path into a position never gets cached and
// handed to a different path that reaches the same board with plies to spare.
// TT cutoffs are also refused at PV nodes (`pvNode` below) for the same reason
// the doc gives: only the move suggestion is trusted there, not the bound.
//
// Allocated fresh per `chooseMove`/`analyseRoot` call rather than reused across
// a whole game — the transpositions that matter most happen within one
// iterative-deepening search (move-order commutativity inside the tree just
// searched), which this already captures. Carrying it across moves needs a
// session object the worker owns and clears on cancel/undo (§2's memory note);
// that is worker wiring, not something `chooseMove`'s pure signature can do on
// its own, so it is left for when the worker is built.
const TT_INDEX_BITS = 16;
const TT_SLOTS = 1 << TT_INDEX_BITS;
const TT_MASK = TT_SLOTS - 1;
const TT_BUCKETS = 2;

const BOUND_NONE = 0;
const BOUND_EXACT = 1;
const BOUND_LOWER = 2;
const BOUND_UPPER = 3;

class TranspositionTable {
  private readonly keyHi = new Int32Array(TT_SLOTS * TT_BUCKETS);
  private readonly keyLo = new Int32Array(TT_SLOTS * TT_BUCKETS);
  private readonly depthByEntry = new Int8Array(TT_SLOTS * TT_BUCKETS);
  private readonly boundByEntry = new Uint8Array(TT_SLOTS * TT_BUCKETS);
  private readonly scoreByEntry = new Int32Array(TT_SLOTS * TT_BUCKETS);
  private readonly moveFromByEntry = new Int8Array(TT_SLOTS * TT_BUCKETS).fill(-1);
  private readonly moveToByEntry = new Int8Array(TT_SLOTS * TT_BUCKETS);

  private slotBase(hi: number, lo: number): number {
    return (((hi ^ lo) >>> 0) & TT_MASK) * TT_BUCKETS;
  }

  /** Index of the matching entry, or -1. */
  probe(hi: number, lo: number): number {
    const base = this.slotBase(hi, lo);
    for (let bucket = 0; bucket < TT_BUCKETS; bucket++) {
      const i = base + bucket;
      if (this.boundByEntry[i] !== BOUND_NONE && this.keyHi[i] === hi && this.keyLo[i] === lo) {
        return i;
      }
    }
    return -1;
  }

  store(
    hi: number,
    lo: number,
    depth: number,
    score: number,
    bound: number,
    moveFrom: number,
    moveTo: number,
  ): void {
    const preferred = this.slotBase(hi, lo);
    const isSamePosition = this.keyHi[preferred] === hi && this.keyLo[preferred] === lo;
    if (
      this.boundByEntry[preferred] === BOUND_NONE ||
      isSamePosition ||
      depth >= this.depthByEntry[preferred]!
    ) {
      this.write(preferred, hi, lo, depth, score, bound, moveFrom, moveTo);
      return;
    }
    this.write(preferred + 1, hi, lo, depth, score, bound, moveFrom, moveTo);
  }

  private write(
    i: number,
    hi: number,
    lo: number,
    depth: number,
    score: number,
    bound: number,
    moveFrom: number,
    moveTo: number,
  ): void {
    this.keyHi[i] = hi;
    this.keyLo[i] = lo;
    this.depthByEntry[i] = depth;
    this.scoreByEntry[i] = score;
    this.boundByEntry[i] = bound;
    this.moveFromByEntry[i] = moveFrom;
    this.moveToByEntry[i] = moveTo;
  }

  depthOf(i: number): number {
    return this.depthByEntry[i]!;
  }

  scoreOf(i: number): number {
    return this.scoreByEntry[i]!;
  }

  boundOf(i: number): number {
    return this.boundByEntry[i]!;
  }

  moveOf(i: number): number {
    const from = this.moveFromByEntry[i]!;
    if (from < 0) return -1;
    return from * SQUARE_COUNT + this.moveToByEntry[i]!;
  }
}

/** Scores at or beyond this are mate-distance scores and need the ply adjustment. */
const MATE_THRESHOLD = WIN_SCORE - 10_000;

/** Store relative to this node rather than the root (§2's mate-score pitfall). */
function toTTScore(score: number, depthFromRoot: number): number {
  if (score >= MATE_THRESHOLD) return score + depthFromRoot;
  if (score <= -MATE_THRESHOLD) return score - depthFromRoot;
  return score;
}

function fromTTScore(score: number, depthFromRoot: number): number {
  if (score >= MATE_THRESHOLD) return score - depthFromRoot;
  if (score <= -MATE_THRESHOLD) return score + depthFromRoot;
  return score;
}

// --- Killers and history (03-SEARCH.md §3) ----------------------------------

/** Ample: real search depth plus quiescence never gets close to this many plies. */
const MAX_KILLER_PLY = 64;

/** History-gravity clamp, so the table cannot saturate over a long game. */
const HISTORY_MAX = 8192;

function encodeMove(move: Move): number {
  return move.from * SQUARE_COUNT + move.to;
}

function historyIndex(side: Side, from: number, to: number): number {
  return (side === 'red' ? 1 : 0) * SQUARE_COUNT * SQUARE_COUNT + from * SQUARE_COUNT + to;
}

interface Context {
  /** Reused across every node; `board` is mutated in place and `turn` flipped. */
  scratch: GameState;
  /**
   * How many of each type each owner holds on `scratch.board` right now —
   * kept current by `make`/`unmake` instead of rescanning the board on every
   * node (docs/engine/04-SPEED.md §1). Passed straight into `evaluate` and
   * `isSealed`, which no longer scan for it themselves; §6's capture-tier
   * ordering below reads it too, for "does this capture wipe out a type."
   */
  counts: Counts;
  /**
   * Occupied squares per owner on `scratch.board` right now, kept current by
   * `make`/`unmake` alongside `counts` — so move generation below can walk
   * the mover's own pieces (about 7-10 in the midgame) instead of all 81
   * squares (docs/engine/04-SPEED.md §2).
   */
  lists: PieceLists;
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
  hashHi: number;
  hashLo: number;
  tt: TranspositionTable;
  /** Two slots per ply: `killers[ply*2]` and `killers[ply*2+1]`, newest first. */
  killers: Int32Array;
  /** `[side][from][to]`, scored by cutoff depth with gravity toward zero. */
  history: Int32Array;
}

function toggleSide(context: Context): void {
  context.hashHi ^= ZOBRIST_SIDE_HI;
  context.hashLo ^= ZOBRIST_SIDE_LO;
}

function make(context: Context, move: Move): number {
  const { board } = context.scratch;
  const { counts, lists } = context;
  const movingCode = board[move.from]!;
  const captured = board[move.to]!;

  context.hashHi ^= ZOBRIST_PIECE_HI[movingCode * SQUARE_COUNT + move.from]!;
  context.hashLo ^= ZOBRIST_PIECE_LO[movingCode * SQUARE_COUNT + move.from]!;
  if (captured !== EMPTY) {
    context.hashHi ^= ZOBRIST_PIECE_HI[captured * SQUARE_COUNT + move.to]!;
    context.hashLo ^= ZOBRIST_PIECE_LO[captured * SQUARE_COUNT + move.to]!;
  }
  context.hashHi ^= ZOBRIST_PIECE_HI[movingCode * SQUARE_COUNT + move.to]!;
  context.hashLo ^= ZOBRIST_PIECE_LO[movingCode * SQUARE_COUNT + move.to]!;

  board[move.to] = movingCode;
  board[move.from] = EMPTY;
  // Remove the capture from its list first — its slot still points at `to`,
  // which relocating the mover onto `to` is about to overwrite.
  if (captured !== EMPTY) {
    const piece = decodePiece(captured)!;
    counts[piece.owner][piece.type]--;
    removeFromPieceLists(lists, piece.owner, move.to);
  }
  relocateInPieceLists(lists, move.piece.owner, move.from, move.to);
  return captured;
}

function unmake(context: Context, move: Move, captured: number): void {
  const { board } = context.scratch;
  const { counts, lists } = context;
  const movingCode = board[move.to]!;
  board[move.from] = movingCode;
  board[move.to] = captured;
  relocateInPieceLists(lists, move.piece.owner, move.to, move.from);
  if (captured !== EMPTY) {
    const piece = decodePiece(captured)!;
    counts[piece.owner][piece.type]++;
    insertIntoPieceLists(lists, piece.owner, move.to);
  }

  // XOR is its own inverse: re-applying make's terms undoes them.
  context.hashHi ^= ZOBRIST_PIECE_HI[movingCode * SQUARE_COUNT + move.from]!;
  context.hashLo ^= ZOBRIST_PIECE_LO[movingCode * SQUARE_COUNT + move.from]!;
  if (captured !== EMPTY) {
    context.hashHi ^= ZOBRIST_PIECE_HI[captured * SQUARE_COUNT + move.to]!;
    context.hashLo ^= ZOBRIST_PIECE_LO[captured * SQUARE_COUNT + move.to]!;
  }
  context.hashHi ^= ZOBRIST_PIECE_HI[movingCode * SQUARE_COUNT + move.to]!;
  context.hashLo ^= ZOBRIST_PIECE_LO[movingCode * SQUARE_COUNT + move.to]!;
}

/** Does this move end the game by reaching the goal? A neutral never can (4.2.5). */
function winsNow(context: Context, move: Move, mover: Side): boolean {
  return move.piece.owner !== 'neutral' && isGoalSquare(context.variant, mover, move.to);
}

function recordKiller(context: Context, depthFromRoot: number, moveKey: number): void {
  if (depthFromRoot >= MAX_KILLER_PLY) return;
  const base = depthFromRoot * 2;
  if (context.killers[base] === moveKey) return;
  context.killers[base + 1] = context.killers[base]!;
  context.killers[base] = moveKey;
}

/** `good` cutoffs earn a bonus; quiet moves tried and passed over earn a matching penalty. */
function updateHistory(context: Context, side: Side, move: Move, depth: number, good: boolean): void {
  const idx = historyIndex(side, move.from, move.to);
  const delta = good ? depth * depth : -(depth * depth);
  const current = context.history[idx]!;
  context.history[idx] = current + delta - Math.trunc((current * Math.abs(delta)) / HISTORY_MAX);
}

/**
 * Squares holding one of `mover`'s own pieces that is attacked and has no
 * defender — the analogue of "in check" for `quiesce` below (03-SEARCH.md
 * §5). A permanent piece never appears here: `threatenedBy` is already empty
 * for it, since permanence means no predator exists anywhere on the board.
 *
 * Exported for tools built on the same definition (docs/engine/
 * 06-MEASUREMENT-AND-LEVELS.md part one's diagnosis metrics), not just the
 * search's own internal use.
 */
export function hangingSquaresOf(state: GameState, mover: Side): number[] {
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
 * Same squares as `hangingSquaresOf`, as a set, but walking `mover`'s piece
 * list instead of all 81 squares — the search runs this at every node
 * (docs/engine/04-SPEED.md §2). Order need not match `hangingSquaresOf`: every
 * caller here only ever tests membership or iterates without caring about it.
 */
function hangingSquaresFromList(state: GameState, mover: Side, lists: PieceLists): number[] {
  const squares = lists.squares[mover];
  const count = lists.count[mover];
  const hanging: number[] = [];

  for (let i = 0; i < count; i++) {
    const square = squares[i]!;
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

// Move-ordering tiers (03-SEARCH.md §3 and §6, highest first). exchangeOn()
// (02-EVALUATION.md Term 3) would split ordinary captures into good/bad and
// isn't built yet, so every capture that doesn't wipe out or nearly wipe out a
// type lands in one tier for now.
const TIER_WIN = 1_000_000_000;
const TIER_HASH_MOVE = 500_000_000;
const TIER_CAPTURE_EXTINCT = 100_000;
const TIER_CAPTURE_LAST_TWO = 90_000;
const TIER_CAPTURE_ORDINARY = 80_000;
const TIER_ESCAPE = 70_000;
const TIER_KILLER_0 = 60_100;
const TIER_KILLER_1 = 60_000;
const TIER_QUIET_BASE = 100;

function orderMoves(
  context: Context,
  moves: Move[],
  mover: Side,
  depthFromRoot: number,
  hashMoveKey: number,
  hanging: readonly number[],
): Move[] {
  const toGoal = context.tables.toGoal[mover];
  const killerBase = depthFromRoot < MAX_KILLER_PLY ? depthFromRoot * 2 : -1;
  const killer0 = killerBase >= 0 ? context.killers[killerBase]! : -1;
  const killer1 = killerBase >= 0 ? context.killers[killerBase + 1]! : -1;

  const keyed = moves.map((move) => {
    const moveKey = encodeMove(move);
    let key: number;

    if (winsNow(context, move, mover)) {
      key = TIER_WIN;
    } else if (moveKey === hashMoveKey) {
      key = TIER_HASH_MOVE;
    } else if (move.captured) {
      const victim = move.captured;
      if (victim.owner === 'neutral') {
        key = TIER_CAPTURE_ORDINARY;
      } else {
        // Live count, not a rescan: `context.counts` is kept current by
        // make/unmake (docs/engine/04-SPEED.md §1).
        const remaining = context.counts[victim.owner][victim.type];
        key =
          remaining <= 1
            ? TIER_CAPTURE_EXTINCT
            : remaining === 2
              ? TIER_CAPTURE_LAST_TWO
              : TIER_CAPTURE_ORDINARY;
      }
    } else if (hanging.length > 0 && hanging.includes(move.from) && !dangerAfter(context.scratch, move)) {
      key = TIER_ESCAPE;
    } else if (moveKey === killer0) {
      key = TIER_KILLER_0;
    } else if (moveKey === killer1) {
      key = TIER_KILLER_1;
    } else if (move.piece.owner === 'neutral') {
      key = 0;
    } else {
      // History dominates (real cutoffs seen from this exact square pair);
      // progress toward the goal breaks ties among moves history has no
      // opinion on yet.
      const history = context.history[historyIndex(mover, move.from, move.to)]!;
      key = TIER_QUIET_BASE + history + (toGoal[move.from]! - toGoal[move.to]!) * 10;
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
 * Captures and winning moves, so the search doesn't stop on a position where
 * a piece is hanging — plus, when the mover already has a hanging piece, the
 * moves that walk it to safety (see the header comment). `moves` is passed in
 * when the caller has already generated it, which it has whenever it needed
 * the no-moves check. Fail-soft throughout (03-SEARCH.md §4): the true best
 * found is returned rather than clamped to `alpha`/`beta`.
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
  const moves = generated ?? movesFromPieceLists(scratch, context.lists);

  if (moves.length === 0) return terminalScore('loss', depthFromRoot);

  const standPat = evaluate(scratch, context.keepTerms, context.counts);
  if (extra >= QUIESCENCE_MAX_PLIES || outOfTime(context)) return standPat;

  const hanging = hangingSquaresFromList(scratch, mover, context.lists);
  let best = standPat;

  // Stand-pat assumes the mover could do nothing further and be no worse off
  // than the static score. That assumption is unsound exactly the way it is
  // unsound "in check" in chess: there may be an escape worth far more than
  // this static estimate, and captures alone would never find it. So a
  // hanging piece disables the early cutoff below — but the static score,
  // now that it prices the hang (docs/engine/02-EVALUATION.md), still stands
  // as the fallback if no escape or capture helps.
  if (hanging.length === 0 && standPat >= beta) return standPat;
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

  for (const move of orderMoves(context, tactical, mover, depthFromRoot, -1, hanging)) {
    const captured = make(context, move);
    scratch.turn = other(mover);
    toggleSide(context);
    const score = -quiesce(context, -beta, -alpha, depthFromRoot + 1, extra + 1);
    toggleSide(context);
    scratch.turn = mover;
    unmake(context, move, captured);

    if (score > best) best = score;
    if (score >= beta) return best;
    if (score > alpha) alpha = score;
  }

  return best;
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
  const moves = movesFromPieceLists(scratch, context.lists);

  // The side to move with no legal move loses (2.8).
  if (moves.length === 0) return terminalScore('loss', depthFromRoot);

  // The move limit is a draw (2.9). Repetition is not tracked inside the search:
  // the reference engine didn't either, and a shallow search cannot see one.
  //
  // This returns before the transposition table is touched, on purpose: the
  // draw only holds down the path that got here, not the board on its own
  // (§2's path-dependence pitfall), so it must never be cached and handed to a
  // different path into the same position.
  if (context.rootPly + depthFromRoot >= context.maxPlies) return 0;

  if (depth <= 0) return quiesce(context, alpha, beta, depthFromRoot, 0, moves);

  const pvNode = beta - alpha > 1;
  const origAlpha = alpha;
  const hashHi = context.hashHi;
  const hashLo = context.hashLo;

  let hashMoveKey = -1;
  const ttIndex = context.tt.probe(hashHi, hashLo);
  if (ttIndex >= 0) {
    hashMoveKey = context.tt.moveOf(ttIndex);
    // Never cut on the table at a PV node (§2): only the move suggestion is
    // trusted there, and only a null-window node gets to trust the bound too.
    if (!pvNode && context.tt.depthOf(ttIndex) >= depth) {
      const ttScore = fromTTScore(context.tt.scoreOf(ttIndex), depthFromRoot);
      const bound = context.tt.boundOf(ttIndex);
      if (
        bound === BOUND_EXACT ||
        (bound === BOUND_LOWER && ttScore >= beta) ||
        (bound === BOUND_UPPER && ttScore <= alpha)
      ) {
        return ttScore;
      }
    }
  }

  const hanging = hangingSquaresFromList(scratch, mover, context.lists);
  const ordered = orderMoves(context, moves, mover, depthFromRoot, hashMoveKey, hanging);

  let best = -Infinity;
  let bestMoveKey = -1;
  const triedQuiets: Move[] = [];
  let searched = 0;

  for (const move of ordered) {
    const winner = winsNow(context, move, mover);
    const quiet = !move.captured && !winner;
    let score: number;

    if (winner) {
      score = terminalScore('win', depthFromRoot + 1);
    } else {
      const captured = make(context, move);
      scratch.turn = other(mover);
      toggleSide(context);

      if (searched === 0 || !pvNode) {
        score = -negamax(context, depth - 1, -beta, -alpha, depthFromRoot + 1);
      } else {
        // PVS (§4): everything after the first move only needs to know
        // whether it beats `alpha`; re-search with the full window on the
        // rare move that does.
        score = -negamax(context, depth - 1, -alpha - 1, -alpha, depthFromRoot + 1);
        if (score > alpha && score < beta) {
          score = -negamax(context, depth - 1, -beta, -alpha, depthFromRoot + 1);
        }
      }

      toggleSide(context);
      scratch.turn = mover;
      unmake(context, move, captured);
    }

    searched++;

    if (score > best) {
      best = score;
      bestMoveKey = encodeMove(move);
    }
    if (best > alpha) alpha = best;
    if (alpha >= beta) {
      if (quiet) {
        recordKiller(context, depthFromRoot, encodeMove(move));
        updateHistory(context, mover, move, depth, true);
        for (const missed of triedQuiets) updateHistory(context, mover, missed, depth, false);
      }
      break;
    }
    if (quiet) triedQuiets.push(move);
    if (outOfTime(context)) break;
  }

  // A node abandoned mid-loop on the clock hasn't seen every move, so its
  // bound isn't trustworthy enough to hand to a different path later.
  if (!context.aborted && best > -Infinity) {
    const bound = best <= origAlpha ? BOUND_UPPER : best >= beta ? BOUND_LOWER : BOUND_EXACT;
    const moveKey = bestMoveKey >= 0 ? bestMoveKey : hashMoveKey;
    context.tt.store(
      hashHi,
      hashLo,
      depth,
      toTTScore(best, depthFromRoot),
      bound,
      moveKey >= 0 ? Math.floor(moveKey / SQUARE_COUNT) : -1,
      moveKey >= 0 ? moveKey % SQUARE_COUNT : -1,
    );
  }

  return best;
}

/**
 * Scores the root moves, exactly where it matters.
 *
 * `jitter` only ever picks among moves within a few points of the best, so only
 * those need exact scores. Each move after the first is a PVS scout
 * (03-SEARCH.md §4, folded into the trick below rather than kept separate):
 * searched with alpha set just below "best so far minus jitter" and a null
 * window, re-searched with the full window only if it beats that. Anything
 * that cannot become a candidate fails low and returns a bound, which is all
 * it is worth. Searching every root move with a full window instead — which is
 * the obvious way to keep the scores honest — turns alpha-beta off at the root
 * and costs about twenty times the nodes.
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
      const rootAlpha = best === -Infinity ? -Infinity : best - jitter - 1;
      const captured = make(context, move);
      scratch.turn = other(mover);
      toggleSide(context);

      if (i === 0 || rootAlpha === -Infinity) {
        score = -negamax(context, depth - 1, -Infinity, -rootAlpha, 1);
      } else {
        score = -negamax(context, depth - 1, -rootAlpha - 1, -rootAlpha, 1);
        if (score > rootAlpha) {
          score = -negamax(context, depth - 1, -Infinity, -rootAlpha, 1);
        }
      }

      toggleSide(context);
      scratch.turn = mover;
      unmake(context, move, captured);
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
  const { hi, lo } = initialHash(state.board, state.turn);

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
    // Scanned once, here; `make`/`unmake` keep them current from then on.
    counts: countsOf(state.board),
    lists: pieceListsOf(state.board),
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
    hashHi: hi,
    hashLo: lo,
    tt: new TranspositionTable(),
    killers: new Int32Array(MAX_KILLER_PLY * 2).fill(-1),
    history: new Int32Array(2 * SQUARE_COUNT * SQUARE_COUNT),
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
  const hanging = hangingSquaresFromList(context.scratch, state.turn, context.lists);
  const moves = orderMoves(context, unordered, state.turn, 0, -1, hanging);
  const scores = scoreRootMoves(context, moves, options.depth, options.jitter);

  return moves
    .map((move, index) => ({ move, score: scores[index]! }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Picks a move for `level`. Deterministic given the position, level and seed, so
 * any computer game replays exactly (7.8).
 *
 * `level` is a name from `LEVELS`, or a `LevelConfig` of its own — engine-vs-engine
 * matches (docs/engine/06-MEASUREMENT-AND-LEVELS.md part one) need to play
 * configurations that aren't on the difficulty ladder.
 */
export function chooseMove(
  state: GameState,
  level: Level | LevelConfig,
  seed: number,
): SearchResult {
  const unordered = legalMoves(state);
  if (unordered.length === 0) throw new NoMovesError();

  const config = resolveLevelConfig(level);
  const started = Date.now();

  const context = createContext(state, {
    keepTerms: config.keepTerms,
    seed,
    deadline: config.depth === 'iterative' ? started + config.budgetMs : Infinity,
  });

  // A good first move makes every later one cheaper to reject.
  const hanging = hangingSquaresFromList(context.scratch, state.turn, context.lists);
  let moves = orderMoves(context, unordered, state.turn, 0, -1, hanging);

  let scores: number[];
  let reached: number;

  if (config.depth === 'iterative') {
    // Iterative deepening: keep the last depth that finished inside the budget.
    // The minimum-depth iteration always runs to completion — searched with no
    // deadline at all — because it is the only guarantee that a move comes
    // back; a partial score from an aborted minimum-depth search is not a real
    // score (03-SEARCH.md §1).
    const savedDeadline = context.deadline;
    context.deadline = Infinity;
    reached = config.minDepth;
    scores = scoreRootMoves(context, moves, reached, config.jitter);
    context.deadline = savedDeadline;

    // Depth n+1 gets depth n's answer as its first guess (§1): over 90% of
    // fail-high nodes cut on the first move tried, and re-searching the same
    // static order every iteration throws that away.
    let ordered = moves
      .map((move, index) => ({ move, score: scores[index]! }))
      .sort((a, b) => b.score - a.score);

    for (let depth = reached + 1; !context.aborted; depth++) {
      if (Date.now() >= context.deadline) break;
      const orderedMoves = ordered.map((entry) => entry.move);
      const attempt = scoreRootMoves(context, orderedMoves, depth, config.jitter);
      if (context.aborted) break;
      ordered = orderedMoves
        .map((move, index) => ({ move, score: attempt[index]! }))
        .sort((a, b) => b.score - a.score);
      reached = depth;
    }

    moves = ordered.map((entry) => entry.move);
    scores = ordered.map((entry) => entry.score);
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
