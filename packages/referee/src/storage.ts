// What a room writes down, and how it comes back.
//
// Spec 13.2: "save the record to the object's own storage after every move,
// because memory resets when a hibernating object wakes." So a room has to be
// able to become JSON and then become itself again, and the only honest test
// of that is a round trip — `test/storage.test.ts` plays a game, saves, loads
// and asserts the two rooms answer the same.
//
// Two things do not survive the trip and must not:
//
//   * The connections. A woken object re-registers its own sockets; a socket
//     recorded in storage is a socket that no longer exists.
//   * The `GameState`. It holds an `Int8Array` and a `Map`, neither of which
//     is JSON, and it is derived anyway — `replay` rebuilds it from the moves,
//     which is the point of the moves being the source of truth (spec 8.3).
//
// And one thing that nearly does not: `Infinity`, which an unlimited clock is
// full of and which JSON turns silently into `null`. It is written as null
// deliberately, and read back as Infinity, so the silent version can never
// happen by accident.

import type { GameResult, Side, VariantId } from '@sps/engine';
import { getVariant } from '@sps/engine';
import type { ClockState, Offer, TimeControl, TimeGift } from '@sps/match';
import { OFFER_POLICIES } from '@sps/match';

import type { OnlineMode, Room, RoomState } from './room.js';
import { restoreRoom } from './room.js';
import type { SeatRecord } from './seats.js';

export const SNAPSHOT_VERSION = 1;

interface ClockSnapshot {
  remainingMs: Record<Side, number | null>;
  stageIndex: Record<Side, number>;
  movesInStage: Record<Side, number>;
  running: Side | null;
  pausedSide: Side | null;
  since: number | null;
  elapsedThisTurnMs: number;
  flagged: Side | null;
  gifts: TimeGift[];
}

export interface RoomSnapshot {
  v: typeof SNAPSHOT_VERSION;
  matchId: string;
  mode: OnlineMode;
  variant: VariantId;
  /** Stored whole, not by id: a custom control is not in anybody's preset list. */
  control: TimeControl;
  seats: Record<Side, SeatRecord>;
  moves: string[];
  /** The endings `replay` cannot know about: resignation, agreement, the clock, an abort. */
  result: GameResult | null;
  createdAt: number;
  startedAt: number | null;
  away: Record<Side, number | null>;
  offers: { pending: Offer | null; lastOfferPly: Record<string, number> };
  clocks: ClockSnapshot[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const finite = (ms: number): number | null => (Number.isFinite(ms) ? ms : null);
const unfinite = (ms: number | null): number => (ms === null ? Infinity : ms);

function encodeClock(clock: ClockState): ClockSnapshot {
  return {
    remainingMs: { blue: finite(clock.remainingMs.blue), red: finite(clock.remainingMs.red) },
    stageIndex: { ...clock.stageIndex },
    movesInStage: { ...clock.movesInStage },
    running: clock.running,
    pausedSide: clock.pausedSide,
    since: clock.since,
    elapsedThisTurnMs: clock.elapsedThisTurnMs,
    flagged: clock.flagged,
    gifts: clock.gifts.map((gift) => ({ ...gift })),
  };
}

function decodeClock(snapshot: ClockSnapshot, control: TimeControl): ClockState {
  return {
    control,
    remainingMs: {
      blue: unfinite(snapshot.remainingMs.blue),
      red: unfinite(snapshot.remainingMs.red),
    },
    stageIndex: { ...snapshot.stageIndex },
    movesInStage: { ...snapshot.movesInStage },
    running: snapshot.running,
    pausedSide: snapshot.pausedSide,
    since: snapshot.since,
    elapsedThisTurnMs: snapshot.elapsedThisTurnMs,
    flagged: snapshot.flagged,
    gifts: snapshot.gifts.map((gift) => ({ ...gift })),
  };
}

export function saveRoom(room: Room): RoomSnapshot {
  const { state } = room;
  return {
    v: SNAPSHOT_VERSION,
    matchId: state.matchId,
    mode: state.mode,
    variant: state.variant.id,
    control: state.control,
    seats: { blue: { ...state.seats.blue }, red: { ...state.seats.red } },
    moves: [...state.moves],
    result: room.game.result,
    createdAt: state.createdAt,
    startedAt: state.startedAt,
    away: { ...state.away },
    offers: {
      pending: state.offers.pending ? { ...state.offers.pending } : null,
      lastOfferPly: { ...state.offers.lastOfferPly },
    },
    clocks: state.clocks.map(encodeClock),
  };
}

export function loadRoom(snapshot: RoomSnapshot): Room {
  if (snapshot.v !== SNAPSHOT_VERSION) {
    throw new SnapshotError(`this room was saved by a different version (${String(snapshot.v)})`);
  }
  if (snapshot.clocks.length === 0) {
    throw new SnapshotError('a room always has at least its starting clock');
  }

  const variant = getVariant(snapshot.variant);
  const state: RoomState = {
    matchId: snapshot.matchId,
    mode: snapshot.mode,
    variant,
    control: snapshot.control,
    seats: { blue: { ...snapshot.seats.blue }, red: { ...snapshot.seats.red } },
    moves: [...snapshot.moves],
    createdAt: snapshot.createdAt,
    startedAt: snapshot.startedAt,
    away: { ...snapshot.away },
    // The policy is not stored: it belongs to the mode, and reading it back
    // from storage would be a way for a stale room to keep playing by rules
    // the code no longer has.
    offers: {
      policy: OFFER_POLICIES[snapshot.mode],
      pending: snapshot.offers.pending ? { ...snapshot.offers.pending } : null,
      lastOfferPly: { ...snapshot.offers.lastOfferPly },
    },
    clocks: snapshot.clocks.map((clock) => decodeClock(clock, snapshot.control)),
  };

  return restoreRoom(state, snapshot.result);
}
