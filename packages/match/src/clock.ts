// A chess clock, as pure data.
//
// It holds no timer and never reads the time itself: every operation is handed
// `now`. That is what makes it testable to the millisecond, replayable from a
// game record, and — when online play arrives (spec 13.2) — runnable on the
// server with the identical code, which is the whole reason the engine was kept
// free of clocks in the first place.

import type { Side } from '@sps/engine';
import type { Stage, TimeControl } from './time-control.js';

export interface TimeGift {
  /** The ply the gift was given at, so a record can replay it in order. */
  ply: number;
  from: Side;
  to: Side;
  ms: number;
}

export interface ClockState {
  control: TimeControl;
  remainingMs: Record<Side, number>;
  /** Which stage of the control each side is in (tournament controls). */
  stageIndex: Record<Side, number>;
  movesInStage: Record<Side, number>;
  /** Whose clock is ticking, or null when stopped or paused. */
  running: Side | null;
  /** Set while paused, so `resume` knows whose turn it was. */
  pausedSide: Side | null;
  /** Timestamp the current run began; null while stopped. */
  since: number | null;
  /**
   * Time already banked for the CURRENT turn, across pauses. Without this a
   * pause would restart a simple delay and hand out free time each time the
   * menu was opened.
   */
  elapsedThisTurnMs: number;
  flagged: Side | null;
  gifts: TimeGift[];
}

export class ClockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClockError';
  }
}

function stageFor(control: TimeControl, index: number): Stage {
  const stage = control.stages[Math.min(index, control.stages.length - 1)];
  if (!stage) throw new ClockError('a time control needs at least one stage');
  return stage;
}

/**
 * The time a turn actually costs.
 *
 * Bronstein and simple delay are the SAME arithmetic — both give back up to the
 * delay, so both cost `elapsed - delay`. They differ only in what the clock
 * shows: simple delay waits, then counts down; Bronstein counts down at once
 * and jumps back when the move is made. That is a display choice (10.x), not a
 * difference in time, and pretending otherwise is how clocks end up disagreeing
 * with each other.
 */
function costOf(stage: Stage, elapsedMs: number): number {
  if (stage.bonus.kind === 'none' || stage.bonus.kind === 'fischer') return elapsedMs;
  return Math.max(0, elapsedMs - stage.bonus.ms);
}

export function createClock(control: TimeControl): ClockState {
  const base = control.unlimited ? Infinity : stageFor(control, 0).baseMs;
  return {
    control,
    remainingMs: { blue: base, red: base },
    stageIndex: { blue: 0, red: 0 },
    movesInStage: { blue: 0, red: 0 },
    running: null,
    pausedSide: null,
    since: null,
    elapsedThisTurnMs: 0,
    flagged: null,
    gifts: [],
  };
}

/**
 * Whose turn the clock is on, running or not. A paused clock still belongs to
 * somebody, and the time they have already spent this turn is still theirs.
 */
function turnSideOf(clock: ClockState): Side | null {
  return clock.running ?? clock.pausedSide;
}

/** How long the current turn has run, counting time banked across pauses. */
function turnElapsed(clock: ClockState, now: number): number {
  const live = clock.since === null ? 0 : Math.max(0, now - clock.since);
  return clock.elapsedThisTurnMs + live;
}

/** What `side`'s clock reads at `now`. Never negative; Infinity when unlimited. */
export function remainingAt(clock: ClockState, side: Side, now: number): number {
  if (clock.control.unlimited) return Infinity;
  const banked = clock.remainingMs[side];
  if (turnSideOf(clock) !== side) return Math.max(0, banked);
  const stage = stageFor(clock.control, clock.stageIndex[side]);
  return Math.max(0, banked - costOf(stage, turnElapsed(clock, now)));
}

/** The side whose clock has fallen, or null. A query — it changes nothing. */
export function flaggedAt(clock: ClockState, now: number): Side | null {
  if (clock.flagged) return clock.flagged;
  if (clock.control.unlimited || clock.running === null) return null;
  return remainingAt(clock, clock.running, now) <= 0 ? clock.running : null;
}

/** Records a fall, so it survives the clock being stopped. */
export function tick(clock: ClockState, now: number): ClockState {
  const fallen = flaggedAt(clock, now);
  if (!fallen || clock.flagged === fallen) return clock;
  return {
    ...clock,
    remainingMs: { ...clock.remainingMs, [fallen]: 0 },
    running: null,
    since: null,
    flagged: fallen,
  };
}

export function startTurn(clock: ClockState, side: Side, now: number): ClockState {
  if (clock.flagged) throw new ClockError('the clock has fallen');
  return { ...clock, running: side, pausedSide: null, since: now, elapsedThisTurnMs: 0 };
}

/** Banks what the current turn has cost so far, without ending the turn. */
function commit(clock: ClockState, now: number): ClockState {
  const side = turnSideOf(clock);
  if (side === null) return clock;
  const stage = stageFor(clock.control, clock.stageIndex[side]);
  const elapsed = turnElapsed(clock, now);
  const spent = clock.control.unlimited ? 0 : costOf(stage, elapsed);

  return {
    ...clock,
    remainingMs: { ...clock.remainingMs, [side]: clock.remainingMs[side] - spent },
    elapsedThisTurnMs: elapsed,
  };
}

