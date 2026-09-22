// The size breakpoint from docs/VISUAL_SYSTEM.md 2's table: every phone
// layout in the handoff lands in knockout mode, and everything from a small
// tablet up lands in standalone. This is the automated half of gate 2
// (docs/VISUAL_SYSTEM.md 9) — it proves the breakpoint lands where the doc
// says it does. It is NOT the human call on whether a knocked-out mark at
// ~15px actually separates rock from paper from scissors; that is
// test/fixtures/greyscale-review.svg, for a person to look at.

import { describe, expect, it } from 'vitest';
import { renderMode, standaloneMarkPx } from '../src/ownership.js';
import { RING_MIN_MARK_PX } from '../src/sizing.js';

// board width (px) -> expected mode, from docs/VISUAL_SYSTEM.md 2's table.
const CASES: Array<[name: string, boardPx: number, mode: 'standalone' | 'knockout']> = [
  ['360 viewport (328px board)', 328, 'knockout'],
  ['390 viewport (358px board) — spec 10.2\'s own phone reference', 358, 'knockout'],
  ['the handoff\'s own Bar layout (408px board)', 408, 'knockout'],
  ['430 viewport (398px board)', 398, 'knockout'],
  ['a small tablet (468px board)', 468, 'standalone'],
  ['Rail layout (560px board)', 560, 'standalone'],
  ['the spec\'s max board (640px)', 640, 'standalone'],
];

describe('renderMode matches docs/VISUAL_SYSTEM.md 2\'s breakpoint table', () => {
  for (const [name, boardPx, expected] of CASES) {
    it(`${name} -> ${expected}`, () => {
      const squarePx = boardPx / 9;
      expect(renderMode(squarePx)).toBe(expected);
    });
  }
});

describe('the breakpoint is where the doc says it is', () => {
  it('is exactly RING_MIN_MARK_PX, expressed as a square size', () => {
    const squarePx = RING_MIN_MARK_PX / (STANDALONE_BOX_FRACTION_FOR_TEST());
    expect(renderMode(squarePx)).toBe('standalone');
    expect(renderMode(squarePx - 0.01)).toBe('knockout');
  });
});

function STANDALONE_BOX_FRACTION_FOR_TEST(): number {
  // Re-derive it from the function under test rather than importing the
  // constant twice under two names — a square exactly at the boundary must
  // produce a mark exactly at RING_MIN_MARK_PX.
  const probeSquare = 100;
  return standaloneMarkPx(probeSquare) / probeSquare;
}
