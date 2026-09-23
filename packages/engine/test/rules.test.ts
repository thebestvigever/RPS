// One test per row of the 2.6 table, per rule in 4.2, and per ending in
// 2.7-2.9 — spec 11.1.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyMove,
  canHoldSeal,
  capturesFrom,
  createGame,
  dangerAfter,
  defendersOf,
  fromFen,
  getVariant,
  IllegalMoveError,
  isPermanent,
  isSealed,
  legalMoves,
  moveToText,
  nearestRunnerSquare,
  parseMove,
  parseSquare,
  resign,
  threatenedBy,
  toFen,
  typeCounts,
} from '../src/index.js';
import type { GameState, VariantConfig } from '../src/index.js';

const original = getVariant('original');
const neutrals = getVariant('neutrals');

function load(fen: string, variant: VariantConfig = original): GameState {
  return fromFen(fen, variant);
}

function moveTexts(state: GameState): string[] {
  return legalMoves(state).map((move) => moveToText(state, move));
}

function play(state: GameState, text: string): GameState {
  return applyMove(state, parseMove(state, text)).state;
}

describe('what can move where (spec 2.6)', () => {
  it('an empty destination is legal', () => {
    // A lone Blue Paper on e5 has all eight king steps.
    const state = load('R8/9/9/9/4p4/9/9/9/9 blue');
    expect(moveTexts(state).sort()).toEqual(
      ['Pe5-d4', 'Pe5-d5', 'Pe5-d6', 'Pe5-e4', 'Pe5-e6', 'Pe5-f4', 'Pe5-f5', 'Pe5-f6'].sort(),
    );
  });

  it('a destination holding your own piece is illegal', () => {
    // Blue Rock on e5 with Blue Paper on f6: seven steps, not eight.
    const state = load('9/9/9/5p3/4r4/9/9/9/9 blue');
    const rockMoves = moveTexts(state).filter((move) => move.startsWith('Re5'));
    expect(rockMoves).toHaveLength(7);
    expect(rockMoves).not.toContain('Re5-f6');
    expect(rockMoves).not.toContain('Re5xf6');
  });

  it('an enemy piece your type beats is a legal capture', () => {
    // Blue Rock on e5, Red Scissors on f6. Rock takes Scissors.
    const state = load('9/9/9/5S3/4r4/9/9/9/9 blue');
    expect(moveTexts(state)).toContain('Re5xf6');
  });

  it('an enemy piece of the same type is illegal', () => {
    // Blue Rock on e5, Red Rock on f6.
    const state = load('9/9/9/5R3/4r4/9/9/9/9 blue');
    const toF6 = moveTexts(state).filter((move) => move.endsWith('f6'));
    expect(toF6).toEqual([]);
  });

  it('an enemy piece that beats your type is illegal', () => {
    // Blue Rock on e5, Red Paper on f6. Paper beats Rock, so Rock may not enter.
    const state = load('9/9/9/5P3/4r4/9/9/9/9 blue');
    const toF6 = moveTexts(state).filter((move) => move.endsWith('f6'));
    expect(toF6).toEqual([]);
  });

  it('covers the whole 2.6 table in one position', () => {
    // Red Paper d6 beats Rock, Red Rock e6 is the same type, Red Scissors f6 loses.
    const state = load('9/9/9/3PRS3/4r4/9/9/9/9 blue');
    expect(moveTexts(state).sort()).toEqual(
      ['Re5-d4', 'Re5-d5', 'Re5-e4', 'Re5-f4', 'Re5-f5', 'Re5xf6'].sort(),
    );
  });

  it('removes a captured piece for the rest of the game', () => {
    const before = load('9/9/9/5S3/4r4/9/9/9/9 blue');
    expect(typeCounts(before).red.scissors).toBe(1);

    const after = play(before, 'Re5xf6');
    expect(typeCounts(after).red.scissors).toBe(0);
    expect(toFen(after)).toBe('9/9/9/5r3/9/9/9/9/9 red');
  });

  it('never makes capturing compulsory', () => {
    const state = load('9/9/9/3PRS3/4r4/9/9/9/9 blue');
    const moves = moveTexts(state);
    expect(moves).toContain('Re5xf6');
    expect(moves.filter((move) => !move.includes('x')).length).toBeGreaterThan(0);
  });

  it('does not mutate the state it was given', () => {
    const before = load('9/9/9/5S3/4r4/9/9/9/9 blue');
    const fenBefore = toFen(before);
    play(before, 'Re5xf6');
    expect(toFen(before)).toBe(fenBefore);
    expect(before.ply).toBe(0);
    expect(before.turn).toBe('blue');
  });
});

