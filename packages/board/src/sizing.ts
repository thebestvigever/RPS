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

// --- Selection aids (spec 10.4, 10.5) — board-level, so independent of
// render mode and piece family; only the square matters.

/** "selection outline = 2px solid the colour" (README 2), scaled like the ownership ring. */
export const SELECTION_RING_STROKE_FRACTION = STANDALONE_RING_STROKE_FRACTION;

/** Legal-move dot: "20% of square" (spec 10.5). Its alpha is derived per colour (contrast.ts's `dotAlpha`), not fixed. */
export const LEGAL_DOT_DIAMETER_FRACTION = 0.2;

/** Capture ring: "80% of the square, 2.5-3px" (spec 10.5). */
export const CAPTURE_RING_DIAMETER_FRACTION = 0.8;
export const CAPTURE_RING_STROKE_FRACTION = 0.045; // lands in 2.5-3px at the sizes spec 10.2 allows

/** The keyboard focus cursor — a visible ring distinct from selection's (spec 10.10), dashed so it never reads as an ownership or selection cue. */
export const FOCUS_RING_DIAMETER_FRACTION = 0.92;
export const FOCUS_RING_STROKE_FRACTION = 0.03;
export const FOCUS_RING_DASH_FRACTION = 0.05;

// --- Information aids (spec 10.5, M6) — small badges and lines layered over
// a piece or square, never so large they compete with the piece mark itself.

/** The permanent-piece shield: a small badge in a square's corner, not centred over the piece (spec 10.5). */
export const SHIELD_SIZE_FRACTION = 0.24;
export const SHIELD_INSET_FRACTION = 0.08;

/** The Keep-lock icon, same corner treatment as the shield so the two never collide (a piece is never both mid-move and sealed-corner in the same render). */
export const KEEP_LOCK_SIZE_FRACTION = 0.28;
export const KEEP_LOCK_INSET_FRACTION = 0.08;

/** A danger mark: a small diamond outline on a legal-move destination where the mover could be taken right back. Smaller than the legal dot it sits beside. */
export const DANGER_MARK_SIZE_FRACTION = 0.16;
export const DANGER_MARK_STROKE_FRACTION = 0.03;

/** Threat-line arrows: shaft stroke, arrowhead length and width, all as a fraction of the square so they scale with the board. Shortened at both ends so the line reads as pointing at pieces, not skewering them. */
export const THREAT_ARROW_STROKE_FRACTION = 0.045;
export const THREAT_ARROW_HEAD_LENGTH_FRACTION = 0.16;
export const THREAT_ARROW_HEAD_WIDTH_FRACTION = 0.12;
export const THREAT_ARROW_CLEARANCE_FRACTION = 0.3; // gap left at each end for the piece mark
