// pnpm sim --variant original --blue medium --red medium --games 200 --seed 1

import { parseOptions } from './options.js';
import { runSimulation } from './index.js';
import { checkBalanceGuard } from './summary.js';

const options = parseOptions(process.argv.slice(2));
const summary = runSimulation(options);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

// At Medium against Medium the run is a balance check, so its verdict is the
// exit code — that is what makes it usable as a CI gate (spec 9.6).
if (options.blue === 'medium' && options.red === 'medium') {
  const verdict = checkBalanceGuard(summary);
  if (!verdict.pass) {
    process.stderr.write(`balance guard FAILED for ${options.variant}:\n`);
    for (const failure of verdict.failures) process.stderr.write(`  - ${failure}\n`);
    process.exit(1);
  }
  process.stderr.write(
    `balance guard passed for ${options.variant}: ` +
      `first player ${(verdict.firstPlayerShare * 100).toFixed(1)}% of decisive games, ` +
      `draws ${(verdict.drawRate * 100).toFixed(1)}%\n`,
  );
}
