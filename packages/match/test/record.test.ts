// The record's clock section (spec 8.3) and the snapshot Undo rewinds to
// (spec 10.8). Both are pure functions of a stack of clock states, so they
// are checked to the millisecond with a hand-driven clock rather than a timer.

import { describe, expect, it } from 'vitest';
import { createClock, giveTime, press, startTurn, stop } from '../src/clock.js';
import type { ClockState } from '../src/clock.js';
import { RecordError, clockRecord, rewind } from '../src/record.js';
import { UNLIMITED, fischer } from '../src/time-control.js';

const CONTROL = fischer(10, 5); // 10 minutes, 5s Fischer — apps/web's own default

/**
 * Plays `costsMs` one per ply, returning the stack Game.tsx keeps: `stack[n]`
 * is the clock with n moves played.
 */
function play(costsMs: readonly number[], control = CONTROL): ClockState[] {
  let now = 1_000;
  let clock = startTurn(createClock(control), 'blue', now);
  const stack: ClockState[] = [clock];
  for (const cost of costsMs) {
    now += cost;
    clock = press(clock, now);
    stack.push(clock);
  }
  return stack;
}

describe('rewind (spec 10.8: Undo)', () => {
  it('hands back the clock as it stood at that ply', () => {
    const stack = play([10_000, 4_000, 6_000]);
    // Blue spent 10s on ply 1 and got 5s back, so after one move it holds
    // 10:00 - 10s + 5s. Rewinding to 0 has to undo all of that.
    expect(rewind(stack, 0).remainingMs.blue).toBe(600_000);
    expect(rewind(stack, 1).remainingMs.blue).toBe(600_000 - 10_000 + 5_000);
    expect(rewind(stack, 3).remainingMs.blue).toBe(600_000 - 16_000 + 10_000);
  });

  it('is exactly the state Undo of two plies should restore', () => {
    // Against the computer Undo takes back two plies (spec 10.8), landing on
    // the human's own turn — and must give BOTH sides their time back, not
    // just the player's.
    const stack = play([10_000, 4_000, 6_000, 3_000]);
    const back = rewind(stack, 2);
    expect(back.remainingMs.blue).toBe(600_000 - 10_000 + 5_000);
    expect(back.remainingMs.red).toBe(600_000 - 4_000 + 5_000);
  });

  it('refuses a ply it has no snapshot for', () => {
    expect(() => rewind(play([1_000]), 5)).toThrow(RecordError);
  });
});

describe('clockRecord (spec 8.3)', () => {
  it('records what each move left the side that made it', () => {
    const stack = play([10_000, 4_000, 6_000]);
    const record = clockRecord(stack)!;
    expect(record.control).toBe('10+5');
    expect(record.initialMs).toBe(600_000);
    expect(record.incrementMs).toBe(5_000);
    expect(record.remainingMs).toEqual([
      600_000 - 10_000 + 5_000, // blue, ply 1
      600_000 - 4_000 + 5_000, // red, ply 2
      600_000 - 16_000 + 10_000, // blue, ply 3
    ]);
  });

  it('is one entry per move', () => {
    expect(clockRecord(play([1_000, 2_000, 3_000, 4_000]))!.remainingMs).toHaveLength(4);
    expect(clockRecord(play([]))!.remainingMs).toEqual([]);
  });

  it('records gifts, so a shared game cannot hide one', () => {
    let clock = startTurn(createClock(CONTROL), 'blue', 0);
    const stack: ClockState[] = [clock];
    clock = giveTime(clock, { ply: 0, from: 'blue', to: 'blue', ms: 15_000 });
    clock = press(clock, 5_000);
    stack.push(clock);

    const record = clockRecord(stack)!;
    expect(record.gifts).toEqual([{ ply: 0, from: 'blue', to: 'blue', ms: 15_000 }]);
    expect(record.remainingMs).toEqual([600_000 + 15_000 - 5_000 + 5_000]);
  });

  it('leaves gifts off entirely when there were none', () => {
    expect(clockRecord(play([1_000]))!.gifts).toBeUndefined();
  });

  it('has no clock section for an untimed game', () => {
    // Spec 8.3: "Present only for timed games" — and a record full of
    // Infinity would not survive JSON in any case.
    expect(clockRecord(play([1_000], UNLIMITED))).toBeUndefined();
  });

  it('still reads the mover off a stopped final clock', () => {
    // The last snapshot of a finished game is stopped, so `running` is null
    // there. That must not lose the final move's entry.
    const stack = play([10_000, 4_000]);
    stack[stack.length - 1] = stop(stack[stack.length - 1]!, 50_000);
    expect(clockRecord(stack)!.remainingMs).toHaveLength(2);
  });

  it('needs at least the starting clock', () => {
    expect(() => clockRecord([])).toThrow(RecordError);
  });
});
