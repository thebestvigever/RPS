// The game record's clock section — spec 8.3, and the piece
// `docs/ADDENDUM-CLOCKS.md` listed as "not built" after C1.
//
// The move list is the source of truth for everything the rules decide
// (CLAUDE.md), but it cannot reconstruct a clock: the same twelve moves take
// two seconds or two minutes, and no amount of replaying says which. So a
// timed game records what each move left behind, and every gift of time —
// which is also what makes a shared game unable to hide that somebody handed
// themselves ten extra minutes (the note on `GameClockRecord`).
//
// Kept pure like the rest of this package: it is handed the snapshots and
// reads no clock of its own.

import type { GameClockRecord, Side } from '@sps/engine';
import { turnSide } from './clock.js';
import type { ClockState } from './clock.js';

/**
 * A game's clock history: `stack[n]` is the clock with `n` moves played, so
 * `stack[0]` is the clock as the game began and the array is always one longer
 * than the move list.
 *
 * Holding whole `ClockState`s rather than bare numbers is what lets Undo put
 * the clock back exactly (spec 10.8) — a refund needs both sides' time, the
 * stage each was in and how many moves they had made in it, and a single
 * `remainingMs` throws four of those five away.
 */
export type ClockStack = readonly ClockState[];

export class RecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordError';
  }
}

/**
 * The snapshot to restore when taking `plies` back to `target` — the clock as
 * it stood when that position was first reached.
 *
 * It does NOT re-anchor the returned state to the wall clock; `startTurn` is
 * what does that, and keeping the two apart is deliberate. This function is
 * pure arithmetic over history and stays testable without a notion of "now";
 * the caller, which is the only thing that knows what time it is, supplies it.
 */
export function rewind(stack: ClockStack, target: number): ClockState {
  const snapshot = stack[target];
  if (!snapshot) throw new RecordError(`no clock snapshot for ply ${target}`);
  return snapshot;
}

/**
 * Spec 8.3's `clock` section, or undefined for an untimed game — the field is
 * documented as present only for timed games, and an "unlimited" record full
 * of `Infinity` would not survive JSON anyway.
 */
export function clockRecord(stack: ClockStack): GameClockRecord | undefined {
  const first = stack[0];
  if (!first) throw new RecordError('a clock record needs at least the starting clock');
  if (first.control.unlimited) return undefined;

  const stage = first.control.stages[0];
  if (!stage) throw new RecordError('a time control needs at least one stage');

  // One entry per move: what the side that made it had left afterwards. The
  // side comes off the snapshot the move was made FROM, never from counting
  // plies even and odd — that would bake in "Blue moves first", which is true
  // of every variant today and is still not this module's business to assume.
  const remainingMs: number[] = [];
  for (let ply = 0; ply + 1 < stack.length; ply++) {
    const before = stack[ply]!;
    const after = stack[ply + 1]!;
    const side: Side | null = turnSide(before);
    if (side === null) throw new RecordError(`the clock at ply ${ply} belongs to nobody`);
    remainingMs.push(after.remainingMs[side]);
  }

  const gifts = stack[stack.length - 1]!.gifts;

  return {
    control: first.control.id,
    initialMs: stage.baseMs,
    incrementMs: stage.bonus.kind === 'none' ? 0 : stage.bonus.ms,
    remainingMs,
    ...(gifts.length > 0 ? { gifts: gifts.map((gift) => ({ ...gift })) } : {}),
  };
}
