// Self-play harness — spec 9.6. Use it before any rules change and in CI.
//
// The first run of the finished AI should land near the numbers in spec 6. Large
// differences point to a rules bug before they point to an AI difference.

import { NotImplementedError } from '@sps/engine';
import { parseOptions } from './options.js';
import type { SimOptions, SimSummary } from './summary.js';

export { checkBalanceGuard, GUARD } from './summary.js';
export type { GuardVerdict, SimOptions, SimSummary } from './summary.js';
export { parseOptions } from './options.js';

export function runSimulation(_options: SimOptions): SimSummary {
  throw new NotImplementedError('runSimulation', '9.6');
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const summary = runSimulation(options);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main();
}
