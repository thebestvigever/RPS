// Ownership cue mode — docs/VISUAL_SYSTEM.md 2.
//
// The handoff's ownership cue is a hairline ring on every opponent piece, and
// the handoff itself notes the ring merges with the fill at <=30px. Every
// phone renders below that: board width is min(viewport - 32, 640) (spec
// 10.2), which puts the standalone mark at 22-28px on the phones the design
// was built for (docs/VISUAL_SYSTEM.md 2's own table). So the cue is picked
// from the rendered size, never from a setting: a ring above the threshold,
// a knockout (filled disc vs. outlined disc) below it. Knockout is a render
// mode, not a family substitution — a hexagon knocked out of a disc is still
// a hexagon — so family choice stays meaningful on a phone.

import { RING_MIN_MARK_PX, STANDALONE_BOX_FRACTION } from './sizing.js';

export type RenderMode = 'standalone' | 'knockout';

export function standaloneMarkPx(squarePx: number): number {
  return squarePx * STANDALONE_BOX_FRACTION;
}

export function renderMode(squarePx: number): RenderMode {
  return standaloneMarkPx(squarePx) >= RING_MIN_MARK_PX ? 'standalone' : 'knockout';
}