describe('winning by the corner (spec 2.7)', () => {
  it('wins by stepping onto an empty goal square', () => {
    const state = load('R8/7s1/9/9/9/9/9/9/9 blue');
    expect(play(state, 'Sh8-i9#').result).toEqual({ winner: 'blue', reason: 'corner' });
  });

  it('wins by capturing onto an occupied goal square', () => {
    const state = load('R7P/7s1/9/9/9/9/9/9/9 blue');
    expect(play(state, 'Sh8xi9#').result).toEqual({ winner: 'blue', reason: 'corner' });
  });

  it('lets a player move onto their own corner without ending anything', () => {
    // Red entering i9 — Red's own corner — is Red defending, not Red winning.
    const state = load('9/7R1/9/9/9/9/9/9/s8 red');
    const after = play(state, 'Rh8-i9');
    expect(after.result).toBeNull();
    expect(toFen(after)).toBe('8R/9/9/9/9/9/9/9/s8 blue');
  });

  it('marks a loaded position in which a side already stands on its goal as over', () => {
    // A Blue piece on i9 — Blue's goal — means Blue has already won.
    const state = load('8s/9/9/9/9/9/9/9/1R7 blue');
    expect(state.result).toEqual({ winner: 'blue', reason: 'corner' });
    expect(legalMoves(state)).toEqual([]);
  });

  it('checks the corner before the no-moves rule when a move triggers both', () => {
    // Sh8xi9 takes Red's last piece AND reaches the goal. The corner wins.
    const state = load('8P/7s1/9/9/9/9/9/9/9 blue');
    expect(play(state, 'Sh8xi9#').result).toEqual({ winner: 'blue', reason: 'corner' });
  });

  it('does not let a piece enter a goal held by a piece it cannot beat', () => {
    // Red Rock sits on i9; Blue Scissors cannot take a Rock. That is the Keep.
    const state = load('8R/7s1/9/9/9/9/9/9/9 blue');
    expect(moveTexts(state)).not.toContain('Sh8-i9#');
    expect(moveTexts(state)).not.toContain('Sh8xi9#');
    expect(moveTexts(state)).toHaveLength(7);
  });
});

describe('the 2x2 Corner goal (spec 3)', () => {
  const corner2x2 = getVariant('corner2x2');

  it('wins on any square of the block', () => {
    const state = load('R8/9/6s2/9/9/9/9/9/9 blue', corner2x2);
    expect(play(state, 'Sg7-h8#').result).toEqual({ winner: 'blue', reason: 'corner' });
  });

  it('is not a goal in the Original', () => {
    const state = load('R8/9/6s2/9/9/9/9/9/9 blue');
    expect(play(state, 'Sg7-h8').result).toBeNull();
  });

  it('starts with no piece in either block', () => {
    const state = createGame(corner2x2);
    for (const name of ['h8', 'i8', 'h9', 'i9', 'a1', 'b1', 'a2', 'b2']) {
      expect(state.board[parseSquare(name)]).toBe(0);
    }
  });
});

describe('losing with no legal moves (spec 2.8)', () => {
  it('loses for the side to move when it is walled in', () => {
    const state = load('sR7/RR7/9/9/9/9/9/9/8P blue');
    expect(legalMoves(state)).toEqual([]);
    expect(state.result).toEqual({ winner: 'red', reason: 'no-moves' });
  });

  it('loses for a side with no pieces left', () => {
    // Red Paper takes Blue's last piece, away from either corner.
    const state = load('9/9/9/4rP3/9/9/9/9/9 red');
    expect(play(state, 'Pf6xe6').result).toEqual({ winner: 'red', reason: 'no-moves' });
  });
});

