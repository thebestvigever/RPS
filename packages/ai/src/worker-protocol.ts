// Worker protocol — spec 9.4. The worker rebuilds state from the record, so it
// never holds game state of its own. A new game or an undo sends `cancel` first.
//
// The same message shape is what a future server-side bot reuses (spec 13.1).

import type { GameRecord } from '@sps/engine';
import type { Level } from './levels.js';
import type { SearchStats } from './search.js';

export type ToWorker =
  | { type: 'think'; record: GameRecord; level: Level; seed: number }
  | { type: 'cancel' };

export type FromWorker = { type: 'move'; move: string; stats: SearchStats };
