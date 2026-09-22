// A thin React wrapper around @sps/board's pure renderer — docs/VISUAL_SYSTEM.md
// 4 and 8 (M3a). @sps/board never touches the DOM (CLAUDE.md's rule for the
// engine and match packages applies here too: no DOM, no dependencies beyond
// the engine, same input always gives the same markup), so this component's
// entire job is injecting the SVG string it returns. There is nothing else to
// componentise yet — selection, dragging and motion are M3b.

import { useMemo } from 'react';
import { SWATCHES, renderBoard } from '@sps/board';
import type { Appearance, FamilyId, ThemeId } from '@sps/board';
import type { Side, Square, VariantConfig } from '@sps/engine';

export interface BoardProps {
  fen: string;
  variant: VariantConfig;
  boardPx: number;
  theme: ThemeId;
  family: FamilyId;
  appearance: Appearance;
  coordinates?: boolean;
  lastMove?: { from: Square; to: Square } | null;
}

export default function Board(props: BoardProps) {
  const svg = useMemo(
    () => renderBoard(props),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      props.fen,
      props.variant,
      props.boardPx,
      props.theme,
      props.family,
      props.appearance.viewerSide,
      props.appearance.sideColors.blue,
      props.appearance.sideColors.red,
      props.coordinates,
      props.lastMove?.from,
      props.lastMove?.to,
    ],
  );

  return (
    <div
      className="board"
      style={{ width: props.boardPx, height: props.boardPx }}
      // renderBoard's output is this package's own markup, built from fixed
      // SVG templates and the caller's own theme/colour data — nothing here
      // originates from another player or an external source.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** Field Notes' own defaults (docs/VISUAL_SYSTEM.md 3) — M3a ships one theme, so there is no picker to read a choice from yet. */
export function defaultAppearance(): Appearance {
  const sideColors: Record<Side, string> = {
    blue: SWATCHES['field-notes'].you[0]!,
    red: SWATCHES['field-notes'].opponent[0]!,
  };
  return { sideColors, viewerSide: 'blue' };
}