describe('draws (spec 2.9)', () => {
  it('draws on the third occurrence, counting the start position', () => {
    // Two Rocks eight files apart. Same type, so they can never capture, and
    // shuffling returns the position exactly.
    let state = load('9/9/9/9/r7R/9/9/9/9 blue');
    const cycle = ['Ra5-a4', 'Ri5-i4', 'Ra4-a5', 'Ri4-i5'];

    // One cycle returns to the start position: that is occurrence two.
    for (const text of cycle) state = play(state, text);
    expect(state.result).toBeNull();
    expect(state.ply).toBe(4);

    // The second cycle makes it three.
    for (const text of cycle) state = play(state, text);
    expect(state.result).toEqual({ winner: null, reason: 'repetition' });
    expect(state.ply).toBe(8);
  });

  it('draws at the 300th ply', () => {
    // GameState is plain data (7.2), so the limit can be tested without
    // playing 300 shuffling moves that would draw by repetition first.
    const base = load('9/9/9/9/r7R/9/9/9/9 blue');
    const state: GameState = { ...base, ply: 299 };
    const after = play(state, 'Ra5-a4');

    expect(after.ply).toBe(300);
    expect(after.result).toEqual({ winner: null, reason: 'move-limit' });
  });

  it('does not draw one ply early', () => {
    const base = load('9/9/9/9/r7R/9/9/9/9 blue');
    const after = play({ ...base, ply: 298 }, 'Ra5-a4');
    expect(after.ply).toBe(299);
    expect(after.result).toBeNull();
  });

  it('lets either side resign at any time', () => {
    const state = createGame(original);
    expect(resign(state, 'blue').result).toEqual({ winner: 'red', reason: 'resign' });
    expect(resign(state, 'red').result).toEqual({ winner: 'blue', reason: 'resign' });
  });
});

describe('a finished game accepts nothing (spec 11.4)', () => {
  it('has no legal moves and throws on applyMove', () => {
    const state = load('R8/7s1/9/9/9/9/9/9/9 blue');
    const won = play(state, 'Sh8-i9#');

    expect(won.result).not.toBeNull();
    expect(legalMoves(won)).toEqual([]);
    expect(() => applyMove(won, { from: parseSquare('i9'), to: parseSquare('h8') })).toThrow(
      IllegalMoveError,
    );
  });

  it('throws on a move that is simply not legal', () => {
    const state = createGame(original);
    expect(() => applyMove(state, { from: parseSquare('a1'), to: parseSquare('a2') })).toThrow(
      IllegalMoveError,
    );
  });
});

