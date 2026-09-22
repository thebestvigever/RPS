// The engine's public API — spec 7.3.
//
// Pure by contract: no DOM, no timers, no Math.random, no dependencies. The
// browser, the AI, the test suite and any future multiplayer server all run this
// package unchanged.

export type {
  GameClockRecord,
  GameEvent,
  GameRecord,
  GameResult,
  GameState,
  Move,
  MoveInput,
  Owner,
  Piece,
  PieceType,
  Side,
  Square,
  VariantConfig,
  VariantId,
} from './types.js';

export {
  FenError,
  IllegalMoveError,
  NotImplementedError,
  NotationError,
  ShareError,
} from './errors.js';

export {
  FILE_LETTERS,
  FILES,
  NEIGHBOURS,
  RANKS,
  SQUARE_COUNT,
  colOf,
  distance,
  neighbours,
  parseSquare,
  rowOf,
  squareName,
  toIndex,
} from './board.js';

export {
  EMPTY,
  PIECE_TYPES,
  SIDES,
  beats,
  decodePiece,
  encodePiece,
  other,
  predatorOf,
} from './pieces.js';

export {
  VARIANT_BLURBS,
  VARIANT_IDS,
  VARIANTS,
  getVariant,
} from './variants.js';

export { goalSquares, homeSquares, isGoalSquare } from './goals.js';

export { moveToText, parseMove } from './notation.js';
export { findLegalMove, isLegal, legalMoves } from './moves.js';
export {
  abandon,
  abortGame,
  agreeDraw,
  applyMove,
  createGame,
  flag,
  fromFen,
  getResult,
  positionKey,
  replay,
  resign,
  toFen,
} from './game.js';
export type { Extinction, GameSummary } from './summary.js';
export { summarise } from './summary.js';

export {
  SHARE_PREFIX,
  base64UrlDecode,
  base64UrlEncode,
  decodeRecord,
  encodeRecord,
} from './share.js';

export {
  canHoldSeal,
  distanceToGoal,
  isPermanent,
  isSealed,
  nearestRunner,
  permanentMask,
  typeCounts,
} from './analysis.js';
