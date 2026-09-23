// Generates tools/bench/data/tactics.json — docs/engine/06-MEASUREMENT-AND-
// LEVELS.md part one, §2: "positions with a known best move, scored as how
// many does the engine find." Two of the doc's three sources; the third
// (endgame positions from the tablebase) waits on 05-LEARNING-AND-TABLES.md,
// which hasn't been built yet.
//
// This is a generator, not something loaded at runtime — run it and commit
// the result:
//   pnpm --filter @sps/bench exec vite-node src/generate-tactics.ts
//
// Both sources drive self-play with the *named* levels (Easy/Medium/Hard)
// rather than an unbounded fixed-depth search: the doc's own illustration is
// "depth 4 vs depth 8", but an honest unbounded search at depth 5+ already
// costs 37-115 seconds a position pre-04-SPEED.md/03-SEARCH.md
// (01-DIAGNOSIS.md §3) — using the ladder's own budget-bounded levels keeps
// this finishing in well under a minute instead of hours, and is arguably
// more useful anyway: it is a direct check of the levels players actually
// face, not an abstract depth pair. Re-derive with real depths once the
// search is fast enough to afford it.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  applyMove,
  createGame,
  getVariant,
  legalMoves,
  moveToText,
  threatenedBy,
  toFen,
} from '@sps/engine';
import type { GameState, VariantId } from '@sps/engine';
import { chooseMove, hangingSquaresOf } from '@sps/ai';

interface TacticPuzzle {
  id: string;
  category: 'defensive' | 'race';
  variant: VariantId;
  fen: string;
  solutions: string[];
  note: string;
}

/** A hash of (gameSeed, ply), in the shape `tools/sim` and `src/match.ts` both
 *  use, so a position reached this way is reproducible. */
function plySeed(gameSeed: number, ply: number): number {
  let hash = (gameSeed ^ Math.imul(ply + 1, 0x85ebca6b)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x2c1b3c6d) >>> 0;
  return hash >>> 0;
}

/**
 * Every legal move from `state` that saves a hanging piece on one of
 * `hangingSquares`: walks it away, or captures the attacker that was
 * threatening it. Mirrors search.ts's own "fixes a hang" test (the moves
 * `evasions()` and quiescence's capture list would look at), so a puzzle's
 * accepted answers are exactly what the engine itself considers a fix — not a
 * single hand-picked "best" line, which a defensive puzzle doesn't need.
 */
function fixesFor(state: GameState, hangingSquares: readonly number[]): string[] {
  const attackers = new Set<number>();
  for (const square of hangingSquares) {
    for (const attacker of threatenedBy(state, square)) attackers.add(attacker);
  }

  const fixes: string[] = [];
  for (const move of legalMoves(state)) {
    const savesIt = hangingSquares.includes(move.from);
    const takesAttacker = move.captured !== null && attackers.has(move.to);
    if (savesIt || takesAttacker) fixes.push(moveToText(state, move));
  }
  return fixes;
}

function collectDefensive(variantId: VariantId, seeds: readonly number[], max: number): TacticPuzzle[] {
  const variant = getVariant(variantId);
  const puzzles: TacticPuzzle[] = [];

  for (const seed of seeds) {
    if (puzzles.length >= max) break;
    let state = createGame(variant);

    while (!state.result) {
      const hanging = hangingSquaresOf(state, state.turn);
      if (hanging.length > 0) {
        const solutions = fixesFor(state, hanging);
        const legal = legalMoves(state).length;
        // Only a real puzzle if declining is a genuine mistake: some but not
        // every legal move fixes it.
        if (solutions.length > 0 && solutions.length < legal) {
          puzzles.push({
            id: `defensive-${variantId}-${seed}-${state.ply}`,
            category: 'defensive',
            variant: variantId,
            fen: toFen(state),
            solutions,
            note: `${hanging.length} piece(s) hanging; ${solutions.length} of ${legal} legal moves save one.`,
          });
          if (puzzles.length >= max) break;
        }
      }

      const { move } = chooseMove(state, 'medium', plySeed(seed, state.ply));
      state = applyMove(state, move).state;
    }
  }

  return puzzles;
}

const RACE_CHECK_EVERY = 8;

function collectRace(variantId: VariantId, seeds: readonly number[], max: number): TacticPuzzle[] {
  const variant = getVariant(variantId);
  const puzzles: TacticPuzzle[] = [];

  for (const seed of seeds) {
    if (puzzles.length >= max) break;
    let state = createGame(variant);

    while (!state.result) {
      if (state.ply >= 6 && state.ply % RACE_CHECK_EVERY === 0 && legalMoves(state).length >= 4) {
        const shallow = chooseMove(state, 'medium', plySeed(seed, state.ply));
        const deep = chooseMove(state, 'hard', plySeed(seed, state.ply) + 1);
        const shallowText = moveToText(state, shallow.move);
        const deepText = moveToText(state, deep.move);

        if (shallowText !== deepText) {
          puzzles.push({
            id: `race-${variantId}-${seed}-${state.ply}`,
            category: 'race',
            variant: variantId,
            fen: toFen(state),
            solutions: [deepText],
            note: `Medium played ${shallowText}; Hard played ${deepText} instead.`,
          });
          if (puzzles.length >= max) break;
        }
      }

      const { move } = chooseMove(state, 'medium', plySeed(seed, state.ply));
      state = applyMove(state, move).state;
    }
  }

  return puzzles;
}

const defensive = collectDefensive('original', [1, 2, 3, 4, 5, 6, 7, 8], 24);
const race = collectRace('original', [11, 12, 13, 14, 15, 16], 16);
const puzzles = [...defensive, ...race];

const out = {
  _source:
    'Generated by tools/bench/src/generate-tactics.ts — docs/engine/06-MEASUREMENT-AND-LEVELS.md part one, §2. Re-run and commit the result after an evaluation or search change worth regression-testing.',
  puzzles,
};

const path = fileURLToPath(new URL('../data/tactics.json', import.meta.url));
writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
process.stdout.write(
  `wrote ${puzzles.length} puzzles (${defensive.length} defensive, ${race.length} race) to ${path}\n`,
);
