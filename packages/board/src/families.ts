// Piece silhouettes — docs/VISUAL_SYSTEM.md 5, spec 10.3, CLAUDE.md ("draw
// original art").
//
// Every family is drawn as original SVG paths from the numeric geometry in
// the spec, not traced from the prototype's `clip-path` shapes — the
// prototype used CSS shapes only because it had no SVG pipeline (README's
// own fidelity note). Only Cut stone is built: M3 ships one family
// (docs/VISUAL_SYSTEM.md 8), and `familyMark` throws a clear error for the
// other three rather than shipping a half-finished silhouette. They are a
// data drop once M3 has been played and reviewed.

import { points, round } from './svg.js';
import { FamilyNotBuiltError } from './errors.js';

export type FamilyId = 'shears' | 'cut-stone' | 'seal' | 'weight';

export const FAMILY_IDS: readonly FamilyId[] = ['shears', 'cut-stone', 'seal', 'weight'];

export interface FamilyInfo {
  name: string;
  description: string;
}

export const FAMILY_INFO: Record<FamilyId, FamilyInfo> = {
  shears: {
    name: 'Shears',
    description: 'Literal objects: faceted boulder, folded sheet with a fold triangle, closed shears.',
  },
  'cut-stone': {
    name: 'Cut stone',
    description: 'Flat polygons, no shading — hexagon, folded sheet, closed shears as a single silhouette.',
  },
  seal: {
    name: 'Seal',
    description: 'Every piece is the same disc with the mark punched out; the opponent inverts to an outline.',
  },
  weight: {
    name: 'Weight',
    description: 'Abstract bars: three stacked (rock), one flat (paper), two crossed (scissors).',
  },
};

/** A silhouette drawn as SVG markup, filled with `fill`, inside a `size x size` box anchored at (0,0). */
export type MarkFn = (size: number, fill: string) => string;

export interface Family {
  rock: MarkFn;
  paper: MarkFn;
  scissors: MarkFn;
}

// --- Scissors: "identical in A, B, C — reviewed three times, use exactly
// this" (README 3). One continuous stroke per blade — tip, taper, shank, bow
// — and both blades rotate about the SAME pivot point, so they cross there.
//
// Rejected in review, so these are not rediscovered here: a single tapered
// polygon (reads as a pawn), detached blades with free-floating rings (reads
// as "V oo"), a non-square container (an elliptical bow), and a bow hole
// under ~4px (fills in and reads as a dot).

const PIVOT = { x: 0.5, y: 0.62 } as const; // fraction of the box (README's pivot dot position)
const BAR = { x: 0.44, y: 0, width: 0.12, height: 0.74 } as const; // fraction of the box, before rotation
const BLADE_ANGLE_DEG = 19;
const BOW_DIAMETER_OF_BAR_WIDTH = 2.5; // "width: 250% of bar width" (README 3)
const BOW_STROKE_FRACTION_OF_BAR_WIDTH = 0.2; // lands in the spec's 2-2.5px range at board sizes
const PIVOT_DOT_DIAMETER = 0.15; // fraction of the box (README 3)

type Point = readonly [number, number];

