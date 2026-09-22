// The renderer — docs/VISUAL_SYSTEM.md 4 and 8 (M3a): a pure function from a
// position, theme, family, player colours and viewer side to an SVG string.
// No engine mutation, no DOM, no timers — same inputs always give the same
// markup, which is what lets this render directly against the engine's own
// fixtures in test/render.test.ts rather than needing a running game.
//
// M3a's scope only: tokens, coordinates, corner tints, the last-move tint and
// the flame placeholder. Selection, legal-move dots, capture rings and motion
// are M3b (docs/VISUAL_SYSTEM.md 8) and are not drawn here yet.

import {
  EMPTY,
  FILES,
  FILE_LETTERS,
  RANKS,
  colOf,
  decodePiece,
  fromFen,
  homeSquares,
  other,
  rowOf,
} from '@sps/engine';
import type { PieceType, Side, Square, VariantConfig } from '@sps/engine';

import { CORNER_TINT_ALPHA, LAST_MOVE_TINT_ALPHA, THEMES, type ThemeId } from './themes.js';
import { familyMark, type Family, type FamilyId } from './families.js';
import { renderMode, type RenderMode } from './ownership.js';
import {
  KNOCKOUT_DISC_FRACTION,
  KNOCKOUT_MARK_FRACTION,
  KNOCKOUT_RING_STROKE_FRACTION,
  NEUTRAL_RING_DASH_FRACTION,
  NEUTRAL_RING_DIAMETER_FRACTION,
  STANDALONE_BOX_FRACTION,
  STANDALONE_RING_DIAMETER_FRACTION,
  STANDALONE_RING_STROKE_FRACTION,
} from './sizing.js';
import { el, group, round, text } from './svg.js';

export interface Appearance {
  /**
   * Which literal colour paints Blue and Red pieces. "My colour" and "the
   * colour I see my opponent in" (spec 2) are a viewer-relative choice the
   * app resolves to this before calling render — this package only knows
   * Sides and a viewer, never a first-person "me" independent of one.
   */
  sideColors: Record<Side, string>;
  /** Which Side this render is FOR — decides which pieces get the opponent's
   * ring or inverted disc (docs/VISUAL_SYSTEM.md 2). Board orientation is a
   * separate, later concern (spec 10.2); this alone does not flip the board. */
  viewerSide: Side;
}

export interface RenderOptions {
  fen: string;
  variant: VariantConfig;
  /** The board's rendered width in px (spec 10.2: min(viewport - 32, 640)). Square, so this is also its height. */
  boardPx: number;
  theme: ThemeId;
  family: FamilyId;
  appearance: Appearance;
  /** Toggleable, spec 10.2. Default true. */
  coordinates?: boolean;
  /** Origin and destination of the last move, spec 10.2 / 10.5. */
  lastMove?: { from: Square; to: Square } | null;
}

