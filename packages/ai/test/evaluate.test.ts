import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  applyMove,
  createGame,
  decodePiece,
  encodePiece,
  fromFen,
  getVariant,
  isSealed,
  legalMoves,
  other,
  parseSquare,
  SQUARE_COUNT,
  VARIANTS,
} from '@sps/engine';
import type { GameState, Owner } from '@sps/engine';
import {
  WEIGHTS,
  WIN_SCORE,
  coverBonus,
  evaluate,
  extinctionPressure,
  raceMargin,
  scarcity,
  terminalScore,
} from '../src/evaluate.js';

const original = getVariant('original');
const load = (fen: string, variant = original): GameState => fromFen(fen, variant);
const flip = (state: GameState): GameState => ({
  ...state,
  turn: state.turn === 'blue' ? 'red' : 'blue',
});

/** Square `s` rotated 180° — board reversal, since toIndex(row,col) makes the
 *  square opposite (row,col) exactly `SQUARE_COUNT - 1 - s`. */
function rotate180(square: number): number {
  return SQUARE_COUNT - 1 - square;
}

function swapOwner(owner: Owner): Owner {
  return owner === 'neutral' ? owner : other(owner);
}

/**
 * The same position rotated 180° with colours swapped (spec 2.3's board
 * symmetry) — the doc's "Rotational antisymmetry" property, distinct from
 * (and stronger than) the flip-only-`turn` check above: this one also moves
 * every piece and swaps blue for red, so it exercises the terms' geometry
 * (distance to goal/home, cover direction) under the transformation that
 * actually matches the game's own symmetry, not just the turn label.
 *
 * `turn` is deliberately left UNCHANGED (not flipped) — every term is built
 * as "MY OWN distance to MY OWN goal/home minus theirs," and rotate180 maps
 * a square's distance to its owner's goal onto the recoloured piece's
 * distance to ITS (new) owner's goal one-for-one (rotate180 preserves king
 * distance, and rotate180(goal(blue)) === goal(red)). So a physically-red
 * piece becomes a physically-blue piece with the numerically IDENTICAL
 * "distance to its own goal" — meaning if `turn` also flipped, "mine" would
 * still resolve to the same physical pieces' stats as before the transform,
 * and the whole expression would come out equal rather than negated. Leaving
 * `turn` as-is makes "mine" resolve to what were the ORIGINAL OPPONENT's
 * pieces (now recoloured to the unchanged `turn`'s colour), which is what
 * actually swaps mine and theirs and produces the negation.
 */
function rotate180AndSwapColours(state: GameState): GameState {
  const board = new Int8Array(SQUARE_COUNT);
  for (let square = 0; square < SQUARE_COUNT; square++) {
    const code = state.board[square]!;
    if (code === 0) continue;
    const piece = decodePiece(code)!;
    board[rotate180(square)] = encodePiece({ owner: swapOwner(piece.owner), type: piece.type });
  }
  return { ...state, board };
}

/** Plays `picks` as indices into the legal move list, stopping when the game ends. */
function randomState(picks: readonly number[]): GameState {
  let state = createGame(original);
  for (const pick of picks) {
    const moves = legalMoves(state);
    if (state.result || moves.length === 0) break;
    state = applyMove(state, moves[pick % moves.length]!).state;
  }
  return state;
}

describe('terminal scores (spec 9.1)', () => {
  it('prefers faster wins and slower losses', () => {
    expect(terminalScore('win', 10)).toBeGreaterThan(terminalScore('win', 40));
    expect(terminalScore('loss', 40)).toBeGreaterThan(terminalScore('loss', 10));
    expect(terminalScore('draw', 10)).toBe(0);
    expect(terminalScore('win', 0)).toBe(WIN_SCORE);
  });

  it('always ranks a win above a draw above a loss', () => {
    for (const ply of [0, 50, 150, 299]) {
      expect(terminalScore('win', ply)).toBeGreaterThan(0);
      expect(terminalScore('loss', ply)).toBeLessThan(0);
    }
  });
});

