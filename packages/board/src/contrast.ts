// Colour math — docs/VISUAL_SYSTEM.md 3 and 9, spec 10.3.
//
// The handoff shipped a player-colour picker and a legal-move dot alpha
// without checking either against the boards they render on: six of its
// twenty-four colour combinations broke the spec's own 3:1 floor, and its
// fixed 55% dot alpha measured 1.62-2.42:1. This is what checks a swatch
// before it ships, and what derives a dot's alpha from the colour a player
// actually picked instead of fixing it once for every colour.

/** Spec 10.3: "keep pieces at 3:1 contrast or better against squares." */
export const CONTRAST_FLOOR = 3;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Not a 6-digit hex colour: "${hex}"`);
  const value = match[1]!;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function toHex({ r, g, b }: Rgb): string {
  const byte = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

function channelLuminance(channel255: number): number {
  const c = channel255 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance: 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG contrast ratio: 1 (identical) to 21 (black on white). Order doesn't matter. */
export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function passesFloor(fg: string, bg: string, floor = CONTRAST_FLOOR): boolean {
  return contrastRatio(fg, bg) >= floor;
}

/**
 * A hex colour converted to its perceptual grey — the standard luminance
 * weighting (0.2126/0.7152/0.0722), applied in sRGB space rather than
 * linearised, which is what an image editor's "desaturate" does and what a
 * greyscale printer or colour-blind simulation approximates. Used to build
 * the M3a greyscale review sheet (docs/VISUAL_SYSTEM.md 9): spec 10.3 requires
 * every family to "stay distinguishable in greyscale", and this is how that
 * gets checked without a screen.
 */
export function toGreyscale(hex: string): string {
  const { r, g, b } = parseHex(hex);
  const grey = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  return toHex({ r: grey, g: grey, b: grey });
}

/** `fg` at `alpha` painted over opaque `bg` — the colour a viewer actually sees. */
export function composite(fg: string, bg: string, alpha: number): string {
  const f = parseHex(fg);
  const b = parseHex(bg);
  const mix = (fc: number, bc: number) => fc * alpha + bc * (1 - alpha);
  return toHex({ r: mix(f.r, b.r), g: mix(f.g, b.g), b: mix(f.b, b.b) });
}

const DOT_ALPHA_MIN_HUNDREDTHS = 55; // the handoff's own starting point (README 2): alpha .55.
const DOT_ALPHA_MAX_HUNDREDTHS = 100;

/**
 * The smallest alpha at or above 0.55 at which `color` composited over
 * `square` clears the contrast floor. The handoff fixed this at .55 for
 * every colour; measured against the corrected swatches (themes.ts) that
 * lands between .55 and .83, never the same value twice, which is why it has
 * to be derived rather than stored as a per-theme constant.
 *
 * The loop walks integer hundredths, not repeated float addition
 * (`alpha += 0.01`): accumulated float drift there let the alpha that
 * satisfied the check inside the loop differ, at the 8th decimal place,
 * from the same value recomputed cleanly outside it — enough, at a colour
 * sitting right at the floor, to round a channel a shade darker and drop
 * the recomputed contrast under 3:1. `alpha = hundredths / 100` is exactly
 * what every caller will pass back into `composite`, so what passes here is
 * what passes there.
 *
 * Every swatch this package ships clears the floor at alpha 1
 * (`test/contrast.test.ts` enforces it), so a solution always exists in
 * [0.55, 1]; a colour from outside that set can still exhaust the loop, so
 * the fallback is the frankest thing available — the full colour.
 */
export function dotAlpha(color: string, square: string, floor = CONTRAST_FLOOR): number {
  for (let hundredths = DOT_ALPHA_MIN_HUNDREDTHS; hundredths <= DOT_ALPHA_MAX_HUNDREDTHS; hundredths++) {
    const alpha = hundredths / 100;
    if (passesFloor(composite(color, square, alpha), square, floor)) {
      return alpha;
    }
  }
  return 1;
}

function hueDegrees(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue: number;
  if (max === rn) hue = ((gn - bn) / delta) % 6;
  else if (max === gn) hue = (bn - rn) / delta + 2;
  else hue = (rn - gn) / delta + 4;
  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

function hueGapDegrees(a: string, b: string): number {
  const diff = Math.abs(hueDegrees(a) - hueDegrees(b));
  return Math.min(diff, 360 - diff);
}

/**
 * A comfort check, not an accessibility one. Ownership is already carried by
 * the ring/knockout cue independent of colour (docs/VISUAL_SYSTEM.md 2), so
 * two close colours are merely easy to mistake for one another, not a floor
 * violation. Thresholds are docs/VISUAL_SYSTEM.md 3's: hue gap under 25° and
 * contrast under 1.5:1.
 */
export function isConfusablePair(a: string, b: string): boolean {
  return hueGapDegrees(a, b) < 25 && contrastRatio(a, b) < 1.5;
}
