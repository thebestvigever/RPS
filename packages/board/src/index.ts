// The board package's public surface — docs/VISUAL_SYSTEM.md 4.

export type { ThemeId, ThemeTokens, ThemeFonts, Swatches } from './themes.js';
export { THEMES, THEME_IDS, SWATCHES, theme, CORNER_TINT_ALPHA, LAST_MOVE_TINT_ALPHA } from './themes.js';

export type { FamilyId, Family, FamilyInfo, MarkFn } from './families.js';
export { FAMILY_IDS, FAMILY_INFO, BUILT_FAMILY_IDS, familyMark, scissorsMark } from './families.js';

export type { RenderMode } from './ownership.js';
export { renderMode, standaloneMarkPx } from './ownership.js';

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
} from './sizing.js';

export type { Appearance, RenderOptions, PieceSampleOptions } from './render.js';
export { renderBoard, renderPieceSample } from './render.js';

export { RenderError, FamilyNotBuiltError } from './errors.js';

export * as svg from './svg.js';
