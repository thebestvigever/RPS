// The board package's public surface — docs/VISUAL_SYSTEM.md 4.

export type { ThemeId, ThemeTokens, ThemeFonts, Swatches } from './themes.js';
export {
  THEMES,
  THEME_IDS,
  SWATCHES,
  theme,
  CORNER_TINT_ALPHA,
  LAST_MOVE_TINT_ALPHA,
  HOVER_TINT_ALPHA,
} from './themes.js';

export type { FamilyId, Family, FamilyInfo, MarkFn } from './families.js';
export { FAMILY_IDS, FAMILY_INFO, BUILT_FAMILY_IDS, familyMark, scissorsMark } from './families.js';

export type { RenderMode } from './ownership.js';
export { renderMode, standaloneMarkPx } from './ownership.js';

export type { Cell, Orientation } from './orientation.js';
export { DEFAULT_ORIENTATION, displayCell, squareAtCell } from './orientation.js';

export {
  CONTRAST_FLOOR,
  contrastRatio,
  relativeLuminance,
  passesFloor,
  composite,
  dotAlpha,
  isConfusablePair,
  toGreyscale,
} from './contrast.js';

export {
  STANDALONE_BOX_FRACTION,
  STANDALONE_RING_DIAMETER_FRACTION,
  STANDALONE_RING_STROKE_FRACTION,
  RING_MIN_MARK_PX,
  KNOCKOUT_DISC_FRACTION,
  KNOCKOUT_MARK_FRACTION,
  KNOCKOUT_RING_STROKE_FRACTION,
  NEUTRAL_RING_DIAMETER_FRACTION,
  NEUTRAL_RING_DASH_FRACTION,
  SELECTION_RING_STROKE_FRACTION,
  LEGAL_DOT_DIAMETER_FRACTION,
  CAPTURE_RING_DIAMETER_FRACTION,
  CAPTURE_RING_STROKE_FRACTION,
  FOCUS_RING_DIAMETER_FRACTION,
  FOCUS_RING_STROKE_FRACTION,
  FOCUS_RING_DASH_FRACTION,
  SHIELD_SIZE_FRACTION,
  SHIELD_INSET_FRACTION,
  KEEP_LOCK_SIZE_FRACTION,
  KEEP_LOCK_INSET_FRACTION,
  DANGER_MARK_SIZE_FRACTION,
  DANGER_MARK_STROKE_FRACTION,
  THREAT_ARROW_STROKE_FRACTION,
  THREAT_ARROW_HEAD_LENGTH_FRACTION,
  THREAT_ARROW_HEAD_WIDTH_FRACTION,
  THREAT_ARROW_CLEARANCE_FRACTION,
} from './sizing.js';

export type {
  Appearance,
  RenderOptions,
  PieceSampleOptions,
  Selection,
  SelectionDestination,
  ThreatOverlay,
} from './render.js';
export { PIECE_MOTION_CLASS, renderBoard, renderPieceSample } from './render.js';

export type { MotionKind } from './motion.js';
export { captureMotion, MOTION_MS } from './motion.js';

export type { SideNames } from './text.js';
export {
  pieceTypeName,
  sideName,
  illegalCaptureReason,
  neutralSelectionText,
  permanentPieceText,
  keepLockText,
  raceMeterText,
} from './text.js';

export { RenderError, FamilyNotBuiltError } from './errors.js';

export * as svg from './svg.js';
