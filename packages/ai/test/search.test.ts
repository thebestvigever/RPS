import { describe, expect, it } from 'vitest';
import {
  applyMove,
  createGame,
  decodePiece,
  defendersOf,
  EMPTY,
  fromFen,
  getVariant,
  legalMoves,
  moveToText,
  SQUARE_COUNT,
  threatenedBy,
  toFen,
  VARIANT_IDS,
  VARIANTS,
} from '@sps/engine';
import type { GameState, Side } from '@sps/engine';
import { analyseRoot, chooseMove, NoMovesError } from '../src/search.js';
import { LEVELS } from '../src/levels.js';
import type { Level } from '../src/levels.js';

const original = getVariant('original');
const LEVEL_NAMES = Object.keys(LEVELS) as Level[];

// Each game is a couple of seconds. Raise it for a firmer read:
//   SPS_LADDER_GAMES=60 pnpm test
const LADDER_GAMES = Number(process.env.SPS_LADDER_GAMES ?? 16);
const load = (fen: string): GameState => fromFen(fen, original);

describe('choosing a move', () => {
  it.each(LEVEL_NAMES)('%s returns a legal move', (level) => {
    const state = createGame(original);
    const { move } = chooseMove(state, level, 1);
    const legal = legalMoves(state);
    expect(legal.some((m) => m.from === move.from && m.to === move.to)).toBe(true);
  });

  it.each(LEVEL_NAMES)('%s never mutates the state it was given', (level) => {
    // The search makes and unmakes moves on a mutable board, so this is the
    // test that the copy is real.
    const state = createGame(original);
    const before = toFen(state);
    const boardBefore = Array.from(state.board);

    chooseMove(state, level, 42);

    expect(toFen(state)).toBe(before);
    expect(Array.from(state.board)).toEqual(boardBefore);
    expect(state.ply).toBe(0);
    expect(state.turn).toBe('blue');
  });

  it.each(LEVEL_NAMES)('%s is deterministic for a seed', (level) => {
    const state = createGame(original);
    const first = chooseMove(state, level, 918273).move;
    const second = chooseMove(state, level, 918273).move;
    expect({ from: second.from, to: second.to }).toEqual({ from: first.from, to: first.to });
  });

  it('plays differently across seeds, so it is not the same game every time', () => {
    const state = createGame(original);
    const chosen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      chosen.add(moveToText(state, chooseMove(state, 'easy', seed).move));
    }
    // Easy has 60 points of jitter, so it should range widely.
    expect(chosen.size).toBeGreaterThan(1);
  });

  it('throws rather than inventing a move when there are none', () => {
    const stuck = load('sR7/RR7/9/9/9/9/9/9/8P blue');
    expect(legalMoves(stuck)).toEqual([]);
    expect(() => chooseMove(stuck, 'medium', 1)).toThrow(NoMovesError);
  });

  it.each(VARIANT_IDS)('plays %s', (id) => {
    const state = createGame(getVariant(id));
    expect(() => chooseMove(state, 'medium', 1)).not.toThrow();
  });
});

describe('tactics', () => {
  it.each(LEVEL_NAMES)('%s takes the win when it is one step away', (level) => {
    // Blue Scissors on h8, Blue's goal i9 is empty.
    const state = load('R8/7s1/9/9/9/9/9/9/9 blue');
    const { move } = chooseMove(state, level, 7);
    expect(moveToText(state, move)).toBe('Sh8-i9#');
  });

  it.each(LEVEL_NAMES)('%s captures onto the goal to win', (level) => {
    const state = load('R7P/7s1/9/9/9/9/9/9/9 blue');
    const { move } = chooseMove(state, level, 7);
    expect(moveToText(state, move)).toBe('Sh8xi9#');
  });

  it.each(LEVEL_NAMES)('%s stops the opponent reaching the corner', (level) => {
    // Tutorial puzzle 4: Rc3xb2 is the only move that stops Red reaching a1.
    const state = load('9/9/9/9/9/9/2r6/1S7/8P blue');
    const { move } = chooseMove(state, level, 3);
    expect(moveToText(state, move)).toBe('Rc3xb2');
  });

  it('wins the race rather than dawdling', () => {
    // Tutorial puzzle 6: Pg7-h8 is the only move that keeps the lead.
    const state = load('9/9/6p2/9/9/9/2S6/9/9 blue');
    const { move } = chooseMove(state, 'hard', 11);
    expect(moveToText(state, move)).toBe('Pg7-h8');
  });

  it('builds the Keep when it can', () => {
    // Tutorial puzzle 5: Rb2-a1 seals Blue's corner for good.
    const state = load('9/9/9/4S4/9/9/9/1r7/9 blue');
    const { move } = chooseMove(state, 'medium', 5);
    expect(moveToText(state, move)).toBe('Rb2-a1');
  });
});

