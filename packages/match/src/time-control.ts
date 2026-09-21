// Time controls — everything a chess clock does.
//
// A control is a list of STAGES, which is what makes tournament controls like
// "40 moves in 90 minutes, then 30 minutes, 30s increment throughout"
// expressible rather than special-cased. Most controls are one stage.

export type BonusKind =
  /** Sudden death: no time is ever added. */
  | 'none'
  /** Fischer: the increment is added after every move, used or not. */
  | 'fischer'
  /** Bronstein: you get back what you used, up to the delay. */
  | 'bronstein'
  /** Simple (US) delay: the clock waits out the delay before counting down. */
  | 'simple';

export interface Bonus {
  kind: BonusKind;
  ms: number;
}

export interface Stage {
  /** Moves this side must complete before the next stage; null = to the end. */
  moves: number | null;
  /** Added to the clock when this stage begins. */
  baseMs: number;
  bonus: Bonus;
}

export interface TimeControl {
  id: string;
  /** How it reads on a button: "3+2", "40/90+30", "Unlimited". */
  name: string;
  /** No clock at all. `remainingMs` is Infinity and nobody ever flags. */
  unlimited: boolean;
  stages: Stage[];
}

export type Category = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'unlimited';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/**
 * Moves per side in a typical game.
 *
 * Lichess estimates a chess game at 40 moves; spec 6.1 measured THIS game at
 * 129–138 plies, so about 67 moves each. Using 40 here would file a 3+2 game as
 * far shorter than it plays, and the increment matters correspondingly more:
 * at 2s a move, 67 moves hands back over two minutes.
 */
export const TYPICAL_MOVES = 67;

export function fischer(minutes: number, incrementSeconds: number): TimeControl {
  return {
    id: `${minutes}+${incrementSeconds}`,
    name: `${minutes}+${incrementSeconds}`,
    unlimited: false,
    stages: [
      {
        moves: null,
        baseMs: minutes * MINUTE,
        bonus: {
          kind: incrementSeconds > 0 ? 'fischer' : 'none',
          ms: incrementSeconds * SECOND,
        },
      },
    ],
  };
}

export function delayed(minutes: number, delaySeconds: number, kind: 'bronstein' | 'simple'): TimeControl {
  return {
    id: `${minutes}d${delaySeconds}${kind === 'simple' ? 's' : 'b'}`,
    name: `${minutes} + ${delaySeconds}s ${kind === 'simple' ? 'delay' : 'Bronstein'}`,
    unlimited: false,
    stages: [
      { moves: null, baseMs: minutes * MINUTE, bonus: { kind, ms: delaySeconds * SECOND } },
    ],
  };
}

/** A multi-stage tournament control, e.g. 40 moves in 90 min then 30 min, +30s. */
export function tournament(id: string, name: string, stages: Stage[]): TimeControl {
  if (stages.length === 0) throw new Error('a time control needs at least one stage');
  for (const stage of stages.slice(0, -1)) {
    if (stage.moves === null) {
      throw new Error('only the last stage may run to the end of the game');
    }
  }
  return { id, name, unlimited: false, stages };
}

export const UNLIMITED: TimeControl = {
  id: 'unlimited',
  name: 'Unlimited',
  unlimited: true,
  stages: [{ moves: null, baseMs: 0, bonus: { kind: 'none', ms: 0 } }],
};

/**
 * Roughly how long a game on this control takes one side, which is what sorts
 * controls into categories.
 */
export function estimatedDurationMs(control: TimeControl): number {
  if (control.unlimited) return Infinity;

  let total = 0;
  let movesLeft = TYPICAL_MOVES;

  for (const stage of control.stages) {
    total += stage.baseMs;
    const inStage = stage.moves === null ? movesLeft : Math.min(stage.moves, movesLeft);
    // Simple and Bronstein delay give time back only if you use it, so they
    // don't lengthen the game the way an increment does.
    if (stage.bonus.kind === 'fischer') total += inStage * stage.bonus.ms;
    movesLeft -= inStage;
    if (movesLeft <= 0) break;
  }

  return total;
}

export function categoryOf(control: TimeControl): Category {
  if (control.unlimited) return 'unlimited';
  const minutes = estimatedDurationMs(control) / MINUTE;
  if (minutes < 3) return 'bullet';
  if (minutes < 8) return 'blitz';
  if (minutes < 25) return 'rapid';
  return 'classical';
}

/**
 * The presets a player picks from. Chosen for a game that runs about 67 moves
 * a side, so every one of them carries an increment except the shortest —
 * without one, a long endgame on a short clock is decided by the clock rather
 * than the board.
 */
export const PRESETS: readonly TimeControl[] = [
  fischer(1, 0),
  fischer(2, 1),
  fischer(3, 2),
  fischer(5, 3),
  fischer(10, 5),
  fischer(15, 10),
  fischer(30, 20),
  UNLIMITED,
];

export function presetById(id: string): TimeControl {
  const found = PRESETS.find((control) => control.id === id);
  if (!found) throw new Error(`unknown time control: ${id}`);
  return found;
}

/** The default gift, and the one both buttons in the interface hand over. */
export const GIFT_MS = 15 * SECOND;
