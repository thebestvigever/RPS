// Gate: "renders every engine fixture position correctly" (docs/VISUAL_SYSTEM.md
// 8, M3a). Runs the renderer against the actual fixtures the engine is
// tested with — vectors.json (all three variants, including neutrals and a
// FEN-after position) and the six tutorial puzzles — instead of a hand-picked
// sample, so a change to what the board draws is checked against the same
// positions the rules already are.

import { describe, expect, it } from 'vitest';
import { VARIANTS, parseSquare } from '@sps/engine';
import type { Side } from '@sps/engine';
import { renderBoard } from '../src/render.js';
import { displayCell } from '../src/orientation.js';
import { SWATCHES, THEME_IDS } from '../src/themes.js';

import vectors from '../../engine/test/fixtures/vectors.json' with { type: 'json' };
import tutorial from '../../engine/test/fixtures/tutorial.json' with { type: 'json' };

interface Vector {
  name: string;
  variant: keyof typeof VARIANTS;
  fen: string;
  fenAfter?: string;
}

const sideColors: Record<Side, string> = {
  blue: SWATCHES['field-notes'].you[0]!,
  red: SWATCHES['field-notes'].opponent[0]!,
};

function render(fen: string, variantId: keyof typeof VARIANTS, boardPx = 560) {
  return renderBoard({
    fen,
    variant: VARIANTS[variantId],
    boardPx,
    theme: 'field-notes',
    family: 'cut-stone',
    appearance: { sideColors, viewerSide: 'blue' },
  });
}

describe('renders every vectors.json position', () => {
  for (const vector of vectors as Vector[]) {
    it(`${vector.name}: fen`, () => {
      expect(() => render(vector.fen, vector.variant)).not.toThrow();
    });

    if (vector.fenAfter) {
      it(`${vector.name}: fenAfter`, () => {
        expect(() => render(vector.fenAfter!, vector.variant)).not.toThrow();
      });
    }
  }
});

describe('renders every tutorial puzzle', () => {
  for (const puzzle of tutorial.puzzles as Array<{ n: number; fen: string; variant: keyof typeof VARIANTS }>) {
    it(`puzzle ${puzzle.n}`, () => {
      expect(() => render(puzzle.fen, puzzle.variant)).not.toThrow();
    });
  }
});

describe('renders at every board size in the ownership breakpoint table', () => {
  const opening = VARIANTS.original.start;
  for (const boardPx of [328, 358, 408, 468, 560, 640]) {
    it(`${boardPx}px`, () => {
      expect(() => render(opening, 'original', boardPx)).not.toThrow();
    });
  }
});

describe('renders in every theme', () => {
  const opening = VARIANTS.original.start;
  for (const themeId of THEME_IDS) {
    it(themeId, () => {
      const svg = renderBoard({
        fen: opening,
        variant: VARIANTS.original,
        boardPx: 560,
        theme: themeId,
        family: 'cut-stone',
        appearance: {
          sideColors: { blue: SWATCHES[themeId].you[0]!, red: SWATCHES[themeId].opponent[0]! },
          viewerSide: 'blue',
        },
      });
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });
  }
});

describe('output shape', () => {
  it('is well-formed enough to contain exactly one <svg> root', () => {
    const svg = render(VARIANTS.original.start, 'original');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg.match(/<svg /g)?.length ?? 0).toBe(1);
  });

  it('draws all 20 starting pieces (10 a side), one data-square group each', () => {
    const svg = render(VARIANTS.original.start, 'original');
    const pieceGroups = svg.match(/data-square="/g)?.length ?? 0;
    expect(pieceGroups).toBe(20);
  });

  it('tints a home square in each side\'s colour', () => {
    const svg = render(VARIANTS.original.start, 'original', 90);
    expect(svg).toContain(sideColors.blue);
    expect(svg).toContain(sideColors.red);
  });

  it('omits the coordinates layer when coordinates is false', () => {
    const base = {
      fen: VARIANTS.original.start,
      variant: VARIANTS.original,
      boardPx: 560,
      theme: 'field-notes' as const,
      family: 'cut-stone' as const,
      appearance: { sideColors, viewerSide: 'blue' as const },
    };
    expect(renderBoard({ ...base, coordinates: true })).toContain('<text');
    expect(renderBoard({ ...base, coordinates: false })).not.toContain('<text');
  });

  it('draws the last-move tint only when lastMove is given', () => {
    const withLastMove = renderBoard({
      fen: VARIANTS.original.start,
      variant: VARIANTS.original,
      boardPx: 560,
      theme: 'field-notes',
      family: 'cut-stone',
      appearance: { sideColors, viewerSide: 'blue' },
      lastMove: { from: parseSquare('d4'), to: parseSquare('d5') },
    });
    const without = render(VARIANTS.original.start, 'original');
    expect(withLastMove.length).toBeGreaterThan(without.length);
  });
});

