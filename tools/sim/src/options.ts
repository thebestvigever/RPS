import { VARIANT_IDS } from '@sps/engine';
import type { VariantId } from '@sps/engine';
import { LEVELS } from '@sps/ai';
import type { Level } from '@sps/ai';
import type { SimOptions } from './summary.js';

const DEFAULTS: SimOptions = {
  variant: 'original',
  blue: 'medium',
  red: 'medium',
  games: 200,
  seed: 1,
};

function isVariantId(value: string): value is VariantId {
  return (VARIANT_IDS as string[]).includes(value);
}

function isLevel(value: string): value is Level {
  return Object.hasOwn(LEVELS, value);
}

/** pnpm sim --variant original --blue medium --red medium --games 200 --seed 1 */
export function parseOptions(argv: readonly string[]): SimOptions {
  const options: SimOptions = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined) break;
    if (value === undefined) throw new Error(`${flag} needs a value`);

    switch (flag) {
      case '--variant':
        if (!isVariantId(value)) {
          throw new Error(`unknown variant "${value}" — try ${VARIANT_IDS.join(', ')}`);
        }
        options.variant = value;
        break;
      case '--blue':
      case '--red': {
        if (!isLevel(value)) {
          throw new Error(`unknown level "${value}" — try easy, medium, hard`);
        }
        options[flag === '--blue' ? 'blue' : 'red'] = value;
        break;
      }
      case '--games':
      case '--seed': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} needs a positive integer`);
        options[flag === '--games' ? 'games' : 'seed'] = n;
        break;
      }
      default:
        throw new Error(`unknown flag "${flag}"`);
    }
  }

  return options;
}

export { DEFAULTS };
