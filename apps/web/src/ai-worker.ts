// Spawns the real @sps/ai worker (spec 9.4) from its actual source file,
// bypassing @sps/ai's package export map — that only exposes the package's
// pure API (`.`), not this DOM-touching entry point, and shouldn't: a Worker
// is a browser thing, and @sps/ai is meant to run in Node too (the sim
// harness does). Vite bundles it from this relative URL like any other
// module in the build graph, imports and all.
export function createAiWorker(): Worker {
  return new Worker(new URL('../../../packages/ai/src/worker.ts', import.meta.url), { type: 'module' });
}