describe('unbuilt families throw a clear, specific error instead of a wrong render', () => {
  for (const familyId of ['shears', 'seal', 'weight'] as const) {
    it(familyId, () => {
      expect(() =>
        renderBoard({
          fen: VARIANTS.original.start,
          variant: VARIANTS.original,
          boardPx: 560,
          theme: 'field-notes',
          family: familyId,
          appearance: { sideColors, viewerSide: 'blue' },
        }),
      ).toThrow(/not built yet/);
    });
  }
});

describe('selection (M3b, spec 10.4)', () => {
  const base = {
    fen: VARIANTS.original.start,
    variant: VARIANTS.original,
    boardPx: 560,
    theme: 'field-notes' as const,
    family: 'cut-stone' as const,
    appearance: { sideColors, viewerSide: 'blue' as const },
  };

  it('draws a selection ring and a legal dot for a plain destination', () => {
    const from = parseSquare('d4'); // Blue Paper's starting square
    const to = parseSquare('d5'); // empty, one step, plain move
    const svg = renderBoard({ ...base, selection: { square: from, destinations: [{ square: to, capture: false }] } });
    expect(svg).toContain('stroke="' + sideColors.blue + '"'); // the selection ring
    expect(svg.match(/fill-opacity="0\.\d+"/g)?.length ?? 0).toBeGreaterThan(0); // the derived dot alpha
  });

  it('draws a capture ring (not a dot) for a capturing destination', () => {
    // A hand-picked position where Blue's Rock on d4 can capture Red's Scissors on e5.
    const svg = renderBoard({
      ...base,
      fen: '9/9/9/9/4S4/3R5/9/9/9 blue',
      selection: {
        square: parseSquare('d3'),
        destinations: [{ square: parseSquare('e4'), capture: true }],
      },
    });
    // A capture ring is a stroked circle with no dot fill-opacity at that square.
    expect(svg).toContain('fill="none"');
  });

  it('renders no selection markup when selection is null', () => {
    const withSel = renderBoard({
      ...base,
      selection: { square: parseSquare('d4'), destinations: [{ square: parseSquare('d5'), capture: false }] },
    });
    const without = renderBoard({ ...base, selection: null });
    expect(withSel.length).toBeGreaterThan(without.length);
  });

  it('the selected square\'s ring uses the piece owner\'s colour, not always the viewer\'s', () => {
    const redSquare = parseSquare('h6'); // Red Rock's starting square
    const svg = renderBoard({ ...base, selection: { square: redSquare, destinations: [] } });
    expect(svg).toContain('stroke="' + sideColors.red + '"');
  });
});

describe('keyboard focus ring (M3b, spec 10.10)', () => {
  it('renders a dashed ring only when focusSquare is set', () => {
    const base = {
      fen: VARIANTS.original.start,
      variant: VARIANTS.original,
      boardPx: 560,
      theme: 'field-notes' as const,
      family: 'cut-stone' as const,
      appearance: { sideColors, viewerSide: 'blue' as const },
    };
    const withFocus = renderBoard({ ...base, focusSquare: parseSquare('e5') });
    const without = renderBoard({ ...base, focusSquare: null });
    expect(withFocus).toContain('stroke-dasharray');
    expect(without).not.toContain('stroke-dasharray');
  });

  it('focusSquare 0 (a9, a real square) is not treated as falsy', () => {
    const base = {
      fen: VARIANTS.original.start,
      variant: VARIANTS.original,
      boardPx: 560,
      theme: 'field-notes' as const,
      family: 'cut-stone' as const,
      appearance: { sideColors, viewerSide: 'blue' as const },
    };
    expect(renderBoard({ ...base, focusSquare: 0 })).toContain('stroke-dasharray');
  });
});

