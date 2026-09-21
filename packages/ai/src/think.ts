// The worker's actual work, as a plain function — spec 9.4.
//
// The worker rebuilds the state from the record, so it never holds game state
// of its own. Keeping that as a pure function means it is testable in Node and
// reusable by a future server-side bot (13.1); `worker.ts` is only the wiring.

import { getVariant, moveToText, replay } from '@sps/engine';
import type { GameRecord } from '@sps/engine';
import { chooseMove } from './search.js';
import type { Level } from './levels.js';
import type { FromWorker } from './worker-protocol.js';

export function think(record: GameRecord, level: Level, seed: number): FromWorker {
  const variant = getVariant(record.variant);
  const { state } = replay(variant, record.moves);
  const { move, stats } = chooseMove(state, level, seed);
  return { type: 'move', move: moveToText(state, move), stats };
}