describe('neutral pieces (spec 4.2)', () => {
  it('4.2.1 moves a neutral only to capture an adjacent enemy piece it beats', () => {
    const state = load('R8/9/9/5S3/4nR4/3s5/9/9/9 blue', neutrals);
    expect(moveTexts(state)).toContain('nRe5xf6');
  });

  it('4.2.2 never moves a neutral to an empty square', () => {
    const state = load('R8/9/9/5S3/4nR4/3s5/9/9/9 blue', neutrals);
    const neutralMoves = moveTexts(state).filter((move) => move.startsWith('n'));
    expect(neutralMoves).toEqual(['nRe5xf6']);
    expect(neutralMoves.every((move) => move.includes('x'))).toBe(true);
  });

  it('4.2.3 does not let a neutral you use capture your own pieces', () => {
    // The neutral Rock on e5 touches Blue's own Scissors on d4 as well as Red's
    // on f6. Blue may only fire it at Red.
    const state = load('R8/9/9/5S3/4nR4/3s5/9/9/9 blue', neutrals);
    expect(moveTexts(state)).not.toContain('nRe5xd4');
  });

  it('4.2.3 never lets a neutral capture another neutral', () => {
    // Neutral Rock on e5 beats the neutral Scissors on f6 — but not here.
    const state = load('R8/9/9/5nS3/4nR4/3s5/9/9/9 blue', neutrals);
    expect(moveTexts(state).filter((move) => move.startsWith('n'))).toEqual([]);
  });

  it('4.2.4 lets either player capture a neutral their type beats', () => {
    const blueToPlay = load('R8/9/9/9/4nR4/3p5/9/9/9 blue', neutrals);
    expect(moveTexts(blueToPlay)).toContain('Pd4xe5');
    expect(toFen(play(blueToPlay, 'Pd4xe5'))).toBe('R8/9/9/9/4p4/9/9/9/9 red');
  });

  it('4.2.5 wins nothing when a neutral lands on a goal square', () => {
    // Blue fires the neutral Paper at the Red Rock sitting on Blue's goal.
    const state = load('8R/7nP1/9/9/9/9/9/S8/9 blue', neutrals);
    const after = play(state, 'nPh8xi9');
    expect(after.result).toBeNull();
    expect(after.turn).toBe('red');
  });

  it('4.2.6 blocks a goal square a neutral stands on', () => {
    // Blue's Rock on i8 cannot take the neutral Paper on i9; its Scissors can.
    const state = load('R7nP/7sr/9/9/9/9/9/9/9 blue', neutrals);
    const moves = moveTexts(state);
    expect(moves).not.toContain('Ri8-i9#');
    expect(moves).not.toContain('Ri8xi9#');
    expect(moves).toContain('Sh8xi9#');
    expect(play(state, 'Sh8xi9#').result).toEqual({ winner: 'blue', reason: 'corner' });
  });

  it('4.2.7 counts a neutral move as the turn, for the ply count and repetition', () => {
    const state = load('R8/9/9/5S3/4nR4/3s5/9/9/9 blue', neutrals);
    const after = play(state, 'nRe5xf6');
    expect(after.ply).toBe(1);
    expect(after.turn).toBe('red');
    expect(after.positionCounts.size).toBe(2);
  });

  it('4.2.8 does not count a player with only a neutral capture as out of moves', () => {
    // Blue has no pieces at all, but may fire the neutral Paper at Red's Rock.
    const state = load('8R/7nP1/9/9/9/9/9/S8/9 blue', neutrals);
    expect(state.result).toBeNull();
    expect(moveTexts(state)).toEqual(['nPh8xi9']);
  });

  it('4.2.9 keeps a piece non-permanent while a neutral of its predator type is on the board', () => {
    // Blue Rock on e5. Red has no Paper, but a neutral Paper sits on g7.
    const withNeutral = load('9/9/6nP2/9/4r4/9/9/9/8S blue', neutrals);
    expect(isPermanent(withNeutral, parseSquare('e5'))).toBe(false);

    // Same position without it: nothing can take the Rock.
    const withoutNeutral = load('9/9/9/9/4r4/9/9/9/8S blue', neutrals);
    expect(isPermanent(withoutNeutral, parseSquare('e5'))).toBe(true);
  });

  it('rejects a neutral piece in a variant that has none', () => {
    expect(() => load('R8/9/9/9/4nR4/3p5/9/9/9 blue')).toThrow(/no neutral pieces/);
  });
});

