// Search — spec 9.1, extended by docs/engine/03-SEARCH.md §1-4 and §6-11.
//
// Negamax with alpha-beta pruning, a transposition table, killer/history move
// ordering, Principal Variation Search, late move reductions, aspiration
// windows, search-local repetition detection and adaptive time management,
// fail-soft throughout. Quiescence search at the leaves: captures and moves
// that reach the goal, up to 4 extra plies, with a stand-pat score — PLUS,
// when the side to move has a piece attacked with no defender
// (docs/engine/02-EVALUATION.md's "hanging"), the moves that walk it to
// safety.
//
// Move ordering (03-SEARCH.md §6, folded into §3's killers/history): a win,
// the hash move, then captures ranked by what they do to the losing side's
// piece count (wiping out a type outranks merely reducing it, which outranks
// an ordinary capture — 02-EVALUATION.md Term 3's exchangeOn() further splits
// the ordinary tier into good and bad, per §6 items 4 and 8), then escapes
// from a hanging piece, then killers, then quiet moves ranked by history and
// by progress toward the goal, with ties broken by the seeded generator.
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
  exchangeOn,
  insertIntoPieceLists,
  isGoalSquare,
  legalMoves,
  movesFromPieceLists,
  nearestRunner,
  nearestRunnerSquare,
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

/** Same headroom, for the repetition-path stack (§10). */
const MAX_PATH_PLY = 64;

/**
 * Has this exact position already appeared earlier on the current search
 * path — not the real game's history, just this one line the DFS is
 * currently walking? O(depthFromRoot), and depthFromRoot never gets deep
 * enough for that to matter.
 */
function isRepeatOnPath(context: Context, depthFromRoot: number): boolean {
  const { hashHi, hashLo, pathHi, pathLo } = context;
  const limit = Math.min(depthFromRoot, MAX_PATH_PLY);
  for (let ply = 0; ply < limit; ply++) {
    if (pathHi[ply] === hashHi && pathLo[ply] === hashLo) return true;
  }
  return false;
}

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
  /**
   * The hash at each ply of the current search path (03-SEARCH.md §10):
   * `pathHi[0]`/`pathLo[0]` is the root, `pathHi[depthFromRoot]` is the
   * position `negamax` is about to search. Indexed by `depthFromRoot`, not a
   * stack — a sibling move overwrites its own ply's slot when it's explored,
   * which is safe because the DFS always finishes with everything deeper
   * before that happens.
   */
  pathHi: Int32Array;
  pathLo: Int32Array;
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

// Move-ordering tiers (03-SEARCH.md §3 and §6, highest first): a win, the
// hash move, a capture that wipes out or nearly wipes out an enemy type
// (02-EVALUATION.md Term 3 — the most important capture in the game, tried
// regardless of what `exchangeOn()` thinks of it), an ordinary capture
// `exchangeOn()` (Term 1's "left on the table," now built — see
// packages/engine/src/analysis.ts) says is at worst even, an escape from a
// hanging piece, killers, quiet moves by history and progress, and last of
// all a capture `exchangeOn()` says loses material outright.
const TIER_WIN = 1_000_000_000;
const TIER_HASH_MOVE = 500_000_000;
const TIER_CAPTURE_EXTINCT = 100_000;
const TIER_CAPTURE_LAST_TWO = 90_000;
const TIER_CAPTURE_GOOD = 80_000;
const TIER_ESCAPE = 70_000;
const TIER_KILLER_0 = 60_100;
const TIER_KILLER_1 = 60_000;
const TIER_QUIET_BASE = 100;
/** Below every quiet move (§6 item 8) — a capture `exchangeOn()` says loses material. */
const TIER_CAPTURE_BAD = -50_000;

// --- Late move reductions (03-SEARCH.md §8) ---------------------------------
//
// The biggest structural gain available, and the riskiest, so the exclusion
// list is long: never reduce a capture, an escape from a hanging piece, a
// move by the side's nearest runner or one that overtakes it, a killer, a
// move with a history of causing cutoffs, anything shallower than three plies
// remaining, or anything at a PV node. Wrongly reducing a move that turns out
// to matter is self-correcting — it just fails to raise alpha, and the normal
// re-search at full depth catches it — so the cost of getting the exclusions
// slightly wrong is speed, not correctness.
const LMR_FULL_DEPTH_MOVES = 3;
const LMR_MIN_DEPTH = 3;
const LMR_LATE_MOVE_INDEX = 8;

