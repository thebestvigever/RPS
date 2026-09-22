// The referee's public API.
//
// `packages/referee` is the whole of online play except the socket: the room,
// the protocol, the seats and the invite links. It depends on `@sps/engine`
// and `@sps/match` and on nothing else — no Cloudflare, no WebSocket, no
// `Date.now` — so it runs in Node, in a test, and in a Durable Object without
// changing. `apps/server` is the shell that gives it sockets and storage.

export type {
  ClientMessage,
  ClocksView,
  ErrorCode,
  OfferKindWire,
  ParseResult,
  PresenceFlag,
  PresenceView,
  SeatId,
  ServerMessage,
} from './protocol.js';
export { MAX_MESSAGE_BYTES, MAX_NAME_LENGTH, parseClientMessage } from './protocol.js';

export type { SeatRecord, Seats } from './seats.js';
export {
  JOIN_PREFIX,
  SeatError,
  bothClaimed,
  claim,
  createSeats,
  inviteLink,
  isMatchId,
  isToken,
  parseInvite,
  seatFor,
} from './seats.js';

export type { AwaySince } from './presence.js';
export { AWAY_CLAIM_MS, awayFor, canClaimAway, claimableAt, presenceView } from './presence.js';

export type { Bucket, Charge } from './limiter.js';
export { BUCKET_CAPACITY, REFILL_PER_SECOND, charge, createBucket } from './limiter.js';

export { clocksView, flagDeadline, sideOnClock } from './timing.js';

export type {
  Audience,
  Connection,
  Delivery,
  OnlineMode,
  Outbound,
  Room,
  RoomOptions,
  RoomState,
} from './room.js';
export {
  CLOSE,
  FIRST_MOVE_MS,
  close,
  createRoom,
  gameRecord,
  liveClock,
  nextWakeAt,
  open,
  receive,
  recipients,
  reopen,
  restoreRoom,
  wake,
} from './room.js';

export type { CreatedMatch, MatchSummary } from './http.js';

export type { RoomSnapshot } from './storage.js';
export { SNAPSHOT_VERSION, SnapshotError, loadRoom, saveRoom } from './storage.js';