describe('the Keep (spec 2.10 and 7.6)', () => {
  it('makes a piece permanent once the opponent has lost its predator type', () => {
    // Red has only Scissors, so Blue's Rock can never be taken.
    const state = load('9/9/9/4S4/9/9/9/1r7/9 blue');
    expect(isPermanent(state, parseSquare('b2'))).toBe(true);
    // Red's Scissors, meanwhile, is prey for Blue's Rock.
    expect(isPermanent(state, parseSquare('e6'))).toBe(false);
  });

  it('is not permanent for an empty square', () => {
    const state = createGame(original);
    expect(isPermanent(state, parseSquare('e5'))).toBe(false);
  });

  it('seals the corner when a permanent piece parks on it', () => {
    const before = load('9/9/9/4S4/9/9/9/1r7/9 blue');
    expect(isSealed(before, 'blue')).toBe(false);

    const after = play(before, 'Rb2-a1');
    expect(isSealed(after, 'blue')).toBe(true);
  });

  it('reports an open corner while the attacker has a clear path', () => {
    const state = createGame(original);
    expect(isSealed(state, 'blue')).toBe(false);
    expect(isSealed(state, 'red')).toBe(false);
  });

  it('is not sealed when the attacker has no pieces at all', () => {
    const state = load('9/9/9/9/9/9/9/1r7/9 blue');
    expect(isSealed(state, 'blue')).toBe(false);
  });

  it('unseals when the sealing piece moves away', () => {
    const sealed = play(load('9/9/9/4S4/9/9/9/1r7/9 blue'), 'Rb2-a1');
    expect(isSealed(sealed, 'blue')).toBe(true);

    // Red moves, then Blue steps off the corner.
    const redMoved = play(sealed, 'Se6-e5');
    const unsealed = play(redMoved, 'Ra1-b2');
    expect(isSealed(unsealed, 'blue')).toBe(false);
  });

  it('seals a corner behind a wall the attacker cannot pass', () => {
    // Blue Rocks on a2, b2 and b1 are permanent (Red has no Paper) and cut a1
    // off from the rest of the board.
    const state = load('9/9/9/4S4/9/9/9/rr7/1r7 red');
    expect(isSealed(state, 'blue')).toBe(true);
  });
});