describe('the ladder and its budgets (spec 9.3)', () => {
  it('searches deeper as the level rises', () => {
    const state = createGame(original);
    const easy = chooseMove(state, 'easy', 1).stats;
    const medium = chooseMove(state, 'medium', 1).stats;
    const hard = chooseMove(state, 'hard', 1).stats;

    expect(easy.depth).toBe(1);
    expect(medium.depth).toBe(2);
    expect(hard.depth).toBeGreaterThanOrEqual(LEVELS.hard.minDepth);
    expect(hard.nodes).toBeGreaterThan(medium.nodes);
    expect(medium.nodes).toBeGreaterThan(easy.nodes);
  });

  it('keeps Hard inside a sane wall-clock bound', () => {
    // The real target is 1.2s on a mid-range phone (M4, spec 11.7). This only
    // guards against iterative deepening running away on a slow CI box.
    const state = createGame(original);
    const { stats } = chooseMove(state, 'hard', 1);
    expect(stats.ms).toBeLessThan(LEVELS.hard.budgetMs * 4);
  });

  it(`beats the level below it over ${LADDER_GAMES} games`, () => {
    // Statistical, not deterministic: the spec measured depth 3 beating depth 1
    // in 53 of 60 games (6.2). This is a ladder check — "the levels are not
    // inverted" — not a balance measurement. `tools/sim` is the instrument for
    // real numbers.
    let mediumWins = 0;
    let easyWins = 0;

    for (let game = 0; game < LADDER_GAMES; game++) {
      // Alternate which side the stronger player takes, so first-player
      // advantage cannot account for the result.
      const mediumSide: Side = game % 2 === 0 ? 'blue' : 'red';
      let state = createGame(original);
      let ply = 0;

      while (!state.result) {
        const level: Level = state.turn === mediumSide ? 'medium' : 'easy';
        const seed = (game + 1) * 7919 + ply * 104729;
        state = applyMove(state, chooseMove(state, level, seed).move).state;
        ply++;
      }

      if (state.result.winner === mediumSide) mediumWins++;
      else if (state.result.winner !== null) easyWins++;
    }

    expect(mediumWins).toBeGreaterThan(easyWins);
  }, 300_000);
});

describe('the root window (an optimisation with an invariant)', () => {
  // Scoring root moves with alpha set just below "best minus jitter" prunes
  // moves that cannot become candidates. It must not change which move wins.
  // A jitter of Infinity turns the window off, giving the slow, obviously
  // correct version to compare against.
  const positions = [
    VARIANTS.original.start,
    '9/4PR3/4SPR2/5SPR1/1ps3SP1/1rps5/2rps4/3rp4/9 red',
    '9/9/6P2/5S3/4r4/3r5/2S6/9/9 blue',
    '9/9/9/3PRS3/4r4/9/9/9/9 blue',
  ];

  it.each(positions)('agrees with an unpruned search: %s', (fen) => {
    const state = load(fen);
    for (const depth of [1, 2]) {
      const pruned = analyseRoot(state, { depth, keepTerms: true, seed: 5, jitter: 0 });
      const full = analyseRoot(state, { depth, keepTerms: true, seed: 5, jitter: Infinity });

      expect(pruned[0]!.score).toBe(full[0]!.score);
      expect({ from: pruned[0]!.move.from, to: pruned[0]!.move.to }).toEqual({
        from: full[0]!.move.from,
        to: full[0]!.move.to,
      });
    }
  });

  it('scores every legal move exactly once', () => {
    const state = createGame(original);
    const scored = analyseRoot(state, { depth: 1, keepTerms: false, seed: 1, jitter: 0 });
    expect(scored).toHaveLength(legalMoves(state).length);
    expect(new Set(scored.map((s) => `${s.move.from}-${s.move.to}`)).size).toBe(scored.length);
  });

  it('only ever picks a move within jitter of the best', () => {
    const state = createGame(original);
    const scored = analyseRoot(state, { depth: 2, keepTerms: true, seed: 1, jitter: Infinity });
    const best = scored[0]!.score;
    const byMove = new Map(scored.map((s) => [`${s.move.from}-${s.move.to}`, s.score]));

    for (let seed = 1; seed <= 30; seed++) {
      const { move } = chooseMove(state, 'medium', seed);
      const score = byMove.get(`${move.from}-${move.to}`)!;
      expect(score).toBeGreaterThanOrEqual(best - LEVELS.medium.jitter);
    }
  });
});

