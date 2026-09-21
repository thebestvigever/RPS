import { describe, expect, it } from 'vitest';
import {
  ClockError,
  createClock,
  delayed,
  fischer,
  flaggedAt,
  giftedMs,
  giveTime,
  pause,
  press,
  remainingAt,
  resume,
  startTurn,
  stop,
  tick,
  tournament,
  UNLIMITED,
} from '../src/index.js';

const MINUTE = 60_000;

describe('counting down', () => {
  it('starts both sides on the control’s base time', () => {
    const clock = createClock(fischer(3, 2));
    expect(remainingAt(clock, 'blue', 0)).toBe(3 * MINUTE);
    expect(remainingAt(clock, 'red', 0)).toBe(3 * MINUTE);
  });

  it('only runs down the side whose turn it is', () => {
    const clock = startTurn(createClock(fischer(3, 0)), 'blue', 0);
    expect(remainingAt(clock, 'blue', 10_000)).toBe(3 * MINUTE - 10_000);
    expect(remainingAt(clock, 'red', 10_000)).toBe(3 * MINUTE);
  });

  it('never reads below zero', () => {
    const clock = startTurn(createClock(fischer(1, 0)), 'blue', 0);
    expect(remainingAt(clock, 'blue', 90_000)).toBe(0);
  });

  it('does not mutate the clock it is given', () => {
    const before = startTurn(createClock(fischer(3, 2)), 'blue', 0);
    const snapshot = JSON.stringify(before);
    press(before, 5_000);
    giveTime(before, { ply: 1, from: 'red', to: 'blue', ms: 15_000 });
    stop(before, 5_000);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('Fischer increment', () => {
  it('adds the increment after every move', () => {
    let clock = startTurn(createClock(fischer(3, 2)), 'blue', 0);
    clock = press(clock, 5_000); // Blue used 5s, gets 2s back
    expect(remainingAt(clock, 'blue', 5_000)).toBe(3 * MINUTE - 5_000 + 2_000);
    expect(clock.running).toBe('red');
  });

  it('can leave you with more than you started, if you move fast enough', () => {
    let clock = startTurn(createClock(fischer(1, 5)), 'blue', 0);
    let now = 0;
    for (let move = 0; move < 4; move++) {
      now += 1_000; // a second a move against a five-second increment
      clock = press(clock, now);
      clock = startTurn(clock, 'blue', now);
    }
    expect(remainingAt(clock, 'blue', now)).toBe(1 * MINUTE + 4 * 4_000);
  });

  it('does not rescue a move that was not finished in time', () => {
    // The increment is for moves you complete, not ones you flag on.
    const clock = startTurn(createClock(fischer(1, 30)), 'blue', 0);
    const after = press(clock, 61_000);
    expect(after.flagged).toBe('blue');
    expect(remainingAt(after, 'blue', 61_000)).toBe(0);
  });
});

describe('delay', () => {
  it('costs nothing inside the delay', () => {
    let clock = startTurn(createClock(delayed(3, 5, 'simple')), 'blue', 0);
    expect(remainingAt(clock, 'blue', 4_000)).toBe(3 * MINUTE);
    clock = press(clock, 4_000);
    expect(remainingAt(clock, 'blue', 4_000)).toBe(3 * MINUTE);
  });

  it('costs only the time beyond the delay', () => {
    const clock = startTurn(createClock(delayed(3, 5, 'simple')), 'blue', 0);
    expect(remainingAt(clock, 'blue', 8_000)).toBe(3 * MINUTE - 3_000);
    expect(remainingAt(press(clock, 8_000), 'blue', 8_000)).toBe(3 * MINUTE - 3_000);
  });

  it('leaves Bronstein and simple delay with identical time', () => {
    // They are the same arithmetic and differ only in what the clock shows.
    // If these ever disagree, one of them is wrong.
    let bronstein = startTurn(createClock(delayed(5, 10, 'bronstein')), 'blue', 0);
    let simple = startTurn(createClock(delayed(5, 10, 'simple')), 'blue', 0);
    let now = 0;

    for (const spent of [3_000, 12_000, 10_000, 25_000, 1_000]) {
      now += spent;
      bronstein = startTurn(press(bronstein, now), 'blue', now);
      simple = startTurn(press(simple, now), 'blue', now);
      expect(remainingAt(bronstein, 'blue', now)).toBe(remainingAt(simple, 'blue', now));
    }
  });
});

describe('flagging', () => {
  it('reports the fall without changing anything', () => {
    const clock = startTurn(createClock(fischer(1, 0)), 'blue', 0);
    expect(flaggedAt(clock, 59_000)).toBeNull();
    expect(flaggedAt(clock, 60_001)).toBe('blue');
    expect(clock.flagged).toBeNull();
  });

  it('records the fall when ticked, and stops the clock', () => {
    const clock = tick(startTurn(createClock(fischer(1, 0)), 'blue', 0), 61_000);
    expect(clock.flagged).toBe('blue');
    expect(clock.running).toBeNull();
    expect(remainingAt(clock, 'blue', 99_000)).toBe(0);
  });

  it('refuses to run on once it has fallen', () => {
    const fallen = tick(startTurn(createClock(fischer(1, 0)), 'blue', 0), 61_000);
    expect(() => startTurn(fallen, 'red', 61_000)).toThrow(ClockError);
    expect(() => press(fallen, 61_000)).toThrow(ClockError);
  });

  it('never flags on an unlimited control', () => {
    const clock = startTurn(createClock(UNLIMITED), 'blue', 0);
    expect(remainingAt(clock, 'blue', 10 * 60 * MINUTE)).toBe(Infinity);
    expect(flaggedAt(clock, 10 * 60 * MINUTE)).toBeNull();
  });
});

describe('pausing', () => {
  it('stops the count and resumes it', () => {
    let clock = startTurn(createClock(fischer(3, 0)), 'blue', 0);
    clock = pause(clock, 10_000);
    expect(remainingAt(clock, 'blue', 90_000)).toBe(3 * MINUTE - 10_000);

    clock = resume(clock, 90_000);
    expect(remainingAt(clock, 'blue', 95_000)).toBe(3 * MINUTE - 15_000);
  });

  it('does not rewind a delay, so pausing cannot buy free time', () => {
    // Three seconds used inside a five-second delay, then a pause, then three
    // more. That is six seconds of turn, so one second past the delay.
    let clock = startTurn(createClock(delayed(3, 5, 'simple')), 'blue', 0);
    clock = pause(clock, 3_000);
    clock = resume(clock, 10_000);
    clock = press(clock, 13_000);
    expect(remainingAt(clock, 'blue', 13_000)).toBe(3 * MINUTE - 1_000);
  });
});

describe('tournament controls', () => {
  it('adds the next stage’s time when the stage is completed', () => {
    // 2 moves in 1 minute, then 2 more minutes, 10s increment throughout.
    const control = tournament('test', '2/1+2', [
      { moves: 2, baseMs: 1 * MINUTE, bonus: { kind: 'fischer', ms: 10_000 } },
      { moves: null, baseMs: 2 * MINUTE, bonus: { kind: 'fischer', ms: 10_000 } },
    ]);

    let clock = startTurn(createClock(control), 'blue', 0);
    clock = startTurn(press(clock, 5_000), 'blue', 5_000);
    expect(clock.stageIndex.blue).toBe(0);

    clock = press(clock, 10_000); // Blue's second move completes stage one
    expect(clock.stageIndex.blue).toBe(1);
    expect(clock.movesInStage.blue).toBe(0);
    // 60s - 10s used + 20s of increment + 120s for the new stage
    expect(remainingAt(clock, 'blue', 10_000)).toBe(1 * MINUTE - 10_000 + 20_000 + 2 * MINUTE);
  });

  it('refuses a control whose non-final stage runs to the end', () => {
    expect(() =>
      tournament('bad', 'bad', [
        { moves: null, baseMs: MINUTE, bonus: { kind: 'none', ms: 0 } },
        { moves: null, baseMs: MINUTE, bonus: { kind: 'none', ms: 0 } },
      ]),
    ).toThrow(/only the last stage/);
  });
});

describe('giving time', () => {
  it('adds it to the receiving clock and records the gift', () => {
    const clock = giveTime(startTurn(createClock(fischer(3, 0)), 'blue', 0), {
      ply: 4,
      from: 'blue',
      to: 'red',
      ms: 15_000,
    });

    expect(remainingAt(clock, 'red', 0)).toBe(3 * MINUTE + 15_000);
    expect(clock.gifts).toEqual([{ ply: 4, from: 'blue', to: 'red', ms: 15_000 }]);
    expect(giftedMs(clock, 'red')).toBe(15_000);
    expect(giftedMs(clock, 'blue')).toBe(0);
  });

  it('stacks, so a player can keep topping themselves up', () => {
    let clock = createClock(fischer(3, 0));
    for (let i = 0; i < 4; i++) {
      clock = giveTime(clock, { ply: i, from: 'blue', to: 'blue', ms: 15_000 });
    }
    expect(remainingAt(clock, 'blue', 0)).toBe(3 * MINUTE + 60_000);
    expect(clock.gifts).toHaveLength(4);
  });

  it('adds time to a running clock without disturbing the turn', () => {
    let clock = startTurn(createClock(fischer(3, 0)), 'blue', 0);
    clock = giveTime(clock, { ply: 1, from: 'red', to: 'blue', ms: 15_000 });
    expect(remainingAt(clock, 'blue', 10_000)).toBe(3 * MINUTE + 15_000 - 10_000);
    expect(clock.running).toBe('blue');
  });

  it('is a no-op on an unlimited control, and refuses nothing-or-less', () => {
    const unlimited = createClock(UNLIMITED);
    expect(giveTime(unlimited, { ply: 0, from: 'blue', to: 'red', ms: 15_000 }).gifts).toEqual([]);
    expect(() =>
      giveTime(createClock(fischer(3, 0)), { ply: 0, from: 'blue', to: 'red', ms: 0 }),
    ).toThrow(ClockError);
  });
});