describe('information aids (spec 10.5)', () => {
  // Reminder for every FEN in this block (fen.ts): blue is lowercase, red
  // is uppercase, a neutral is `n` + an uppercase letter.

  it('nearestRunnerSquare picks the piece nearestRunner measured, not just any of theirs', () => {
    // Blue's Paper on e5 is 4 king-moves from the goal at i9; the Rock on a1 is 8.
    const state = load('9/9/9/9/4p4/9/9/9/r8 blue');
    expect(nearestRunnerSquare(state, 'blue')).toBe(parseSquare('e5'));
  });

  it('nearestRunnerSquare is null for a side with nothing left on the board', () => {
    const state = load('9/9/9/9/9/9/9/9/r8 blue');
    expect(nearestRunnerSquare(state, 'red')).toBeNull();
  });

  it('threatenedBy: an adjacent predator counts, a non-predator neighbour does not', () => {
    // e5 Blue Paper; e6 Red Scissors beats Paper (threat); d5 Blue Rock does
    // not — it's Blue's own piece, and Rock beats Scissors, not the reverse.
    const state = load('9/9/9/4S4/3rp4/9/9/9/9 blue');
    expect(threatenedBy(state, parseSquare('e5'))).toEqual([parseSquare('e6')]);
    expect(threatenedBy(state, parseSquare('d5'))).toEqual([]);
  });

  it('threatenedBy sees a neutral predator too — a third party either side could use', () => {
    const neutralState = load('9/9/9/4nS4/4p4/9/9/9/9 blue', neutrals);
    expect(threatenedBy(neutralState, parseSquare('e5'))).toEqual([parseSquare('e6')]);
  });

  it('defendersOf: a friendly piece one step behind in the cycle guards it', () => {
    // e5 Blue Paper attacked by e6 Red Scissors; d5 Blue Rock is Paper's
    // guard by the cycle identity — Rock beats Scissors, so recapturing on
    // e5 punishes whatever took it.
    const state = load('9/9/9/4S4/3rp4/9/9/9/9 blue');
    expect(defendersOf(state, parseSquare('e5'))).toEqual([parseSquare('d5')]);
    // d5's own guard would be a Scissors, and there isn't one.
    expect(defendersOf(state, parseSquare('d5'))).toEqual([]);
  });

  it('defendersOf ignores an enemy piece of the guarding type — only a friendly one counts', () => {
    const state = load('9/9/9/4S4/3Rp4/9/9/9/9 blue');
    expect(defendersOf(state, parseSquare('e5'))).toEqual([]);
  });

  it('defendersOf is empty for an empty square', () => {
    const state = createGame(original);
    expect(defendersOf(state, parseSquare('e5'))).toEqual([]);
  });

  it("capturesFrom matches what the mover's own piece can actually capture", () => {
    // Same fixture as the threatenedBy test above: d5 Blue Rock is adjacent
    // to e6 Red Scissors and beats it; e5 Blue Paper is not adjacent to
    // anything it beats.
    const state = load('9/9/9/4S4/3rp4/9/9/9/9 blue');
    expect(capturesFrom(state, parseSquare('d5'))).toEqual([parseSquare('e6')]);
    expect(capturesFrom(state, parseSquare('e5'))).toEqual([]);
  });

  it("capturesFrom reads the OPPONENT's own piece as what it would capture on ITS turn", () => {
    // It's Blue's move, but hovering Red's Scissors on e6 asks what e6 would
    // take if it were Red's turn instead — Scissors beats Blue's Paper on e5.
    const state = load('9/9/9/4S4/3rp4/9/9/9/9 blue');
    expect(capturesFrom(state, parseSquare('e6'))).toEqual([parseSquare('e5')]);
  });

  it('capturesFrom reads a neutral as used by the side to move, never against that side\'s own piece', () => {
    // The neutral Scissors on e6 beats Paper by type, but Paper here belongs
    // to Blue — the same side whose turn it is — and 4.2.3 forbids a neutral
    // from taking the side using it.
    const ownPaper = load('9/9/9/4nS4/4p4/9/9/9/9 blue', neutrals);
    expect(capturesFrom(ownPaper, parseSquare('e6'))).toEqual([]);

    // Red's Paper in the same spot is fair game for Blue's use of it.
    const enemyPaper = load('9/9/9/4nS4/4P4/9/9/9/9 blue', neutrals);
    expect(capturesFrom(enemyPaper, parseSquare('e6'))).toEqual([parseSquare('e5')]);
    // And the reverse holds when it's Red's move instead — now Red can't
    // use it against Red's own Paper.
    const redToMove = load('9/9/9/4nS4/4P4/9/9/9/9 red', neutrals);
    expect(capturesFrom(redToMove, parseSquare('e6'))).toEqual([]);
  });

  it('capturesFrom is empty for an empty square', () => {
    const state = createGame(original);
    expect(capturesFrom(state, parseSquare('e5'))).toEqual([]);
  });

  it('threatenedBy is empty for an empty square', () => {
    const state = createGame(original);
    expect(threatenedBy(state, parseSquare('e5'))).toEqual([]);
  });

  it("dangerAfter warns when the landing square is next to the piece's predator", () => {
    // Blue Paper on d5 stepping to e5 lands beside Red's Scissors on e6.
    const state = load('9/9/9/4S4/3p5/9/9/9/9 blue');
    const move = legalMoves(state).find((m) => m.from === parseSquare('d5') && m.to === parseSquare('e5'))!;
    expect(dangerAfter(state, move)).toBe(true);
  });

  it('dangerAfter is quiet when nothing beats the piece where it lands', () => {
    const state = createGame(original);
    const move = legalMoves(state)[0]!;
    expect(dangerAfter(state, move)).toBe(false);
  });

  it('dangerAfter never flags a capture that removed the only threat', () => {
    // Blue's Rock captures Red's Scissors on e6 — the only piece that could
    // have threatened it there, gone the instant the capture happens.
    const state = load('9/9/9/4S4/4r4/9/9/9/9 blue');
    const move = legalMoves(state).find((m) => m.captured)!;
    expect(dangerAfter(state, move)).toBe(false);
  });
});