describe('quiescence (spec 9.1)', () => {
  it('prefers a free capture over one that is immediately recaptured', () => {
    // Blue Rocks on e5 and d4. Re5xf6 wins a Scissors but Red's Paper on g7
    // takes the Rock straight back; Rd4xc3 wins a Scissors for nothing.
    const state = load('9/9/6P2/5S3/4r4/3r5/2S6/9/9 blue');
    for (const level of LEVEL_NAMES) {
      expect(moveToText(state, chooseMove(state, level, 13).move)).toBe('Rd4xc3');
    }
  });
});

describe('defence (docs/engine/01-DIAGNOSIS.md)', () => {
  /** Squares holding one of `side`'s own pieces that is attacked with no
   *  defender — the same "hanging" definition the diagnosis measured with,
   *  and the one `evaluate`/`quiesce` now use. */
  function hangingSquares(state: GameState, side: Side): number[] {
    const squares: number[] = [];
    for (let square = 0; square < SQUARE_COUNT; square++) {
      const code = state.board[square]!;
      if (code === EMPTY) continue;
      if (decodePiece(code)!.owner !== side) continue;
      if (threatenedBy(state, square).length === 0) continue;
      if (defendersOf(state, square).length > 0) continue;
      squares.push(square);
    }
    return squares;
  }

  // Deliberately NOT a self-play statistical test. An earlier version of this
  // test played full self-play games and asserted an aggregate hanging rate —
  // it cost 8+ minutes (Hard's own 1.2s/move budget, times many plies, times
  // several games) and, worse, an A/B run against the pre-fix code on a real
  // sample found the self-play hanging rate barely moved (14.7% -> 16.7% at
  // Hard, n=150, well inside noise for that sample size). Self-play isn't a
  // clean probe for this specific claim: the fix makes BOTH sides of the
  // mirror match smarter at once, so the raw "how often does a move leave
  // something hanging" rate doesn't have to fall even when the underlying
  // play is genuinely better — and `pnpm sim` says it is: shorter, more
  // decisive, more balanced games (docs/engine/02-EVALUATION.md's status
  // note has the numbers). What a fast, deterministic test CAN check
  // directly is the mechanism itself.
  it.each(['medium', 'hard'] as const)(
    '%s walks an already-hanging piece to safety rather than ignoring it',
    (level) => {
      // Blue's move. The Paper on e5 is attacked by Red's Scissors on e6 and
      // has no defender: d4, e4 and f4 escape it; d5, d6, f5 and f6 stay
      // adjacent to e6 and don't. Blue's Rock on a5 is the "ignore it, do
      // something else" alternative — five legal moves, none of which matter.
      // Red's spare Paper on i1 is load-bearing, not decoration: without it,
      // Blue's Rock has no predator anywhere on the board and is already
      // permanent (2.10) — Hard then correctly ignores the Paper to start
      // marching that Rock home and seal the Keep instead (+3000, dwarfing
      // one Paper), which is the right move, not a bug. An earlier version
      // of this test missed that and "failed" on exactly that false alarm.
      const state = load('9/9/9/4S4/r3p4/9/9/9/8P blue');
      const { move } = chooseMove(state, level, 21);
      const after = applyMove(state, move).state;

      expect(hangingSquares(after, 'blue')).toEqual([]);
    },
  );
});
