// Search — spec 9.1.
//
// Negamax with alpha-beta pruning. Quiescence search at the leaves: only captures
// and moves that reach the goal, up to 4 extra plies, with a stand-pat score.
//
// Move ordering: captures first, then moves that bring the moving piece closer to
// its goal, then the rest. Break ties with the seeded generator.
//
// Root choice: score every root move, then pick uniformly at random among moves
// within `jitter` points of the best. Without this the AI plays the identical
// game every time.
//
// Iterative deepening under a time budget is recommended for the shipped AI; the
// reference used fixed depths of 1, 2 and 3 plies.

import { NotImplementedError } from '@sps/engine';
import type { GameState, Move } from '@sps/engine';
import type { Level } from './levels.js';

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

export function chooseMove(
  _state: GameState,
  _level: Level,
  _seed: number,
): SearchResult {
  throw new NotImplementedError('chooseMove', '9.1');
}