describe('events (spec 7.5 and 7.7)', () => {
  it('emits move, then capture, then type-extinct', () => {
    // Blue Scissors takes Red's last Paper; Red keeps a Rock, so nothing seals.
    const state = load('9/9/9/4Ps3/9/9/9/9/8R blue');
    const { events } = applyMove(state, parseMove(state, 'Sf6xe6'));

    expect(events.map((event) => event.type)).toEqual(['move', 'capture', 'type-extinct']);
    expect(events[1]).toMatchObject({
      type: 'capture',
      captured: { owner: 'red', type: 'paper' },
      by: { owner: 'blue', type: 'scissors' },
    });
    expect(events[2]).toEqual({ type: 'type-extinct', side: 'red', pieceType: 'paper' });
  });

  it('emits type-extinct only when the count reaches zero', () => {
    // Red has two Papers, so taking one extinguishes nothing.
    const state = load('9/9/3P5/4Ps3/9/9/9/9/8R blue');
    const { events } = applyMove(state, parseMove(state, 'Sf6xe6'));
    expect(events.map((event) => event.type)).toEqual(['move', 'capture']);
  });

  it('emits sealed when a corner becomes unreachable', () => {
    const state = load('9/9/9/4S4/9/9/9/1r7/9 blue');
    const { events } = applyMove(state, parseMove(state, 'Rb2-a1'));
    expect(events.map((event) => event.type)).toEqual(['move', 'sealed']);
    expect(events[1]).toEqual({ type: 'sealed', side: 'blue' });
  });

  it('emits game-over last', () => {
    const state = load('R8/7s1/9/9/9/9/9/9/9 blue');
    const { events } = applyMove(state, parseMove(state, 'Sh8-i9#'));
    expect(events.at(-1)).toEqual({
      type: 'game-over',
      result: { winner: 'blue', reason: 'corner' },
    });
  });
});

describe('the starting position (spec 2.3)', () => {
  let state: GameState;
  beforeEach(() => {
    state = createGame(original);
  });

  it('gives each side 4 Paper, 3 Rock and 3 Scissors', () => {
    expect(typeCounts(state)).toEqual({
      blue: { rock: 3, paper: 4, scissors: 3 },
      red: { rock: 3, paper: 4, scissors: 3 },
    });
  });

  it('is 180-degree rotationally symmetric', () => {
    for (let square = 0; square < 81; square++) {
      const mirrored = 80 - square;
      const here = state.board[square]!;
      const there = state.board[mirrored]!;
      if (here === 0) {
        expect(there).toBe(0);
        continue;
      }
      // Blue codes are 1-3 and Red codes 5-7: the same type, the other owner.
      expect(there).toBe(here <= 3 ? here + 4 : here - 4);
    }
  });

  it('has Blue to move, ply 0 and no result', () => {
    expect(state.turn).toBe('blue');
    expect(state.ply).toBe(0);
    expect(state.result).toBeNull();
  });

  it('round-trips through the position notation', () => {
    expect(toFen(state)).toBe(original.start);
  });
});

describe('a Keep can be forced open (there is no passing)', () => {
  // Vig's case: the sealing side's only piece is the one standing on its own
  // corner. Its turn comes, it has to move, and the corner opens. `isSealed`
  // says true; the seal is one move from gone.
  const loneKeep = '9/9/9/4S4/9/9/9/9/r8 blue';

  it('reports the corner sealed, because right now it is', () => {
    const state = load(loneKeep);
    expect(isPermanent(state, parseSquare('a1'))).toBe(true);
    expect(isSealed(state, 'blue')).toBe(true);
  });

  it('cannot hold it, because every legal move abandons the corner', () => {
    const state = load(loneKeep);
    expect(canHoldSeal(state, 'blue')).toBe(false);
    for (const text of moveTexts(state)) {
      expect(isSealed(play(state, text), 'blue')).toBe(false);
    }
  });

  it('holds it when there is another piece to move instead', () => {
    // The same Keep, with a spare Blue Rock that can shuffle harmlessly.
    const state = load('9/9/9/4S4/9/9/9/6r2/r8 blue');
    expect(isSealed(state, 'blue')).toBe(true);
    expect(canHoldSeal(state, 'blue')).toBe(true);
  });

  it('says nothing is forcing a side that is not to move', () => {
    const state = load('9/9/9/4S4/9/9/9/9/r8 red');
    expect(canHoldSeal(state, 'blue')).toBe(true);
  });

  it('is false wherever the corner is not sealed at all', () => {
    expect(canHoldSeal(createGame(original), 'blue')).toBe(false);
  });
});