function rotate(px: number, py: number, cx: number, cy: number, deg: number): Point {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

function blade(size: number, sign: 1 | -1, fill: string): string {
  const cx = PIVOT.x * size;
  const cy = PIVOT.y * size;
  const deg = sign * BLADE_ANGLE_DEG;

  const barX = BAR.x * size;
  const barY = BAR.y * size;
  const barW = BAR.width * size;
  const barH = BAR.height * size;

  // Blade tip -> taper -> shank: clip-path polygon(50% 0, 100% 15%, 100% 100%,
  // 0 100%, 0 15%) read against the bar's own box, then rotated about the
  // pivot the two blades share.
  const pentagon: Point[] = (
    [
      [barX + barW * 0.5, barY],
      [barX + barW, barY + barH * 0.15],
      [barX + barW, barY + barH],
      [barX, barY + barH],
      [barX, barY + barH * 0.15],
    ] as Point[]
  ).map(([x, y]) => rotate(x, y, cx, cy, deg));

  // The bow: `left:50%; top:100%` of the bar's own box (its bottom-centre),
  // sized 250% of the bar's width, then `translate(-50%, 42%)` of the bow's
  // OWN size — CSS translate resolves against the translated element, not
  // its parent. Working through what that places where the CENTRE ends up:
  // translate(-50%, _) always recentres a `left:50%`-anchored box
  // horizontally, so the x-shift and the recentring cancel; the y-shift does
  // not cancel, because `top:100%` already anchored the TOP edge at the
  // bar's bottom, and centring within the bow's own box adds another half
  // its height on top of the 42% the translate moved it by. Net: the bow's
  // centre sits (0.42 + 0.5) = 92% of its own diameter below the bar's
  // bottom edge, not merely centred on it — a bar's-length-worth of
  // separation from the pivot, which is what gives the two loops the gap
  // between them a real pair of finger holes needs. Getting only as far as
  // "centred on the bottom edge" is what first produced two loops nearly
  // concentric with each other: correct at the pivot, wrong at the bow.
  const bowDiameter = barW * BOW_DIAMETER_OF_BAR_WIDTH;
  const bowRadius = bowDiameter / 2;
  const bowAnchorY = barY + barH + bowDiameter * (0.42 + 0.5);
  const [bowCx, bowCy] = rotate(barX + barW * 0.5, bowAnchorY, cx, cy, deg);
  const bowStroke = Math.max(1, barW * BOW_STROKE_FRACTION_OF_BAR_WIDTH);

  return (
    `<polygon points="${points(pentagon)}" fill="${fill}"/>` +
    `<circle cx="${round(bowCx)}" cy="${round(bowCy)}" r="${round(bowRadius)}" ` +
    `fill="none" stroke="${fill}" stroke-width="${round(bowStroke)}"/>`
  );
}

/** Shared by every family whose scissors are the literal blades (README 3). */
export function scissorsMark(size: number, fill: string): string {
  const pivotRadius = (PIVOT_DOT_DIAMETER * size) / 2;
  return (
    blade(size, -1, fill) +
    blade(size, 1, fill) +
    `<circle cx="${round(PIVOT.x * size)}" cy="${round(PIVOT.y * size)}" r="${round(pivotRadius)}" fill="${fill}"/>`
  );
}

// --- Cut stone (README 3, family B): flat polygons, no shading at all.

function fractionPolygon(size: number, fractions: ReadonlyArray<Point>): Point[] {
  return fractions.map(([x, y]) => [x * size, y * size]);
}

function cutStoneRock(size: number, fill: string): string {
  // hexagon: polygon(26% 0,74% 0,100% 50%,74% 100%,26% 100%,0 50%)
  const shape = fractionPolygon(size, [
    [0.26, 0],
    [0.74, 0],
    [1, 0.5],
    [0.74, 1],
    [0.26, 1],
    [0, 0.5],
  ]);
  return `<polygon points="${points(shape)}" fill="${fill}"/>`;
}

function cutStonePaper(size: number, fill: string): string {
  // folded sheet: polygon(0 0,74% 0,100% 26%,100% 100%,0 100%)
  const shape = fractionPolygon(size, [
    [0, 0],
    [0.74, 0],
    [1, 0.26],
    [1, 1],
    [0, 1],
  ]);
  return `<polygon points="${points(shape)}" fill="${fill}"/>`;
}

const CUT_STONE: Family = {
  rock: cutStoneRock,
  paper: cutStonePaper,
  scissors: scissorsMark,
};

const FAMILIES: Partial<Record<FamilyId, Family>> = {
  'cut-stone': CUT_STONE,
};

export const BUILT_FAMILY_IDS: readonly FamilyId[] = Object.keys(FAMILIES) as FamilyId[];

export function familyMark(id: FamilyId): Family {
  const family = FAMILIES[id];
  if (!family) throw new FamilyNotBuiltError(id);
  return family;
}