/**
 * How many plies to shave off this move's search, or 0 for "search it at full
 * depth." `runnerSquare`/`runnerDistance` describe the mover's nearest runner
 * before this move, so a move that IS that runner, or that hands a different
 * piece a shorter distance to the goal than the runner already had, both stay
 * unreduced — the analogue of chess's passed-pawn-push exclusion.
 */
function lmrReduction(
  context: Context,
  mover: Side,
  move: Move,
  searched: number,
  depth: number,
  pvNode: boolean,
  quiet: boolean,
  killer0: number,
  killer1: number,
  hanging: readonly number[],
  runnerSquare: number | null,
  runnerDistance: number,
): number {
  if (pvNode || !quiet) return 0;
  if (searched < LMR_FULL_DEPTH_MOVES || depth < LMR_MIN_DEPTH) return 0;

  const moveKey = encodeMove(move);
  if (moveKey === killer0 || moveKey === killer1) return 0;
  if (context.history[historyIndex(mover, move.from, move.to)]! > 0) return 0;
  if (hanging.length > 0 && hanging.includes(move.from) && !dangerAfter(context.scratch, move)) return 0;
  if (move.from === runnerSquare) return 0;
  if (context.tables.toGoal[mover][move.to]! < runnerDistance) return 0;

  return searched >= LMR_LATE_MOVE_INDEX ? 2 : 1;
}

/** `killers[depthFromRoot*2]`/`[*2+1]`, or -1/-1 past `MAX_KILLER_PLY`. */
function killersAt(context: Context, depthFromRoot: number): readonly [number, number] {
  const base = depthFromRoot < MAX_KILLER_PLY ? depthFromRoot * 2 : -1;
  if (base < 0) return [-1, -1];
  return [context.killers[base]!, context.killers[base + 1]!];
}

/**
 * One move's ordering key (03-SEARCH.md §3 and §6, highest first) — the sole
 * place the tiers below are decided, shared by the eager sort (`orderMoves`,
 * used at the root where every move is wanted anyway) and the lazy selector
 * (`LazyMoveOrder`, used in `negamax`/`quiesce`'s hot loop, docs/engine/
 * 04-SPEED.md §3) so the two never drift apart.
 */