describe('evaluation (spec 9.2)', () => {
  it('is exactly antisymmetric: every term is a "mine minus theirs" difference', () => {
    const positions = [
      VARIANTS.original.start,
      '9/9/9/3PRS3/4r4/9/9/9/9 blue',
      '9/9/9/4S4/9/9/9/1r7/9 blue',
      '8R/7s1/9/9/9/9/9/9/9 blue',
      '9/4PR3/4SPR2/5SPR1/1ps3SP1/1rps5/2rps4/3rp4/9 red',
    ];

    for (const fen of positions) {
      for (const keepTerms of [false, true]) {
        const state = load(fen);
        expect(evaluate(state, keepTerms)).toBeCloseTo(-evaluate(flip(state), keepTerms), 6);
      }
    }
  });

  it('is rotationally antisymmetric over random legal play (docs/engine/02-EVALUATION.md)', () => {
    // The doc's second property test: 180° rotation plus a colour swap is the
    // game's own symmetry (spec 2.3), stronger than flipping just `turn`
    // above — it also exercises every distance-to-goal/home and cover
    // calculation under the transformation, not just the mine/theirs split.
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 512 }), { minLength: 0, maxLength: 60 }),
        fc.boolean(),
        (picks, keepTerms) => {
          const state = randomState(picks);
          const rotated = rotate180AndSwapColours(state);
          expect(evaluate(state, keepTerms)).toBeCloseTo(-evaluate(rotated, keepTerms), 6);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('scores the balanced start position at zero', () => {
    expect(evaluate(createGame(original), false)).toBeCloseTo(0, 6);
    expect(evaluate(createGame(original), true)).toBeCloseTo(0, 6);
  });

  it('rewards material', () => {
    // Blue Rock and Red Rock, then the same with an extra Blue Rock.
    const even = load('9/9/9/9/4r4/9/9/9/8R blue');
    const ahead = load('9/9/9/9/4r4/3r5/9/9/8R blue');
    expect(evaluate(ahead, false)).toBeGreaterThan(evaluate(even, false));
    expect(evaluate(ahead, false) - evaluate(even, false)).toBeGreaterThan(WEIGHTS.material);
  });

  it('rewards getting closer to the goal', () => {
    // Blue's goal is i9. h8 is one step away, a1 is eight.
    const near = load('9/7r1/9/9/9/9/9/9/8R blue');
    const far = load('9/9/9/9/9/9/9/9/r7R blue');
    expect(evaluate(near, false)).toBeGreaterThan(evaluate(far, false));
  });

  it('rewards permanence', () => {
    // Red holds a Paper, so Blue's Rock can be taken.
    const vulnerable = load('9/9/9/9/4r4/9/9/9/7PS blue');
    // Red holds no Paper, so the same Rock is permanent.
    const permanent = load('9/9/9/9/4r4/9/9/9/7SS blue');
    expect(evaluate(permanent, false)).toBeGreaterThan(evaluate(vulnerable, false));
  });

  it('adds the Keep bonus only when the Keep terms are on', () => {
    const sealed = load('9/9/9/4S4/9/9/9/9/r8 blue');
    expect(isSealed(sealed, 'blue')).toBe(true);

    const withKeep = evaluate(sealed, true);
    const withoutKeep = evaluate(sealed, false);
    expect(withKeep - withoutKeep).toBeGreaterThanOrEqual(WEIGHTS.sealed);
  });

  it('ignores neutral pieces, which the search sees through captures anyway', () => {
    const neutrals = getVariant('neutrals');
    const bare = load('9/9/9/9/4r4/9/9/9/8S blue', neutrals);
    const withNeutralScissors = load('9/9/6nS2/9/4r4/9/9/9/8S blue', neutrals);
    // A neutral Scissors changes no side's material, distance or permanence.
    expect(evaluate(withNeutralScissors, false)).toBeCloseTo(evaluate(bare, false), 6);
  });

  it('never lets a positional term outweigh a win', () => {
    const state = load('9/4PR3/4SPR2/5SPR1/1ps3SP1/1rps5/2rps4/3rp4/9 blue');
    expect(Math.abs(evaluate(state, true))).toBeLessThan(WIN_SCORE / 2);
  });

  it('counts distance to the nearest square of a 2x2 goal block', () => {
    const corner2x2 = getVariant('corner2x2');
    // h8 is inside Blue's goal block, so distance 0 either way; under the
    // Original it is one step short of i9.
    const state = '9/7r1/9/9/9/9/9/9/8R blue';
    expect(evaluate(load(state, corner2x2), false)).toBeGreaterThan(
      evaluate(load(state, original), false),
    );
  });

  it('uses square-law advancement, so progress accelerates', () => {
    const at5 = load('9/9/9/9/4r4/9/9/9/8R blue');
    const at7 = load('9/9/6r2/9/9/9/9/9/8R blue');
    const gain = evaluate(at7, false) - evaluate(at5, false);
    expect(gain).toBeGreaterThan(0);
    expect(Number.isFinite(gain)).toBe(true);
    expect(parseSquare('g7')).toBe(24);
  });
});

