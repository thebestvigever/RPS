// Data model — spec 7.2.

export type Side = 'blue' | 'red';
export type Owner = Side | 'neutral';
export type PieceType = 'rock' | 'paper' | 'scissors';

/** 0..80. row = 9 - rank, col = fileIndex, index = row * 9 + col (spec 2.1). */
export type Square = number;

export interface Piece {
  owner: Owner;
  type: PieceType;
}

export interface Move {
  from: Square;
  to: Square;
  // Derived, but carried for display and events:
  piece: Piece; // the piece that moves (may be neutral)
  captured: Piece | null;
}

/** What `applyMove` and `isLegal` accept — the rest of a Move is derived. */
export type MoveInput = Pick<Move, 'from' | 'to'>;

export type GameResult =
  | { winner: Side; reason: 'corner' | 'no-moves' | 'resign' }
  | { winner: null; reason: 'repetition' | 'move-limit' | 'agreed' };

export type GameEvent =
  | { type: 'move'; from: Square; to: Square; piece: Piece }
  | { type: 'capture'; at: Square; captured: Piece; by: Piece }
  /** That side just lost its last piece of a type. */
  | { type: 'type-extinct'; side: Side; pieceType: PieceType }
  /** That side's corner just became unreachable (spec 7.6). */
  | { type: 'sealed'; side: Side }
  | { type: 'game-over'; result: GameResult };

export type VariantId = 'original' | 'corner2x2' | 'neutrals';

export interface VariantConfig {
  id: VariantId;
  name: string; // shown in the interface
  rulesVersion: 1;
  start: string; // position notation, spec 8.2
  goals: Record<Side, string[]>; // squares each side must REACH
  neutrals: false | { captureOnly: true };
  draw: { repetitions: 3; maxPlies: 300 };
}

export interface GameState {
  variant: VariantConfig;
  /** 81 cells. 0 = empty, else owner * 4 + type + 1 (spec 7.2). */
  board: Int8Array;
  turn: Side;
  ply: number; // moves made so far
  positionCounts: Map<string, number>; // for threefold repetition
  result: GameResult | null;
}

/** Spec 8.3. The move list is the source of truth; state is always replay(). */
export interface GameRecord {
  game: 'stone-paper-scissors';
  rulesVersion: 1;
  variant: VariantId;
  start: string;
  players?: Record<Side, string>;
  seed?: number;
  moves: string[];
  result?: GameResult | null;
  startedAt?: string;
}