/**
 * Press the clock: end the moving side's turn, pay for it, add the bonus, move
 * the stage on if this completed it, and start the opponent.
 *
 * Call it once per move, after the engine has accepted the move.
 */
export function press(clock: ClockState, now: number): ClockState {
  if (clock.running === null) throw new ClockError('the clock is not running');
  if (clock.flagged) throw new ClockError('the clock has fallen');

  const side = clock.running;
  const opponent: Side = side === 'blue' ? 'red' : 'blue';
  const committed = commit(clock, now);

  if (clock.control.unlimited) return startTurn(committed, opponent, now);

  // Running out mid-move is a fall, and the bonus for a move you did not finish
  // in time does not rescue it. So this is checked before anything is added.
  if (committed.remainingMs[side] <= 0) {
    return {
      ...committed,
      remainingMs: { ...committed.remainingMs, [side]: 0 },
      running: null,
      pausedSide: null,
      since: null,
      elapsedThisTurnMs: 0,
      flagged: side,
    };
  }

  const stageIndex = committed.stageIndex[side];
  const stage = stageFor(clock.control, stageIndex);

  // Only Fischer adds time. Bronstein's give-back is already in `costOf`, which
  // charges the turn `elapsed - delay` — adding it again here would pay twice.
  let remaining =
    committed.remainingMs[side] + (stage.bonus.kind === 'fischer' ? stage.bonus.ms : 0);

  const moves = committed.movesInStage[side] + 1;
  let nextStageIndex = stageIndex;
  let movesInStage = moves;

  if (stage.moves !== null && moves >= stage.moves && stageIndex + 1 < clock.control.stages.length) {
    nextStageIndex = stageIndex + 1;
    movesInStage = 0;
    remaining += stageFor(clock.control, nextStageIndex).baseMs;
  }

  const advanced: ClockState = {
    ...committed,
    remainingMs: { ...committed.remainingMs, [side]: remaining },
    stageIndex: { ...committed.stageIndex, [side]: nextStageIndex },
    movesInStage: { ...committed.movesInStage, [side]: movesInStage },
  };

  return startTurn(advanced, opponent, now);
}

/** Stops the clock without paying a bonus — game over, or the app going away. */
export function stop(clock: ClockState, now: number): ClockState {
  if (turnSideOf(clock) === null) return clock;
  return {
    ...commit(clock, now),
    running: null,
    pausedSide: null,
    since: null,
    elapsedThisTurnMs: 0,
  };
}

export function pause(clock: ClockState, now: number): ClockState {
  if (clock.running === null) return clock;
  const side = clock.running;
  return {
    ...clock,
    elapsedThisTurnMs: turnElapsed(clock, now),
    running: null,
    pausedSide: side,
    since: null,
  };
}

export function resume(clock: ClockState, now: number): ClockState {
  if (clock.pausedSide === null) return clock;
  if (clock.flagged) throw new ClockError('the clock has fallen');
  // Keeps `elapsedThisTurnMs`, so a pause cannot rewind a delay.
  return { ...clock, running: clock.pausedSide, pausedSide: null, since: now };
}

/**
 * Hands time to a player. Who may give it to whom is a policy question, not a
 * clock one — see `canGive` in offers.ts.
 */
export function giveTime(clock: ClockState, gift: TimeGift): ClockState {
  if (clock.control.unlimited) return clock;
  if (gift.ms <= 0) throw new ClockError('a gift must be more than nothing');
  if (clock.flagged) throw new ClockError('the clock has fallen');

  return {
    ...clock,
    remainingMs: {
      ...clock.remainingMs,
      [gift.to]: clock.remainingMs[gift.to] + gift.ms,
    },
    gifts: [...clock.gifts, gift],
  };
}

/** Total time each side has been handed, for the game-over summary. */
export function giftedMs(clock: ClockState, side: Side): number {
  return clock.gifts.reduce((total, gift) => (gift.to === side ? total + gift.ms : total), 0);
}

export type Urgency = 'normal' | 'low' | 'critical';

/**
 * Thresholds are the SMALLER of a fixed time and a share of the starting
 * clock. A flat "warn at 30 seconds" is useless in a 1+0 game, where thirty
 * seconds is half of everything you have and the warning would be on from the
 * first move.
 */
export const URGENCY = {
  lowMs: 30_000,
  lowShare: 0.2,
  criticalMs: 10_000,
  criticalShare: 0.1,
} as const;

export function urgencyOf(clock: ClockState, side: Side, now: number): Urgency {
  if (clock.control.unlimited) return 'normal';

  const initial = clock.control.stages[0]?.baseMs ?? 0;
  if (initial <= 0) return 'normal';

  const remaining = remainingAt(clock, side, now);
  const critical = Math.min(URGENCY.criticalMs, initial * URGENCY.criticalShare);
  const low = Math.min(URGENCY.lowMs, initial * URGENCY.lowShare);

  if (remaining <= critical) return 'critical';
  if (remaining <= low) return 'low';
  return 'normal';
}
