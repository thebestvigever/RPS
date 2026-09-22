// What a finished game amounted to — spec 10.7's game-over overlay wants
// "moves played, captures each side, and which types were wiped out and when".
//
// Derived from the event stream `replay` returns, never from comparing the
// start position with the end one (spec 7.7, CLAUDE.md: the interface animates
// and announces from events). That is not a stylistic preference here: "when a
// type was wiped out" is not recoverable from two boards at all, and a capture
// count taken by subtracting piece counts would quietly miscount a game where
// a neutral was taken.
//
// It lives in the engine because the archive and analysis work in spec 13.5
// wants the same numbers from the same records, and because it is a pure
// function of engine output with no interface opinion in it — the wording is
// apps/web's job.

import type { GameEvent, PieceType, Side } from './types.js';

export interface Extinction {
  side: Side;
  pieceType: PieceType;
  /** The ply after which that side had none left — 1-based, as the move list numbers them. */
  ply: number;
}

export interface GameSummary {
  /** Plies played. Full moves, the way the move list numbers them, is `Math.ceil(plies / 2)`. */
  plies: number;
  /** How many pieces each side took. Keyed by the CAPTOR's side. */
  captures: Record<Side, number>;
  /** A neutral piece capturing (Neutrals, spec 4.2) belongs to whoever used it, which the `by` piece cannot say — so those are counted apart rather than guessed at. */
  neutralCaptures: number;
  extinctions: Extinction[];
}

/** `events` is exactly what `replay` returns: one array of events per ply. */
export function summarise(events: readonly (readonly GameEvent[])[]): GameSummary {
  const summary: GameSummary = {
    plies: events.length,
    captures: { blue: 0, red: 0 },
    neutralCaptures: 0,
    extinctions: [],
  };

  events.forEach((perPly, index) => {
    const ply = index + 1;
    for (const event of perPly) {
      if (event.type === 'capture') {
        if (event.by.owner === 'neutral') summary.neutralCaptures += 1;
        else summary.captures[event.by.owner] += 1;
      } else if (event.type === 'type-extinct') {
        summary.extinctions.push({ side: event.side, pieceType: event.pieceType, ply });
      }
    }
  });

  return summary;
}