function moveOrderKey(
  context: Context,
  move: Move,
  mover: Side,
  hashMoveKey: number,
  hanging: readonly number[],
  killer0: number,
  killer1: number,
  toGoal: Int8Array,
): number {
  const moveKey = encodeMove(move);
  let key: number;

  if (winsNow(context, move, mover)) {
    key = TIER_WIN;
  } else if (moveKey === hashMoveKey) {
    key = TIER_HASH_MOVE;
  } else if (move.captured) {
    const victim = move.captured;
    // Live count, not a rescan: `context.counts` is kept current by
    // make/unmake (docs/engine/04-SPEED.md §1). A neutral is never scarce in
    // this sense (it isn't material for anyone), so it always falls to the
    // exchangeOn() tier below rather than the extinction tiers.
    const remaining = victim.owner === 'neutral' ? Infinity : context.counts[victim.owner][victim.type];
    if (remaining <= 1) {
      key = TIER_CAPTURE_EXTINCT;
    } else if (remaining === 2) {
      key = TIER_CAPTURE_LAST_TWO;
    } else {
      key = exchangeOn(context.scratch, move.to, mover) >= 0 ? TIER_CAPTURE_GOOD : TIER_CAPTURE_BAD;
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
  return key + stableJitter(context.seed, move.from, move.to);
}

function orderMoves(
  context: Context,
  moves: Move[],
  mover: Side,
  depthFromRoot: number,
  hashMoveKey: number,
  hanging: readonly number[],
): Move[] {
  const toGoal = context.tables.toGoal[mover];
  const [killer0, killer1] = killersAt(context, depthFromRoot);

  const keyed = moves.map((move) => ({
    move,
    key: moveOrderKey(context, move, mover, hashMoveKey, hanging, killer0, killer1, toGoal),
  }));

  keyed.sort((a, b) => b.key - a.key);
  return keyed.map((entry) => entry.move);
}

/**
 * Yields moves best-first without sorting the whole list up front — a
 * selection pass per `next()` call instead (docs/engine/04-SPEED.md §3).
 * Alpha-beta usually cuts after one to three moves, so most nodes never pay
 * for ranking the rest; this also drops the `.map()` allocating a `{move,
 * key}` wrapper per move and the array `.sort()` produces, keeping only two
 * typed arrays (keys, used) per node instead. Tie-breaking matches a stable
 * descending sort exactly: `keys` is unique per move in practice
 * (`stableJitter` on distinct `(from, to)` pairs), and even on an exact tie
 * this picks the earlier index first, same as `Array.sort`'s stability would.
 */
class LazyMoveOrder {
  private readonly used: Uint8Array;
  private remaining: number;

  constructor(
    private readonly moves: Move[],
    private readonly keys: Float64Array,
  ) {
    this.used = new Uint8Array(moves.length);
    this.remaining = moves.length;
  }

  next(): Move | undefined {
    if (this.remaining === 0) return undefined;

    let bestIndex = -1;
    let bestKey = -Infinity;
    for (let i = 0; i < this.moves.length; i++) {
      if (this.used[i]!) continue;
      const key = this.keys[i]!;
      if (key > bestKey) {
        bestKey = key;
        bestIndex = i;
      }
    }

    this.used[bestIndex] = 1;
    this.remaining--;
    return this.moves[bestIndex];
  }
}

function lazyOrderMoves(
  context: Context,
  moves: Move[],
  mover: Side,
  depthFromRoot: number,
  hashMoveKey: number,
  hanging: readonly number[],
): LazyMoveOrder {
  const toGoal = context.tables.toGoal[mover];
  const [killer0, killer1] = killersAt(context, depthFromRoot);

  const keys = new Float64Array(moves.length);
  for (let i = 0; i < moves.length; i++) {
    keys[i] = moveOrderKey(context, moves[i]!, mover, hashMoveKey, hanging, killer0, killer1, toGoal);
  }

  return new LazyMoveOrder(moves, keys);
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

  const standPat = evaluate(scratch, context.keepTerms, context.counts, context.lists, context.tables);
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
  //
  // Bad-capture pruning (03-SEARCH.md §5): a capture exchangeOn() says loses
  // material outright is skipped — unless it also walks a hanging piece to
  // safety, since escaping a bigger threat can be worth more than the
  // material just given up, the same exception evasions() exists for below.
  const tactical: Move[] = [];
  for (const move of moves) {
    if (winsNow(context, move, mover)) return terminalScore('win', depthFromRoot + 1);
    if (!move.captured) continue;
    if (exchangeOn(scratch, move.to, mover) < 0) {
      const escapes = hanging.length > 0 && hanging.includes(move.from) && !dangerAfter(scratch, move);
      if (!escapes) continue;
    }
    tactical.push(move);
  }
  if (hanging.length > 0) tactical.push(...evasions(context, moves, hanging));

  const ordered = lazyOrderMoves(context, tactical, mover, depthFromRoot, -1, hanging);
  for (let move: Move | undefined; (move = ordered.next()) !== undefined; ) {
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

  // The move limit is a draw (2.9).
  //
  // This returns before the transposition table is touched, on purpose: the
  // draw only holds down the path that got here, not the board on its own
  // (§2's path-dependence pitfall), so it must never be cached and handed to a
  // different path into the same position.
  if (context.rootPly + depthFromRoot >= context.maxPlies) return 0;

  // Repetition, search-local (03-SEARCH.md §10): a position already seen
  // earlier on this exact search line scores a draw, the same one move away
  // from playing it for real would (2.9) — checked before the third
  // occurrence, since a line both sides are willing to repeat once will
  // usually repeat again. Same path-dependence reasoning as the maxPlies
  // check just above, so it is checked and never stored before the table.
  if (isRepeatOnPath(context, depthFromRoot)) return 0;
  if (depthFromRoot < MAX_PATH_PLY) {
    context.pathHi[depthFromRoot] = context.hashHi;
    context.pathLo[depthFromRoot] = context.hashLo;
  }

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
  const ordered = lazyOrderMoves(context, moves, mover, depthFromRoot, hashMoveKey, hanging);
  const [killer0, killer1] = killersAt(context, depthFromRoot);

  // Only worth a piece-list scan (§8) when LMR could actually fire here —
  // most nodes are either too shallow or a PV node, where it never applies.
  const lmrPossible = !pvNode && depth >= LMR_MIN_DEPTH;
  const runnerSquare = lmrPossible ? nearestRunnerSquare(scratch, mover) : null;
  const runnerDistance = lmrPossible ? nearestRunner(scratch, mover) : Infinity;

  let best = -Infinity;
  let bestMoveKey = -1;
  const triedQuiets: Move[] = [];
  let searched = 0;

  for (let move: Move | undefined; (move = ordered.next()) !== undefined; ) {
    const winner = winsNow(context, move, mover);
    const quiet = !move.captured && !winner;
    let score: number;

    if (winner) {
      score = terminalScore('win', depthFromRoot + 1);
    } else {
      const reduction = lmrPossible
        ? lmrReduction(
            context,
            mover,
            move,
            searched,
            depth,
            pvNode,
            quiet,
            killer0,
            killer1,
            hanging,
            runnerSquare,
            runnerDistance,
          )
        : 0;

      const captured = make(context, move);
      scratch.turn = other(mover);
      toggleSide(context);

      if (searched === 0 || !pvNode) {
        score = -negamax(context, depth - 1 - reduction, -beta, -alpha, depthFromRoot + 1);
        if (reduction > 0 && score > alpha) {
          // The reduced search says this might matter after all — verify at
          // full depth before trusting it (§8's safety net).
          score = -negamax(context, depth - 1, -beta, -alpha, depthFromRoot + 1);
        }
      } else {
        // PVS (§4): everything after the first move only needs to know
        // whether it beats `alpha`; re-search with the full window on the
        // rare move that does. `reduction` is always 0 here — `lmrReduction`
        // refuses PV nodes, and this branch only runs at one.
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

/** Doc's own suggestion: a piece is worth 100, so ±50 is a reasonable first guess. */
const ASPIRATION_INITIAL_WINDOW = 50;

/**
 * The first root move, searched around a guess at its score rather than with
 * a fully open window (03-SEARCH.md §7). `center` is the previous iteration's
 * best score — iteration depth+1 rarely disagrees with depth by much, so a
 * window of a point or two either side of it usually resolves in one search;
 * widen and retry on the rare fail-high or fail-low, doubling each time,
 * which is guaranteed to terminate since the window is finite and grows to
 * fully open. `center` is `undefined` for the very first iteration, which has
 * no prior score to guess from, and searches the open window as before.
 */
function searchFirstRootMove(context: Context, depth: number, center: number | undefined): number {
  if (center === undefined) {
    return -negamax(context, depth - 1, -Infinity, Infinity, 1);
  }

  let lo = center - ASPIRATION_INITIAL_WINDOW;
  let hi = center + ASPIRATION_INITIAL_WINDOW;
  let width = ASPIRATION_INITIAL_WINDOW;

  for (;;) {
    const score = -negamax(context, depth - 1, -hi, -lo, 1);
    if (score <= lo && lo > -Infinity) {
      width *= 2;
      lo = center - width;
      continue;
    }
    if (score >= hi && hi < Infinity) {
      width *= 2;
      hi = center + width;
      continue;
    }
    return score;
  }
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
 *
 * `aspirationCenter` (§7) is the previous iteration's best score, if there is
 * one — used only for the first move, which is what establishes `best` and so
 * tightens every other move's window too.
 */
function scoreRootMoves(
  context: Context,
  moves: Move[],
  depth: number,
  jitter: number,
  aspirationCenter?: number,
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

      if (i === 0) {
        score = searchFirstRootMove(context, depth, aspirationCenter);
      } else if (rootAlpha === -Infinity) {
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
    // path[0] is the root itself, so a line that loops straight back to it
    // is caught the same way a deeper repeat is.
    pathHi: pathStartingWith(hi),
    pathLo: pathStartingWith(lo),
  };
}

function pathStartingWith(root: number): Int32Array {
  const path = new Int32Array(MAX_PATH_PLY);
  path[0] = root;
  return path;
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

// --- Time management (03-SEARCH.md §11) -------------------------------------
//
// Determinism (7.8, tools/sim, the replay contract) still comes from the
// seed and node-deterministic search, not the clock: nothing here changes
// which move a given (position, level, seed) reaches when it does finish —
// only how much of the budget gets spent finding it, which was already
// wall-clock-governed before this. A fully reproducible node-budgeted mode
// for sim/tests, as the doc raises, is a bigger call than a search change on
// its own and is left for whoever owns that decision.

/** Past this fraction of the budget, a new iteration needs the branching
 *  factor's blessing before it starts (the soft bound). */
const SOFT_BOUND_FRACTION = 0.6;

/** Stop deepening once the best move has held for this many iterations in a row. */
const PV_STABLE_LIMIT = 3;

/** A swing at least this large, even with the same best move, resets stability. */
const PV_UNSTABLE_SCORE_SWING = 50;

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

  // One legal move: nothing to decide, so don't spend the search budget
  // deciding it (§11).
  if (unordered.length === 1) {
    const move = unordered[0]!;
    const context = createContext(state, { keepTerms: config.keepTerms, seed, deadline: Infinity });
    const hanging = hangingSquaresFromList(context.scratch, state.turn, context.lists);
    const ordered = orderMoves(context, unordered, state.turn, 0, -1, hanging);
    const depth = config.depth === 'iterative' ? config.minDepth : config.depth;
    const scores = scoreRootMoves(context, ordered, depth, 0);
    return {
      move,
      score: scores[0]!,
      stats: { depth, nodes: context.nodes, ms: Date.now() - started },
    };
  }

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
    // static order every iteration throws that away. It also seeds the
    // aspiration window (§7) below.
    let ordered = moves
      .map((move, index) => ({ move, score: scores[index]! }))
      .sort((a, b) => b.score - a.score);

    let previousIterationMs: number | null = null;
    let branchingFactor: number | null = null;
    let stableIterations = 0;
    let previousBestKey = encodeMove(ordered[0]!.move);
    let previousBestScore = ordered[0]!.score;

    for (let depth = reached + 1; !context.aborted; depth++) {
      // PV stability: the same move has looked best for several iterations
      // running and nothing just swung sharply, so more depth is unlikely to
      // change the answer — stop and give the time back rather than spend a
      // whole extra iteration confirming what is already settled.
      if (stableIterations >= PV_STABLE_LIMIT) break;

      const now = Date.now();
      if (now >= context.deadline) break; // the hard bound

      // The soft bound: past 60% of budget, only start a deeper iteration if
      // the branching factor observed so far says it can plausibly finish —
      // otherwise it gets begun with a sliver of time left and thrown away
      // whole when the hard bound cuts it off mid-search.
      const elapsed = now - started;
      if (
        elapsed > config.budgetMs * SOFT_BOUND_FRACTION &&
        previousIterationMs !== null &&
        branchingFactor !== null &&
        now + previousIterationMs * branchingFactor > context.deadline
      ) {
        break;
      }

      const iterationStarted = Date.now();
      const orderedMoves = ordered.map((entry) => entry.move);
      const attempt = scoreRootMoves(context, orderedMoves, depth, config.jitter, ordered[0]!.score);
      if (context.aborted) break;

      const iterationMs = Math.max(1, Date.now() - iterationStarted);
      if (previousIterationMs !== null) branchingFactor = iterationMs / previousIterationMs;
      previousIterationMs = iterationMs;

      ordered = orderedMoves
        .map((move, index) => ({ move, score: attempt[index]! }))
        .sort((a, b) => b.score - a.score);
      reached = depth;

      const bestKey = encodeMove(ordered[0]!.move);
      const bestScore = ordered[0]!.score;
      const unstable =
        bestKey !== previousBestKey || Math.abs(bestScore - previousBestScore) >= PV_UNSTABLE_SCORE_SWING;
      stableIterations = unstable ? 0 : stableIterations + 1;
      previousBestKey = bestKey;
      previousBestScore = bestScore;
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
