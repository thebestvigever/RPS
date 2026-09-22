// The two JSON shapes that are not WebSocket messages: what creating a match
// hands back, and what a link leads to before anybody takes a seat.
//
// They live here, beside the protocol, rather than in the server that serves
// them — so the browser and the room are reading one definition of the same
// thing instead of two that agree until somebody edits one.

import type { GameRecord, GameResult, Side, VariantId } from '@sps/engine';
import type { OnlineMode } from './room.js';

export interface CreatedMatch {
  matchId: string;
  /** The seat the creator kept. */
  you: Side;
  /** Their own credential, for reconnecting. Kept, never shared. */
  token: string;
  /** The link to send a friend. It carries the other seat, so it is the game. */
  invite: string;
  /** The same room, with no seat attached. */
  spectate: string;
  socket: string;
  variant: VariantId;
  control: { id: string; name: string };
  mode: OnlineMode;
}

export interface MatchSummary {
  matchId: string;
  variant: VariantId;
  control: { id: string; name: string };
  mode: OnlineMode;
  seatsTaken: Record<Side, boolean>;
  names: Record<Side, string | null>;
  plies: number;
  result: GameResult | null;
  /** Present once the game is over — spec 13.5's permanent page, in data form. */
  record?: GameRecord;
}
