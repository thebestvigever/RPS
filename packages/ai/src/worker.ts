// Web Worker entry point — spec 9.4, so search never blocks the board.
//
// app -> worker: { type: 'think', record, level, seed } | { type: 'cancel' }
// worker -> app: { type: 'move', move, stats }
//
// The search is synchronous, so `cancel` cannot interrupt one already running.
// What it does is mark the result stale so it is never posted: a new game or an
// undo sends `cancel` first, and the board must not then receive a move for the
// position it just left.

/// <reference lib="webworker" />

import { think } from './think.js';
import type { FromWorker, ToWorker } from './worker-protocol.js';

declare const self: DedicatedWorkerGlobalScope;

let generation = 0;

self.onmessage = (event: MessageEvent<ToWorker>): void => {
  const message = event.data;

  if (message.type === 'cancel') {
    generation++;
    return;
  }

  const mine = generation;
  let reply: FromWorker;
  try {
    reply = think(message.record, message.level, message.seed);
  } catch (error) {
    // A thrown search is a bug, not a move. Let it surface in the console
    // rather than posting something the board would try to play.
    setTimeout(() => {
      throw error;
    });
    return;
  }

  if (mine === generation) self.postMessage(reply);
};