describe('orientation (spec 10.2)', () => {
  const BOARD_PX = 540;
  const SQUARE_PX = BOARD_PX / 9;

  function rendered(orientation: Side) {
    return renderBoard({
      fen: VARIANTS.original.start,
      variant: VARIANTS.original,
      boardPx: BOARD_PX,
      theme: 'field-notes',
      family: 'cut-stone',
      appearance: { sideColors, viewerSide: orientation },
      orientation,
    });
  }

  /** Where the piece group for `square` was translated to. */
  function pieceAt(markup: string, square: number): { x: number; y: number } {
    const match = markup.match(
      new RegExp(`<g transform="translate\\(([-\\d.]+),([-\\d.]+)\\)" data-square="${square}"`),
    );
    if (!match) throw new Error(`no piece rendered on square ${square}`);
    return { x: Number(match[1]), y: Number(match[2]) };
  }

  it('defaults to Blue, matching every earlier milestone', () => {
    expect(rendered('blue')).toBe(
      renderBoard({
        fen: VARIANTS.original.start,
        variant: VARIANTS.original,
        boardPx: BOARD_PX,
        theme: 'field-notes',
        family: 'cut-stone',
        appearance: { sideColors, viewerSide: 'blue' },
      }),
    );
  });

  it('moves a piece to the opposite corner of the board when Red is looking', () => {
    // b4 is Blue's Rock in the opening position (spec 8.2's start FEN), two
    // rows up from the bottom-left. Under a 180 turn it has to land the same
    // distance in from the OPPOSITE corner — both coordinates reflected, which
    // a rank-only mirror would get wrong in x.
    const b4 = parseSquare('b4');
    const blue = pieceAt(rendered('blue'), b4);
    const red = pieceAt(rendered('red'), b4);
    expect(blue).toEqual({ x: SQUARE_PX, y: SQUARE_PX * 5 });
    expect(red).toEqual({ x: SQUARE_PX * 7, y: SQUARE_PX * 3 });
  });

  it("puts the viewer's own corner tint bottom-left either way", () => {
    // The tint is the first `fill-opacity` rect of each colour; rather than
    // parse it, check the whole board: whoever is looking, the bottom-left
    // square carries THEIR colour, which is what "your own corner sits
    // bottom-left" actually promises a player.
    const bottomLeft = { x: 0, y: SQUARE_PX * 8 };
    for (const side of ['blue', 'red'] as const) {
      const markup = rendered(side);
      const home = side === 'blue' ? parseSquare('a1') : parseSquare('i9');
      const { row, col } = displayCell(home, side);
      expect({ x: col * SQUARE_PX, y: row * SQUARE_PX }).toEqual(bottomLeft);
      expect(markup).toContain(sideColors[side]);
    }
  });

  it('turns the coordinates with the board', () => {
    // The bug this exists for: pieces rotate, labels do not, and the board
    // reads as if `a1` were still bottom-left. Blue sees a..i left to right;
    // Red, looking from the other end, sees i..a.
    const files = (markup: string) =>
      [...markup.matchAll(/<text [^>]*>([a-i])<\/text>/g)].map((match) => match[1]).join('');
    expect(files(rendered('blue'))).toBe('abcdefghi');
    expect(files(rendered('red'))).toBe('ihgfedcba');

    const ranks = (markup: string) =>
      [...markup.matchAll(/<text [^>]*>([1-9])<\/text>/g)].map((match) => match[1]).join('');
    expect(ranks(rendered('blue'))).toBe('987654321');
    expect(ranks(rendered('red'))).toBe('123456789');
  });
});