export function renderBoard(options: RenderOptions): string {
  const {
    fen,
    variant,
    boardPx,
    theme: themeId,
    family: familyId,
    appearance,
    coordinates = true,
    lastMove = null,
  } = options;

  const themeTokens = THEMES[themeId];
  if (!themeTokens) throw new Error(`Unknown theme: ${themeId}`);
  const mark = familyMark(familyId);
  const state = fromFen(fen, variant);
  const squarePx = boardPx / FILES;
  const mode = renderMode(squarePx);
  const opponentSide = other(appearance.viewerSide);

  const layers = [
    backgroundLayer(boardPx, squarePx, themeTokens.square, themeTokens.grid),
    cornerTintLayer(variant, appearance.sideColors, squarePx),
    lastMove ? lastMoveLayer(lastMove, themeTokens.ink, squarePx) : '',
    flameLayer(boardPx, themeTokens.ink),
    piecesLayer(
      state.board,
      mark,
      mode,
      appearance.sideColors,
      opponentSide,
      themeTokens.square,
      themeTokens.neutral,
      squarePx,
    ),
    coordinates ? coordinatesLayer(boardPx, squarePx, themeTokens.muted, themeTokens.fonts.mono) : '',
  ];

  return group(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${round(boardPx)} ${round(boardPx)}`,
      width: round(boardPx),
      height: round(boardPx),
      role: 'img',
      'aria-label': `${variant.name} board`,
    },
    layers.join(''),
  );
}

function squareXY(square: Square, squarePx: number): { x: number; y: number } {
  // Row 0 is rank 9 (top) in the engine's own numbering (board.ts), so this
  // needs no flip to put Blue's corner (a1, row 8) at the bottom — spec 10.2's
  // default orientation.
  return { x: colOf(square) * squarePx, y: rowOf(square) * squarePx };
}

function centredOffset(squarePx: number, boxPx: number): number {
  return (squarePx - boxPx) / 2;
}

function backgroundLayer(boardPx: number, squarePx: number, squareColor: string, gridColor: string): string {
  const fill = el('rect', { x: 0, y: 0, width: round(boardPx), height: round(boardPx), fill: squareColor });
  const lines: string[] = [];
  for (let i = 0; i <= FILES; i++) {
    const pos = round(i * squarePx);
    lines.push(el('line', { x1: pos, y1: 0, x2: pos, y2: round(boardPx), stroke: gridColor, 'stroke-width': 1 }));
    lines.push(el('line', { x1: 0, y1: pos, x2: round(boardPx), y2: pos, stroke: gridColor, 'stroke-width': 1 }));
  }
  return group('g', {}, fill + lines.join(''));
}

/**
 * Each side's HOME square(s) are tinted in that side's colour (spec 10.2:
 * "Blue's a1 blue, Red's i9 red"). `homeSquares` already generalises to the
 * 2x2 Corner variant's four-square blocks, so this needs no per-variant
 * branch (CLAUDE.md: variants are data).
 */
function cornerTintLayer(variant: VariantConfig, sideColors: Record<Side, string>, squarePx: number): string {
  const rects: string[] = [];
  for (const side of ['blue', 'red'] as const) {
    for (const square of homeSquares(variant, side)) {
      const { x, y } = squareXY(square, squarePx);
      rects.push(
        el('rect', {
          x: round(x),
          y: round(y),
          width: round(squarePx),
          height: round(squarePx),
          fill: sideColors[side],
          'fill-opacity': CORNER_TINT_ALPHA,
        }),
      );
    }
  }
  return group('g', {}, rects.join(''));
}

function lastMoveLayer(lastMove: { from: Square; to: Square }, ink: string, squarePx: number): string {
  const rects = [lastMove.from, lastMove.to].map((square) => {
    const { x, y } = squareXY(square, squarePx);
    return el('rect', {
      x: round(x),
      y: round(y),
      width: round(squarePx),
      height: round(squarePx),
      fill: ink,
      'fill-opacity': LAST_MOVE_TINT_ALPHA,
    });
  });
  return group('g', {}, rects.join(''));
}

/**
 * The centre watermark. Not supplied (README, Assets) — this is the same
 * striped placeholder disc the prototype ships, minus its "flame" text
 * label, which was a note to whoever was reading the prototype, not
 * user-facing copy (docs/VISUAL_SYSTEM.md 10).
 */
function flameLayer(boardPx: number, ink: string): string {
  const cx = boardPx / 2;
  const cy = boardPx / 2;
  const r = boardPx * 0.11; // 22% of board width, diameter
  const stripe = boardPx * (7 / 480); // the prototype's 7px stripe, scaled off its 480px preview

  const patternId = 'flame-hatch';
  const defs = group(
    'defs',
    {},
    group(
      'pattern',
      {
        id: patternId,
        width: round(stripe),
        height: round(stripe),
        patternUnits: 'userSpaceOnUse',
        patternTransform: 'rotate(45)',
      },
      el('line', { x1: 0, y1: 0, x2: 0, y2: round(stripe), stroke: ink, 'stroke-width': 1 }),
    ),
  );

  const hatch = el('circle', { cx: round(cx), cy: round(cy), r: round(r), fill: `url(#${patternId})` });
  const ring = el('circle', {
    cx: round(cx),
    cy: round(cy),
    r: round(r),
    fill: 'none',
    stroke: ink,
    'stroke-width': 1,
  });

  return defs + group('g', { opacity: 0.07 }, hatch + ring);
}

function coordinatesLayer(boardPx: number, squarePx: number, muted: string, fontFamily: string): string {
  const labels: string[] = [];
  const fontSize = round(Math.max(8, boardPx * (10 / 640))); // 10px at the spec's 640px max board
  const pad = fontSize * 0.35;

  for (let col = 0; col < FILES; col++) {
    const x = col * squarePx + pad;
    labels.push(
      text(
        { x: round(x), y: round(boardPx - pad), 'font-family': fontFamily, 'font-size': fontSize, fill: muted },
        FILE_LETTERS[col]!,
      ),
    );
  }
  for (let row = 0; row < RANKS; row++) {
    const rank = RANKS - row;
    const y = row * squarePx + fontSize + pad * 0.5;
    labels.push(
      text(
        { x: round(pad), y: round(y), 'font-family': fontFamily, 'font-size': fontSize, fill: muted },
        String(rank),
      ),
    );
  }
  return group('g', {}, labels.join(''));
}

/** Each piece's group carries `data-square` — a stable hook for M3b's click
 * and drag targets, and for `test/render.test.ts` to count pieces without
 * depending on the mark's own internal markup. */
function piecesLayer(
  board: Int8Array,
  family: Family,
  mode: RenderMode,
  sideColors: Record<Side, string>,
  opponentSide: Side,
  squareColor: string,
  neutralColor: string,
  squarePx: number,
): string {
  const pieces: string[] = [];
  for (let square = 0; square < board.length; square++) {
    const code = board[square]!;
    if (code === EMPTY) continue;
    const piece = decodePiece(code);
    if (!piece) continue;
    const { x, y } = squareXY(square, squarePx);
    const markup =
      piece.owner === 'neutral'
        ? neutralPiece(piece.type, family, neutralColor, squarePx)
        : sidePiece(
            piece.type,
            family,
            mode,
            sideColors[piece.owner],
            piece.owner === opponentSide,
            squareColor,
            squarePx,
          );
    pieces.push(
      group('g', { transform: `translate(${round(x)},${round(y)})`, 'data-square': square }, markup),
    );
  }
  return group('g', {}, pieces.join(''));
}

function sidePiece(
  type: PieceType,
  family: Family,
  mode: RenderMode,
  color: string,
  isOpponent: boolean,
  squareColor: string,
  squarePx: number,
): string {
  return mode === 'standalone'
    ? standalonePiece(type, family, color, isOpponent, squarePx)
    : knockoutPiece(type, family, color, isOpponent, squareColor, squarePx);
}

/**
 * Standalone mode (mark >= 32px): the mark filled with the side's colour.
 * The opponent's piece additionally carries a full-circle ring — a circle,
 * not a silhouette-hugging outline, so the clearance to the mark stays
 * generous regardless of the mark's own shape (docs/VISUAL_SYSTEM.md 2).
 */
function standalonePiece(type: PieceType, family: Family, color: string, isOpponent: boolean, squarePx: number): string {
  const boxPx = squarePx * STANDALONE_BOX_FRACTION;
  const offset = centredOffset(squarePx, boxPx);
  const mark = group('g', { transform: `translate(${round(offset)},${round(offset)})` }, family[type](boxPx, color));

  if (!isOpponent) return mark;

  const ringDiameter = squarePx * STANDALONE_RING_DIAMETER_FRACTION;
  const ringOffset = centredOffset(squarePx, ringDiameter);
  const ringStroke = Math.max(1, squarePx * STANDALONE_RING_STROKE_FRACTION);
  const ring = el('circle', {
    cx: round(ringOffset + ringDiameter / 2),
    cy: round(ringOffset + ringDiameter / 2),
    r: round((ringDiameter - ringStroke) / 2),
    fill: 'none',
    stroke: color,
    'stroke-width': round(ringStroke),
  });

  return group('g', {}, ring + mark);
}

/**
 * Knockout mode (mark < 32px, docs/VISUAL_SYSTEM.md 2): "yours" is a filled
 * disc with the mark punched out in the square's own colour; the opponent
 * inverts to an outlined disc with the mark filled in (README's Seal family:
 * "the opponent inverts to an outlined disc"). Filled-disc-with-hollow-mark
 * versus hollow-disc-with-filled-mark is a much bigger visual difference at
 * 15px than a thin ring is.
 *
 * Painting the knocked-out mark in the square's literal colour, rather than
 * masking, is a deliberate simplification: the disc sits directly on the
 * square (nothing else is layered under it here), so painting over in the
 * square's colour reads as punched through without an SVG `<mask>`.
 */
function knockoutPiece(
  type: PieceType,
  family: Family,
  color: string,
  isOpponent: boolean,
  squareColor: string,
  squarePx: number,
): string {
  const discDiameter = squarePx * KNOCKOUT_DISC_FRACTION;
  const discOffset = centredOffset(squarePx, discDiameter);
  const discCenter = discOffset + discDiameter / 2;
  const discStroke = Math.max(1, squarePx * KNOCKOUT_RING_STROKE_FRACTION);

  const disc = el('circle', {
    cx: round(discCenter),
    cy: round(discCenter),
    r: round(isOpponent ? (discDiameter - discStroke) / 2 : discDiameter / 2),
    fill: isOpponent ? 'none' : color,
    stroke: isOpponent ? color : undefined,
    'stroke-width': isOpponent ? round(discStroke) : undefined,
  });

  const markPx = discDiameter * KNOCKOUT_MARK_FRACTION;
  const markOffset = centredOffset(squarePx, markPx);
  const markFill = isOpponent ? color : squareColor;
  const mark = group('g', { transform: `translate(${round(markOffset)},${round(markOffset)})` }, family[type](markPx, markFill));

  return group('g', {}, disc + mark);
}

/**
 * Neutral pieces: the family's silhouette in the theme's desaturated
 * neutral colour, with a DASHED ring rather than the solid opponent ring —
 * spec 10.3's cue, kept the same at every render mode since it is already
 * distinct from both the "yours" and "opponent" treatments above.
 */
function neutralPiece(type: PieceType, family: Family, color: string, squarePx: number): string {
  const boxPx = squarePx * STANDALONE_BOX_FRACTION;
  const offset = centredOffset(squarePx, boxPx);
  const mark = group('g', { transform: `translate(${round(offset)},${round(offset)})` }, family[type](boxPx, color));

  const ringDiameter = squarePx * NEUTRAL_RING_DIAMETER_FRACTION;
  const ringOffset = centredOffset(squarePx, ringDiameter);
  const ringStroke = Math.max(1, squarePx * STANDALONE_RING_STROKE_FRACTION);
  const dash = Math.max(1, squarePx * NEUTRAL_RING_DASH_FRACTION);
  const ring = el('circle', {
    cx: round(ringOffset + ringDiameter / 2),
    cy: round(ringOffset + ringDiameter / 2),
    r: round((ringDiameter - ringStroke) / 2),
    fill: 'none',
    stroke: color,
    'stroke-width': round(ringStroke),
    'stroke-dasharray': `${round(dash)} ${round(dash)}`,
  });

  return group('g', {}, ring + mark);
}

export interface PieceSampleOptions {
  type: PieceType;
  family: FamilyId;
  mode: RenderMode;
  /** The square's own size in px — this decides mark and disc sizes exactly as `renderBoard` would. */
  squarePx: number;
  color: string;
  squareColor: string;
  isOpponent: boolean;
}

/**
 * One piece, alone on a square-coloured background — the same drawing
 * `renderBoard` uses, without a whole board around it. Used by the M3a
 * greyscale review sheet (test/greyscale-review.test.ts, docs/VISUAL_SYSTEM.md
 * 9) and reusable later for an appearance picker's family/theme previews.
 */
export function renderPieceSample(options: PieceSampleOptions): string {
  const { type, family: familyId, mode, squarePx, color, squareColor, isOpponent } = options;
  const family = familyMark(familyId);
  const piece = sidePiece(type, family, mode, color, isOpponent, squareColor, squarePx);
  const background = el('rect', { x: 0, y: 0, width: round(squarePx), height: round(squarePx), fill: squareColor });

  return group(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${round(squarePx)} ${round(squarePx)}`,
      width: round(squarePx),
      height: round(squarePx),
    },
    background + piece,
  );
}