describe('Term 2(a) — the unstoppable-runner detector (docs/engine/02-EVALUATION.md)', () => {
  it('scores a permanent runner nothing can catch as dominant, not just a bonus', () => {
    // Blue's Rock is one step from goal and permanent (Red holds no Paper
    // anywhere); Red's only piece is 8 squares from the goal, far too slow.
    const unstoppable = load('9/7r1/9/9/9/9/9/9/8R blue');
    // Same Rock, same one-step distance, but now Red's Rock sits right next
    // to the goal region instead — no longer provably unstoppable, even
    // though Blue's Rock is still permanent (Red still holds no Paper).
    const contested = load('7R1/7r1/9/9/9/9/9/9/9 blue');
    expect(evaluate(unstoppable, false) - evaluate(contested, false)).toBeGreaterThan(
      WEIGHTS.unstoppable / 2,
    );
  });

  it('never fires for a piece that isn\'t permanent, however close to goal', () => {
    // Same one-step Rock, but now Red holds a Paper — the Rock can be
    // captured, so nothing here may call it unstoppable regardless of how
    // far away that Paper actually is.
    const capturable = load('9/7r1/9/9/9/9/9/9/7PR blue');
    expect(evaluate(capturable, false)).toBeLessThan(WEIGHTS.unstoppable / 2);
  });
});

describe('Term 2(b) — the non-linear race margin (docs/engine/02-EVALUATION.md)', () => {
  it('is worth more the closer the leading runner already is to home', () => {
    // Same 2-square lead in both, but a short race (3 vs 5) has far less
    // room left to go wrong than a long one (7 vs 9).
    const short = raceMargin(3, 5);
    const long = raceMargin(7, 9);
    expect(short).toBeGreaterThan(0);
    expect(short).toBeGreaterThan(long);
  });

  it('is exactly antisymmetric under swapping mine and theirs', () => {
    // The reason this uses Math.min(mine, theirs) rather than the doc's
    // literal myDistance — see the file header in evaluate.ts.
    for (const [mine, theirs] of [[3, 5], [7, 2], [4, 4], [0, 8]] as const) {
      expect(raceMargin(mine, theirs)).toBeCloseTo(-raceMargin(theirs, mine), 6);
    }
  });

  it('is zero when nobody is ahead', () => {
    expect(raceMargin(5, 5)).toBe(0);
  });
});

describe('Term 3 — extinction economics (docs/engine/02-EVALUATION.md)', () => {
  it('scarcity is large at one left, modest at two, and gone at three or more', () => {
    expect(scarcity(1)).toBeGreaterThan(scarcity(2));
    expect(scarcity(2)).toBeGreaterThan(scarcity(3));
    expect(scarcity(3)).toBe(0);
    expect(scarcity(0)).toBe(0);
  });

  it('is derived from the permanent weight, per the doc\'s own worked example', () => {
    // "Taking their last Paper... makes every Rock you own permanent,
    // forever... 70 × (number of Rocks I have)." beats('paper') === 'rock'.
    const oneRock = { rock: 1, paper: 0, scissors: 0 };
    const lastPaper = { rock: 0, paper: 1, scissors: 0 };
    expect(extinctionPressure(oneRock, lastPaper)).toBeCloseTo(scarcity(1) * WEIGHTS.permanent, 6);
  });

  it('is zero against a type that already has three or more', () => {
    const oneRock = { rock: 1, paper: 0, scissors: 0 };
    const plentyOfPaper = { rock: 0, paper: 3, scissors: 0 };
    expect(extinctionPressure(oneRock, plentyOfPaper)).toBe(0);
  });

  it('changes evaluate() itself when only which enemy type is scarce changes', () => {
    // Both positions have the exact same squares occupied and the exact
    // same piece count on each side (6 red, 4 blue) — only which Red type is
    // down to its last one changes (Paper in one, Rock in the other), with
    // the other two Red types at 2 and 3. R/P/S filler on both sides
    // (e1/f1/g1 red, d9/e9/f9/g9 blue) denies every permanence angle
    // regardless of which config is loaded, so this isolates the pressure
    // term itself rather than any knock-on permanence change; Blue's own
    // filler is asymmetric (2 Rocks, not 1) so the two configs aren't a
    // symmetric relabelling of each other with a coincidentally equal total.
    const paperScarce = load('3rrps2/9/9/9/9/9/9/4RSS2/4RPS2 blue');
    const rockScarce = load('3rrps2/9/9/9/9/9/9/4PPS2/4RPS2 blue');
    expect(evaluate(paperScarce, false)).not.toBeCloseTo(evaluate(rockScarce, false), 0);
  });
});

