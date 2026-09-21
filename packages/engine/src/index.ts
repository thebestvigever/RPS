// The engine's public API — spec 7.3.
//
// Pure by contract: no DOM, no timers, no Math.random, no dependencies. The
// browser, the AI, the test suite and any future multiplayer server all run this
// package unchanged.

export type {
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

export { FenError, IllegalMoveError, NotImplementedError } from './errors.js';

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

export { fromFen, toFen } from './fen.js';
export { moveToText, parseMove } from './notation.js';
export { isLegal, legalMoves } from './moves.js';
export {
  applyMove,
  createGame,
  getResult,
  positionKey,
  replay,
} from './game.js';
export {
  distanceToGoal,
  isPermanent,
  isSealed,
  typeCounts,
} from './analysis.js';
