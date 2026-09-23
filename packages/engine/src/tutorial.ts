// The six-puzzle tutorial — spec 10.9. Shipped data, not a test fixture: the
// interface loads a puzzle position the same way it loads a variant's start
// position, so this lives beside `variants.ts` rather than under `test/`.
//
// The positions themselves are unchanged from the reference engine's own
// output (`src/data/tutorial.json` — moved here from `test/fixtures/` without
// editing a single character) and stay checked against the live engine by
// `test/fixtures.test.ts`, exactly as before the move.

import tutorialData from './data/tutorial.json' with { type: 'json' };
import type { VariantId } from './types.js';

export interface TutorialPuzzle {
  n: number;
  teaches: string;
  variant: VariantId;
  fen: string;
  /** null when any legal move solves it (puzzle 1) — see `legalCount` instead. */
  solution: string | null;
  /** How many legal moves the position has, checked when `solution` is null. */
  legalCount?: number;
  /** A short explanation shown alongside the puzzle. */
  note?: string;
  /** Multi-ply puzzles (puzzle 6): the full sequence, player and reply alternating. */
  line?: string[];
}

export const TUTORIAL_PUZZLES: readonly TutorialPuzzle[] = tutorialData.puzzles as TutorialPuzzle[];