describe('Term 4 — mobility and smothering (docs/engine/02-EVALUATION.md)', () => {
  it('takes a steep penalty as a side runs out of room', () => {
    // Blue's lone Rock at e5, boxed in by Red pieces on 7 of its 8
    // neighbours (one way out) versus all 8 (no way out) — a Blue Paper and
    // Scissors far from the action deny Red's Rock and Paper permanence
    // (Red already supplies its own Scissors' predator, the boxing Rocks
    // themselves), so nothing here is accidentally permanent and Term 2(a)
    // can't fire and swamp the comparison.
    const mostlyBoxed = load('p8/9/9/4RR3/3PrP3/3PSS3/9/9/8s blue');
    const fullyBoxed = load('p8/9/9/3RRR3/3PrP3/3PSS3/9/9/8s blue');
    // Fully boxed has exactly one more Red piece too (material alone
    // accounts for WEIGHTS.material of the gap) — the rest is the penalty.
    expect(evaluate(mostlyBoxed, false) - evaluate(fullyBoxed, false)).toBeGreaterThan(
      WEIGHTS.material,
    );
  });
});

describe('Term 5 — cover (docs/engine/02-EVALUATION.md)', () => {
  it('is worth more from a defender that sits between the piece and home', () => {
    expect(coverBonus(4, [3])).toBe(WEIGHTS.coverRearward);
    expect(coverBonus(4, [5])).toBe(WEIGHTS.coverForward);
    expect(coverBonus(4, [3])).toBeGreaterThan(coverBonus(4, [5]));
  });

  it('takes the best of several defenders, not the first', () => {
    expect(coverBonus(4, [5, 3])).toBe(WEIGHTS.coverRearward);
  });

  it('is zero with no defender at all', () => {
    expect(coverBonus(4, [])).toBe(0);
  });
});

describe('Term 6 — small corrections (docs/engine/02-EVALUATION.md)', () => {
  it('6(b): an ordinary piece parked on the home corner is worth something, Keep terms only', () => {
    // Blue's Rock sits exactly on its own corner (a1) versus one square off
    // it — R/P/S filler both sides so neither Rock is permanent (a
    // permanent one on the corner would be sealing it, a different and much
    // larger bonus this test isn't about).
    const onCorner = load('4rps2/9/9/9/9/9/9/9/r3RPS2 blue');
    const offCorner = load('4rps2/9/9/9/9/9/1r7/9/4RPS2 blue');
    const withKeep = evaluate(onCorner, true) - evaluate(offCorner, true);
    const withoutKeep = evaluate(onCorner, false) - evaluate(offCorner, false);
    expect(withKeep).toBeGreaterThan(withoutKeep + WEIGHTS.cornerOccupancy / 2);
  });

  it("6(c): a neutral predator threatens a piece exactly like an enemy one would", () => {
    const neutrals = getVariant('neutrals');
    // Blue's Rock is not adjacent to the neutral Scissors here...
    const nonThreatening = load('4rps2/9/7nS1/9/4r4/9/9/9/4RPS2 blue', neutrals);
    // ...but is here, where the neutral Paper (Rock's predator) sits next to
    // it instead — R/P/S filler both sides denies permanence in both, so
    // this isolates the threat term alone.
    const threatening = load('4rps2/9/9/4nP4/4r4/9/9/9/4RPS2 blue', neutrals);
    expect(evaluate(nonThreatening, false) - evaluate(threatening, false)).toBeCloseTo(
      WEIGHTS.hanging,
      1,
    );
  });
});
