// Generates the human-judgment half of gate 2 (docs/VISUAL_SYSTEM.md 9): can
// a person tell rock from paper from scissors, and owner from owner, in
// greyscale, at the sizes a phone actually renders?
//
// That question is not something this package can answer with an assertion —
// it is genuinely a visual call, the same one docs/VISUAL_SYSTEM.md 8 leaves
// to Vig ("let the gate decide, not taste"). What IS automatable is
// generating the artifact to look at: every type, both owners, both render
// modes, desaturated, at the two sizes that matter — 39.8px (a 358px phone
// board's square) and 62.2px (a 560px Rail board's square), the two rows of
// docs/VISUAL_SYSTEM.md 2's breakpoint table on either side of the knockout
// threshold.
//
// This test only asserts the sheet renders and is written to disk. Passing
// it is not the same as gate 2 passing.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toGreyscale } from '../src/contrast.js';
import { renderMode } from '../src/ownership.js';
import { renderPieceSample } from '../src/render.js';
import { SWATCHES, THEMES } from '../src/themes.js';
import { el, group, text } from '../src/svg.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'fixtures');
const OUT_FILE = join(OUT_DIR, 'greyscale-review.svg');

const TYPES = ['rock', 'paper', 'scissors'] as const;
const SQUARES = [
  { label: '358px board (390 viewport) - knockout', squarePx: 358 / 9 },
  { label: '560px board (Rail) - standalone', squarePx: 560 / 9 },
];

function buildSheet(): string {
  const theme = THEMES['field-notes'];
  const squareColor = toGreyscale(theme.square);
  const you = toGreyscale(SWATCHES['field-notes'].you[0]!);
  const opponent = toGreyscale(SWATCHES['field-notes'].opponent[0]!);

  // Cells are drawn at a fixed, comfortably-inspectable 96px, using the
  // render MODE decided by the real squarePx above (39.8px / 62.2px) — the
  // fraction-based geometry keeps the true proportions, just legible.
  const cell = 96;
  const gap = 16;
  const labelW = 200;
  const rows = SQUARES.length * 2; // you + opponent per square size
  const cols = TYPES.length;
  const width = labelW + cols * (cell + gap);
  const height = 60 + rows * (cell + gap);

  const parts: string[] = [
    el('rect', { x: 0, y: 0, width, height, fill: '#ffffff' }),
    text({ x: 16, y: 28, 'font-family': 'monospace', 'font-size': 14, fill: '#000' }, 'M3a greyscale review — Cut stone, both render modes'),
  ];

  let rowIndex = 0;
  for (const { label, squarePx } of SQUARES) {
    const mode = renderMode(squarePx);
    for (const [ownerLabel, color, isOpponent] of [
      ['you', you, false],
      ['opponent', opponent, true],
    ] as const) {
      const y = 60 + rowIndex * (cell + gap);
      parts.push(
        text(
          { x: 16, y: y + cell / 2, 'font-family': 'monospace', 'font-size': 11, fill: '#000' },
          `${label} / ${ownerLabel} / ${mode}`,
        ),
      );
      TYPES.forEach((type, col) => {
        const x = labelW + col * (cell + gap);
        const piece = renderPieceSample({
          type,
          family: 'cut-stone',
          mode,
          squarePx: cell,
          color,
          squareColor,
          isOpponent,
        });
        parts.push(group('g', { transform: `translate(${x},${y})` }, piece));
        parts.push(
          text(
            { x: x + cell / 2, y: y + cell + 12, 'font-family': 'monospace', 'font-size': 10, fill: '#666', 'text-anchor': 'middle' },
            type,
          ),
        );
      });
      rowIndex++;
    }
  }

  return group('svg', { xmlns: 'http://www.w3.org/2000/svg', width, height, viewBox: `0 0 ${width} ${height}` }, parts.join(''));
}

describe('greyscale review sheet', () => {
  it('renders without throwing and writes test/fixtures/greyscale-review.svg', () => {
    const svg = buildSheet();
    expect(svg).toContain('<svg');
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_FILE, svg, 'utf-8');
    expect(existsSync(OUT_FILE)).toBe(true);
  });
});
