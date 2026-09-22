// Minimal SVG string building. No DOM: this package is pure, like the engine
// and match packages (CLAUDE.md), so it renders identically in a test runner
// and in the browser. apps/web injects the returned markup; it does not walk
// a DOM tree to get it.

export function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type Attrs = Record<string, string | number | boolean | undefined>;

function attrString(attrs: Attrs): string {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([key, value]) => (value === true ? key : `${key}="${escapeAttr(String(value))}"`))
    .join(' ');
}

/** A self-closing element: `rect`, `circle`, `polygon`, `path`, `line`, `use`. */
export function el(tag: string, attrs: Attrs): string {
  return `<${tag} ${attrString(attrs)}/>`;
}

/** An element that wraps markup children: `g`, `svg`, `defs`, `pattern`. */
export function group(tag: string, attrs: Attrs, children: string): string {
  return `<${tag} ${attrString(attrs)}>${children}</${tag}>`;
}

export function text(attrs: Attrs, content: string): string {
  return `<text ${attrString(attrs)}>${escapeText(content)}</text>`;
}

/** `x1,y1 x2,y2 ...` for `<polygon>`/`<polyline>`, rounded to keep markup small. */
export function points(pts: ReadonlyArray<readonly [number, number]>): string {
  return pts.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
}

export function round(n: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}
