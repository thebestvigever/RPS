// Size fractions shared between the ownership-mode decision and the renderer
// that draws it — docs/VISUAL_SYSTEM.md 2 and 5, spec 10.3.

/** A standalone mark's own box, as a fraction of the square (README's own piece scale, Board.dc.html). */
export const STANDALONE_BOX_FRACTION = 0.62;

/** The opponent's ring in standalone mode: a full circle, not traced to the silhouette — a circle gives consistent clearance regardless of the mark's own shape (docs/VISUAL_SYSTEM.md 2). */
export const STANDALONE_RING_DIAMETER_FRACTION = 0.82;

/** ~1.5px at a 62px square, scaling with it rather than staying fixed. */
export const STANDALONE_RING_STROKE_FRACTION = 0.024;

/**
 * Below this mark size the ring merges with the fill (the handoff's own
 * finding, docs/VISUAL_SYSTEM.md 2) — the breakpoint that decides standalone
 * vs. knockout.
 */
export const RING_MIN_MARK_PX = 32;

/** Knockout mode: the disc, as a fraction of the square (docs/VISUAL_SYSTEM.md 2). */
export const KNOCKOUT_DISC_FRACTION = 0.76;

/** The mark punched into the disc, as a fraction of the disc (README 3: "44-52% of the disc"; docs/VISUAL_SYSTEM.md 2 takes the top of that range). */
export const KNOCKOUT_MARK_FRACTION = 0.52;

/** The opponent's outlined disc in knockout mode. */
export const KNOCKOUT_RING_STROKE_FRACTION = 0.03;

/** A neutral piece's ring, dashed rather than solid or absent (spec 10.3) — same diameter as the standalone opponent ring, any mode. */
export const NEUTRAL_RING_DIAMETER_FRACTION = STANDALONE_RING_DIAMETER_FRACTION;
export const NEUTRAL_RING_DASH_FRACTION = 0.06; // dash length, as a fraction of the square
