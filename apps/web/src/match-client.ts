// The browser's half of the room — everything about an online game except the
// socket itself.
//
// Same split the server uses (docs/ONLINE.md): this is a reducer over the
// messages the room sends, and `useMatch.ts` is the thin thing that owns a
// WebSocket and feeds it. So the awkward parts — what a reconnect leaves you
// believing, which clock reading is the current one, what happens when the
// server refuses a move this browser already drew — are plain functions over
// plain data, and are tested without a network or a DOM.
//
// The room is the authority. This never decides anything; it only remembers
// what it was told.

import type { GameResult, Side, VariantId } from '@sps/engine';
import type { ClockState, TimeControl } from '@sps/match';
import type { ClocksView, PresenceView, SeatId, ServerMessage } from '@sps/referee';

export type Phase =
  /** No `welcome` yet. */
  | 'connecting'
  /** Seated, and the other seat is still on an unopened invite link. */
  | 'waiting'
  | 'playing'
  | 'over';

export interface TimeGiftSeen {
  ply: number;
  from: Side;
  to: Side;
  ms: number;
}

export interface MatchState {
  matchId: string;
  you: SeatId | null;
  mode: string | null;
  variant: VariantId | null;
  names: Record<Side, string | null>;
  /** The server's move list. The only version of the game that counts. */
  moves: string[];
  result: GameResult | null;
  clocks: ClocksView | null;
  /** The local clock reading of the moment `clocks` was received. */
  clocksAt: number;
  /** The server's clocks after each move, for the record's clock section. */
  clockHistory: ClocksView[];
  presence: PresenceView | null;
  presenceAt: number;
  offer: { kind: 'draw' | 'takeback'; by: Side } | null;
  gifts: TimeGiftSeen[];
  /**
   * Which control this game is on, read off the record's clock section (spec
   * 8.3). A player who arrives by link never chose one, and still needs the
   * right clock face, low-time warning and category — so it travels with the
   * game rather than being a thing only the creator knows.
   */
  control: { id: string; initialMs: number; incrementMs: number } | null;
  /** Server time when the game began, or null while waiting. */
  startedAt: number | null;
  /** Server time minus local time, from the newest reading seen. */
  skewMs: number;
  /** The last thing the room refused, for the status line. Cleared by anything that works. */
  notice: string | null;
  /** Set when the room hung up on us for good — a bad link, or another tab taking the seat. */
  fatal: string | null;
}

export function initialMatch(matchId: string): MatchState {
  return {
    matchId,
    you: null,
    mode: null,
    variant: null,
    names: { blue: null, red: null },
    moves: [],
    result: null,
    clocks: null,
    clocksAt: 0,
    clockHistory: [],
    presence: null,
    presenceAt: 0,
    offer: null,
    gifts: [],
    control: null,
    startedAt: null,
    skewMs: 0,
    notice: null,
    fatal: null,
  };
}

export function phaseOf(state: MatchState): Phase {
  if (state.you === null) return 'connecting';
  if (state.result) return 'over';
  return state.startedAt === null ? 'waiting' : 'playing';
}

/**
 * Take a clock reading, but only if it is newer than the one already held.
 *
 * Catching up after a reconnect delivers the clocks as they stood after each
 * missed move — right for a move list, wrong for the face of a clock. Every
 * view carries its own `serverTime`, and "the newest one wins" is the whole
 * rule (docs/ONLINE.md).
 */
function withClocks(state: MatchState, clocks: ClocksView, at: number): MatchState {
  if (state.clocks && clocks.serverTime < state.clocks.serverTime) return state;
  return { ...state, clocks, clocksAt: at, skewMs: clocks.serverTime - at };
}

