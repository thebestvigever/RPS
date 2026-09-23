// pnpm bench match --a hard --b medium --games 200 --seed 1
// pnpm bench match --a hard --b medium --sprt --elo0 0 --elo1 5 --fast
// pnpm bench tactics --level hard
// pnpm bench diagnosis --level hard --games 20

import { VARIANT_IDS } from '@sps/engine';
import type { VariantId } from '@sps/engine';
import { LEVELS } from '@sps/ai';
import type { Level } from '@sps/ai';
import { fastControl, runMatch } from './match.js';
import type { MatchOptions } from './match.js';
import { runTactics } from './tactics.js';
import { branchingFactor, depthAndSpeed, hangingRate } from './diagnosis.js';

function isLevel(value: string): value is Level {
  return Object.hasOwn(LEVELS, value);
}

function isVariantId(value: string): value is VariantId {
  return (VARIANT_IDS as string[]).includes(value);
}

function parseFlags(argv: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined || !arg.startsWith('--')) continue;
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[name] = next;
      i++;
    } else {
      flags[name] = 'true';
    }
  }
  return flags;
}

function requireLevel(flags: Record<string, string>, flag: string, fallback?: Level): Level {
  const value = flags[flag] ?? fallback;
  if (value === undefined || !isLevel(value)) {
    throw new Error(`--${flag} must be one of ${Object.keys(LEVELS).join(', ')}`);
  }
  return value;
}

function requireVariant(flags: Record<string, string>): VariantId {
  const value = flags.variant;
  if (value === undefined) return 'original';
  if (!isVariantId(value)) throw new Error(`--variant must be one of ${VARIANT_IDS.join(', ')}`);
  return value;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function runMatchCommand(argv: readonly string[]): void {
  const flags = parseFlags(argv);
  const a = requireLevel(flags, 'a');
  const b = requireLevel(flags, 'b');
  const fast = flags.fast === 'true';
  const useSprt = flags.sprt === 'true';

  const options: MatchOptions = {
    variant: requireVariant(flags),
    configA: fast ? fastControl(a) : a,
    configB: fast ? fastControl(b) : b,
    seed: flags.seed ? Number(flags.seed) : 1,
    ...(flags.games ? { games: Number(flags.games) } : {}),
    ...(flags.maxGames ? { maxGames: Number(flags.maxGames) } : {}),
    ...(useSprt
      ? {
          sprt: {
            elo0: flags.elo0 ? Number(flags.elo0) : 0,
            elo1: flags.elo1 ? Number(flags.elo1) : 5,
            alpha: flags.alpha ? Number(flags.alpha) : 0.05,
            beta: flags.beta ? Number(flags.beta) : 0.05,
          },
        }
      : {}),
  };

  print(runMatch(options));
}

function runTacticsCommand(argv: readonly string[]): void {
  const flags = parseFlags(argv);
  const level = requireLevel(flags, 'level', 'hard');
  const seed = flags.seed ? Number(flags.seed) : 1;
  print(runTactics(level, undefined, seed));
}

function runDiagnosisCommand(argv: readonly string[]): void {
  const flags = parseFlags(argv);
  const metric = flags.metric ?? 'all';
  const level = requireLevel(flags, 'level', 'hard');
  const variant = requireVariant(flags);
  const seed = flags.seed ? Number(flags.seed) : 1;

  const out: Record<string, unknown> = {};

  if (metric === 'hanging' || metric === 'all') {
    out.hanging = hangingRate({ variant, level, games: flags.games ? Number(flags.games) : 20, seed });
  }
  if (metric === 'speed' || metric === 'all') {
    out.speed = depthAndSpeed({ variant, seed });
  }
  if (metric === 'branching' || metric === 'all') {
    out.branching = branchingFactor({
      variant,
      seed,
      ...(flags.maxDepth ? { maxDepth: Number(flags.maxDepth) } : {}),
    });
  }

  print(out);
}

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case 'match':
    runMatchCommand(rest);
    break;
  case 'tactics':
    runTacticsCommand(rest);
    break;
  case 'diagnosis':
    runDiagnosisCommand(rest);
    break;
  default:
    process.stderr.write('usage: pnpm bench <match|tactics|diagnosis> [flags]\n');
    process.exit(1);
}
