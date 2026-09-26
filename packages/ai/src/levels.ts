// Difficulty ladder — spec 9.3. The ladder is real: depth 3 beat depth 1 in 53
// of 60 games (spec 6.2).

export type Level = 'easy' | 'medium' | 'hard';

export interface LevelConfig {
  /** Fixed search depth in plies, or 'iterative' for deepening under a budget. */
  depth: number | 'iterative';
  minDepth: number;
  /** Points within the best score that a root move may be chosen from. */
  jitter: number;
  /** The Keep terms in the evaluation (spec 9.2). */
  keepTerms: boolean;
  /** Target think time on a mid-range phone, in ms. */
  budgetMs: number;
}

export const LEVELS: Record<Level, LevelConfig> = {
  easy: { depth: 1, minDepth: 1, jitter: 60, keepTerms: false, budgetMs: 150 },
  medium: { depth: 2, minDepth: 2, jitter: 8, keepTerms: true, budgetMs: 400 },
  hard: { depth: 'iterative', minDepth: 3, jitter: 2, keepTerms: true, budgetMs: 5000 },
};

/**
 * A named level, or a config of its own — docs/engine/06-MEASUREMENT-AND-LEVELS.md
 * part one: engine-vs-engine matches need to play two configurations that aren't
 * on the difficulty ladder (a candidate depth, a term flipped off), so
 * `chooseMove` accepts either and resolves a name against `LEVELS` here.
 */
export function resolveLevelConfig(level: Level | LevelConfig): LevelConfig {
  return typeof level === 'string' ? LEVELS[level] : level;
}

/** Show a "thinking" state for at least this long, so moves don't snap in (spec 9.3). */
export const MIN_THINKING_MS = 350;

/** Quiescence search at the leaves runs at most this many extra plies (spec 9.1). */
export const QUIESCENCE_MAX_PLIES = 4;