export function applyServerMessage(
  state: MatchState,
  message: ServerMessage,
  at: number,
): MatchState {
  switch (message.t) {
    case 'welcome': {
      const next: MatchState = {
        ...state,
        matchId: message.matchId,
        you: message.you,
        mode: message.mode,
        variant: message.record.variant,
        names: { ...message.names },
        moves: [...message.record.moves],
        result: message.record.result ?? null,
        presence: message.presence,
        presenceAt: at,
        offer: message.offer,
        startedAt: message.startedAt,
        gifts: message.record.clock?.gifts ? [...message.record.clock.gifts] : state.gifts,
        control: message.record.clock
          ? {
              id: message.record.clock.control,
              initialMs: message.record.clock.initialMs,
              incrementMs: message.record.clock.incrementMs,
            }
          : null,
        notice: null,
        fatal: null,
      };
      return withClocks(next, message.clocks, at);
    }

    case 'started':
      return withClocks({ ...state, startedAt: message.startedAt, notice: null }, message.clocks, at);

    case 'moved': {
      // Idempotent on purpose: a catch-up can redeliver a move this browser
      // already has, and a move it played itself comes back as this message.
      const moves = state.moves.slice(0, message.ply - 1);
      moves.push(message.move);
      const clockHistory = state.clockHistory.slice(0, message.ply - 1);
      clockHistory.push(message.clocks);
      return withClocks({ ...state, moves, clockHistory, offer: null, notice: null }, message.clocks, at);
    }

    case 'took-back':
      return withClocks(
        {
          ...state,
          moves: state.moves.slice(0, message.ply),
          clockHistory: state.clockHistory.slice(0, message.ply),
          offer: null,
        },
        message.clocks,
        at,
      );

    case 'rejected':
      // The move is not rolled back here: the room resends whatever this
      // client evidently missed, and `moves` is rebuilt from that. All this
      // has to do is say so.
      return { ...state, notice: message.reason };

    case 'result':
      return withClocks({ ...state, result: message.result, offer: null }, message.clocks, at);

    case 'presence':
      return { ...state, presence: message, presenceAt: at, skewMs: message.serverTime - at };

    case 'draw-offered':
      return { ...state, offer: { kind: 'draw', by: message.by } };
    case 'takeback-offered':
      return { ...state, offer: { kind: 'takeback', by: message.by } };
    case 'draw-declined':
    case 'draw-withdrawn':
    case 'takeback-declined':
    case 'takeback-withdrawn':
      return { ...state, offer: null };

    case 'gifted':
      return withClocks(
        {
          ...state,
          gifts: [...state.gifts, { ply: state.moves.length, from: message.from, to: message.to, ms: message.ms }],
        },
        message.clocks,
        at,
      );

    case 'error':
      // Three of these mean this socket will never work: a link that opens
      // nothing, a room that is not this match, and another tab having taken
      // the seat. Retrying any of them is just a loop.
      return message.code === 'bad-token' || message.code === 'wrong-match'
        ? { ...state, fatal: message.reason, notice: message.reason }
        : { ...state, notice: message.reason };

    case 'pong':
      return { ...state, skewMs: message.serverTime - at };

    default:
      return state;
  }
}

/**
 * The server's clock reading, as a `ClockState` the rest of the app already
 * knows how to draw.
 *
 * Rebuilding one rather than inventing a second clock display is what keeps
 * the online board identical to the offline one: `remainingAt`, `urgencyOf`
 * and the low-time warning are the same code either way. `since` is the LOCAL
 * time the reading arrived, so `Date.now()` is the right thing to measure it
 * against; the flight time makes the running side look very slightly worse
 * off than it is, which is the safe direction to be wrong in.
 *
 * This is exact for every control the server will accept: `parseCreateMatch`
 * takes only presets, and every preset is Fischer or none, where a turn costs
 * exactly the time it takes. A delay control would need the server to send
 * how much of the delay had been used, because the reading alone cannot say.
 */
export function clockFromServer(
  control: TimeControl,
  clocks: ClocksView,
  receivedAt: number,
  gifts: readonly TimeGiftSeen[] = [],
): ClockState {
  const read = (ms: number | null): number => (ms === null ? Infinity : ms);
  return {
    control,
    remainingMs: { blue: read(clocks.blue), red: read(clocks.red) },
    stageIndex: { blue: 0, red: 0 },
    movesInStage: { blue: 0, red: 0 },
    running: clocks.running,
    pausedSide: null,
    since: clocks.running === null ? null : receivedAt,
    elapsedThisTurnMs: 0,
    flagged: null,
    gifts: gifts.map((gift) => ({ ...gift })),
  };
}

/**
 * When the opponent's absence becomes claimable, in LOCAL time, or null if
 * there is nothing to claim.
 *
 * The room sends the instant rather than a countdown for a reason: a client
 * that started its own sixty seconds when the message arrived would be wrong
 * by the whole of a reconnect.
 */
export function claimableAtLocal(state: MatchState, you: Side): number | null {
  const opponent: Side = you === 'blue' ? 'red' : 'blue';
  const at = state.presence?.claimableAt[opponent] ?? null;
  return at === null ? null : at - state.skewMs;
}

/** Is the opponent away right now? */
export function opponentAway(state: MatchState, you: Side): boolean {
  const opponent: Side = you === 'blue' ? 'red' : 'blue';
  return state.presence?.[opponent] === 'away';
}
