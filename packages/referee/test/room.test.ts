import { describe, expect, it } from 'vitest';
import { legalMoves } from '@sps/engine';
import { TOKENS, only, playMoves, seated, table } from './harness.js';

describe('joining by link', () => {
  it('seats the first player and starts nothing', () => {
    const t = table();
    t.connect('blue-1');
    t.send('blue-1', { t: 'hello', matchId: 'match-one', token: TOKENS.blue, lastPly: 0, name: 'Vig' });

    const [welcome] = only(t.drain('blue-1'), 'welcome');
    expect(welcome?.you).toBe('blue');
    expect(welcome?.record.moves).toEqual([]);
    expect(welcome?.presence).toEqual({ blue: 'online', red: 'away' });
    // Nothing ticks until there is somebody to play: a match waiting for its
    // second player is not yet a game.
    expect(welcome?.clocks.running).toBe(null);
    expect(t.room.state.startedAt).toBe(null);
  });

  it('starts the game when the second person opens the link', () => {
    const t = table();
    t.connect('blue-1');
    t.send('blue-1', { t: 'hello', matchId: 'match-one', token: TOKENS.blue, lastPly: 0 }, 0);
    t.drain('blue-1');

    t.connect('red-1', 5_000);
    t.send('red-1', { t: 'hello', matchId: 'match-one', token: TOKENS.red, lastPly: 0 }, 5_000);

    const [welcome] = only(t.drain('red-1'), 'welcome');
    expect(welcome?.you).toBe('red');
    expect(welcome?.clocks.running).toBe('blue');

    const blueSaw = t.drain('blue-1');
    expect(only(blueSaw, 'presence')[0]).toEqual({ t: 'presence', blue: 'online', red: 'online' });
    expect(only(blueSaw, 'started')[0]?.clocks.running).toBe('blue');
    expect(t.room.state.startedAt).toBe(5_000);
  });

  it('lets a link with no token watch, and lets it do nothing else', () => {
    const t = seated();
    t.connect('watcher', 1_000);
    t.send('watcher', { t: 'hello', matchId: 'match-one', token: null, lastPly: 0 }, 1_000);
    expect(only(t.drain('watcher'), 'welcome')[0]?.you).toBe('spectator');

    t.send('watcher', { t: 'move', ply: 0, move: t.legal() }, 2_000);
    expect(only(t.drain('watcher'), 'error')[0]?.code).toBe('spectator');
    expect(t.room.game.ply).toBe(0);

    // But it does see the game.
    playMoves(t, 1, 2_000);
    expect(only(t.drain('watcher'), 'moved')).toHaveLength(1);
  });

  it('refuses a token this match never issued, and hangs up', () => {
    const t = table();
    t.connect('stranger');
    t.send('stranger', { t: 'hello', matchId: 'match-one', token: 'some-other-token', lastPly: 0 });
    expect(only(t.drain('stranger'), 'error')[0]?.code).toBe('bad-token');
    expect(t.hangups).toHaveLength(1);
  });

  it('refuses a hello for a different match', () => {
    const t = table();
    t.connect('lost');
    t.send('lost', { t: 'hello', matchId: 'some-other-match', token: TOKENS.blue, lastPly: 0 });
    expect(only(t.drain('lost'), 'error')[0]?.code).toBe('wrong-match');
  });

  it('answers nothing before hello', () => {
    const t = table();
    t.connect('quiet');
    t.send('quiet', { t: 'move', ply: 0, move: 'Sd4-e5' });
    expect(only(t.drain('quiet'), 'error')[0]?.code).toBe('hello-required');
    expect(t.hangups).toHaveLength(1);
  });
});

describe('moves', () => {
  it('broadcasts the move and its events to everybody', () => {
    const t = seated();
    const move = t.legal();
    t.send('blue-1', { t: 'move', ply: 0, move }, 3_000);

    for (const id of ['blue-1', 'red-1']) {
      const [moved] = only(t.drain(id), 'moved');
      expect(moved?.ply).toBe(1);
      expect(moved?.move).toBe(move);
      // The interface animates from events, never by diffing boards.
      expect(moved?.events[0]).toMatchObject({ type: 'move' });
      expect(moved?.clocks.running).toBe('red');
    }
    expect(t.room.state.moves).toEqual([move]);
  });

  it('rejects a move from the side that is not to move', () => {
    const t = seated();
    t.send('red-1', { t: 'move', ply: 0, move: t.legal() }, 1_000);
    expect(only(t.drain('red-1'), 'rejected')[0]?.reason).toBe('it is not your turn');
    expect(t.room.game.ply).toBe(0);
  });

  it('rejects an illegal move, and says why', () => {
    const t = seated();
    t.send('blue-1', { t: 'move', ply: 0, move: 'Ra1-a2' }, 1_000);
    const [rejected] = only(t.drain('blue-1'), 'rejected');
    expect(rejected?.ply).toBe(0);
    expect(rejected?.reason).toBeTruthy();
    expect(t.room.game.ply).toBe(0);
  });

  it('rejects a repeated ply rather than playing it twice', () => {
    const t = seated();
    const move = t.legal();
    t.send('blue-1', { t: 'move', ply: 0, move }, 1_000);
    t.drain('blue-1');
    t.drain('red-1');

    // The same frame again — a client that resent after a flaky moment.
    t.send('blue-1', { t: 'move', ply: 0, move }, 1_200);
    const answer = t.drain('blue-1');
    expect(only(answer, 'rejected')[0]?.reason).toBe('that ply has already been played');
    // And it is told what it evidently missed, rather than left guessing.
    expect(only(answer, 'moved')).toHaveLength(1);
    expect(t.room.state.moves).toEqual([move]);
    expect(t.drain('red-1')).toEqual([]);
  });

  it('rejects a ply from the future', () => {
    const t = seated();
    t.send('blue-1', { t: 'move', ply: 7, move: t.legal() }, 1_000);
    expect(only(t.drain('blue-1'), 'rejected')[0]?.reason).toBe('that ply has not been reached');
  });

  it('refuses to move before there is an opponent', () => {
    const t = table();
    t.connect('blue-1');
    t.send('blue-1', { t: 'hello', matchId: 'match-one', token: TOKENS.blue, lastPly: 0 });
    t.drain('blue-1');
    t.send('blue-1', { t: 'move', ply: 0, move: t.legal() }, 1_000);
    expect(only(t.drain('blue-1'), 'rejected')[0]?.reason).toBe('the game has not started');
  });

  it('plays a real game of moves without drifting from the engine', () => {
    const t = seated();
    playMoves(t, 12);
    expect(t.room.state.moves).toHaveLength(12);
    expect(t.room.game.ply).toBe(12);
    expect(legalMoves(t.room.game).length).toBeGreaterThan(0);
  });
});

describe('endings that are not moves', () => {
  it('ends on a resignation', () => {
    const t = seated();
    playMoves(t, 4);
    t.drain('blue-1');
    t.send('red-1', { t: 'resign' }, 20_000);
    const [result] = only(t.drain('blue-1'), 'result');
    expect(result?.result).toEqual({ winner: 'blue', reason: 'resign' });
    expect(t.room.game.result).toEqual({ winner: 'blue', reason: 'resign' });
    expect(result?.clocks.running).toBe(null);
  });

  it('refuses everything once the game is over', () => {
    const t = seated();
    t.send('red-1', { t: 'resign' }, 5_000);
    t.drain('blue-1');
    t.send('blue-1', { t: 'move', ply: 0, move: 'Pc4-c5' }, 6_000);
    expect(only(t.drain('blue-1'), 'rejected')[0]?.reason).toBe('the game is over');
    t.send('blue-1', { t: 'resign' }, 6_000);
    expect(only(t.drain('blue-1'), 'error')[0]?.reason).toBe('the game is over');
  });

  it('allows an abort in the first two plies and not after', () => {
    const early = seated();
    early.send('blue-1', { t: 'abort' }, 1_000);
    expect(only(early.drain('red-1'), 'result')[0]?.result).toEqual({
      winner: null,
      reason: 'aborted',
    });

    const late = seated();
    playMoves(late, 2);
    late.drain('blue-1');
    late.send('blue-1', { t: 'abort' }, 9_000);
    expect(only(late.drain('blue-1'), 'error')[0]?.reason).toBe(
      'the game has started — resign instead',
    );
  });
});

describe('draw offers', () => {
  it('passes an offer on, and settles the game when it is taken', () => {
    const t = seated();
    playMoves(t, 6);
    t.drain('blue-1');
    t.drain('red-1');

    t.send('blue-1', { t: 'draw-offer' }, 40_000);
    expect(only(t.drain('red-1'), 'draw-offered')[0]?.by).toBe('blue');

    t.send('red-1', { t: 'draw-accept' }, 41_000);
    expect(only(t.drain('blue-1'), 'result')[0]?.result).toEqual({
      winner: null,
      reason: 'agreed',
    });
  });

  it('treats two offers at once as an agreement, not two offers', () => {
    const t = seated();
    playMoves(t, 6);
    t.send('blue-1', { t: 'draw-offer' }, 40_000);
    t.send('red-1', { t: 'draw-offer' }, 40_100);
    expect(t.room.game.result).toEqual({ winner: null, reason: 'agreed' });
  });

  it('declines an offer by playing on', () => {
    const t = seated();
    playMoves(t, 6);
    const turn = t.room.game.turn;
    const mover = turn === 'blue' ? 'blue-1' : 'red-1';
    const offerer = turn === 'blue' ? 'red-1' : 'blue-1';

    t.send(offerer, { t: 'draw-offer' }, 40_000);
    t.drain('blue-1');
    t.drain('red-1');

    t.send(mover, { t: 'move', ply: t.room.game.ply, move: t.legal() }, 41_000);
    expect(only(t.drain(offerer), 'draw-declined')[0]?.by).toBe(turn);
    expect(t.room.state.offers.pending).toBe(null);
  });

  it('refuses a draw offer the game does not allow', () => {
    const t = seated();
    t.send('blue-1', { t: 'draw-accept' }, 1_000);
    expect(only(t.drain('blue-1'), 'error')[0]?.reason).toBe('there is no draw offer');
  });

  it('does not let an offer outlive the game it was made in', () => {
    // A draw offered, then the offerer resigns before it is answered. Without
    // this, accepting afterwards would try to settle a finished game — and a
    // takeback accepted afterwards would try to un-finish one.
    const t = seated();
    playMoves(t, 4);
    t.send('blue-1', { t: 'draw-offer' }, 20_000);
    t.send('blue-1', { t: 'resign' }, 21_000);
    t.drain('red-1');

    expect(t.room.state.offers.pending).toBe(null);
    t.send('red-1', { t: 'draw-accept' }, 22_000);
    expect(only(t.drain('red-1'), 'error')[0]?.reason).toBe('the game is over');
    expect(t.room.game.result).toEqual({ winner: 'red', reason: 'resign' });
  });

  it('keeps a pending offer through a reconnect', () => {
    const t = seated();
    playMoves(t, 4);
    t.send('blue-1', { t: 'draw-offer' }, 20_000);
    t.disconnect('red-1', 21_000);
    t.connect('red-2', 22_000);
    t.send('red-2', { t: 'hello', matchId: 'match-one', token: TOKENS.red, lastPly: 4 }, 22_000);
    expect(only(t.drain('red-2'), 'welcome')[0]?.offer).toEqual({ kind: 'draw', by: 'blue' });
  });
});

describe('takebacks', () => {
  it('unmakes the asking side’s move once both agree', () => {
    const t = seated({ mode: 'online-casual' });
    playMoves(t, 5);
    const before = t.room.state.moves.slice();
    t.drain('blue-1');
    t.drain('red-1');

    // Blue has just moved (ply 5, Red to move): one ply comes off.
    expect(t.room.game.turn).toBe('red');
    t.send('blue-1', { t: 'takeback-offer' }, 30_000);
    expect(only(t.drain('red-1'), 'takeback-offered')[0]?.by).toBe('blue');

    t.send('red-1', { t: 'takeback-accept' }, 31_000);
    const [took] = only(t.drain('blue-1'), 'took-back');
    expect(took?.ply).toBe(4);
    expect(t.room.state.moves).toEqual(before.slice(0, 4));
    expect(t.room.game.ply).toBe(4);
    expect(t.room.game.turn).toBe('blue');
    expect(took?.clocks.running).toBe('blue');
  });

  it('takes back two plies when the opponent has already replied', () => {
    const t = seated();
    playMoves(t, 6);
    expect(t.room.game.turn).toBe('blue');
    t.send('blue-1', { t: 'takeback-offer' }, 30_000);
    t.send('red-1', { t: 'takeback-accept' }, 31_000);
    expect(t.room.game.ply).toBe(4);
    expect(t.room.game.turn).toBe('blue');
  });

  it('is not offered in a rated game', () => {
    const t = seated({ mode: 'rated' });
    playMoves(t, 3);
    t.send('blue-1', { t: 'takeback-offer' }, 30_000);
    expect(only(t.drain('blue-1'), 'error')[0]?.reason).toBe(
      'takeback offers are not available in this game',
    );
  });
});

describe('the flood gate', () => {
  it('drops a burst, and says so once', () => {
    const t = seated();
    for (let i = 0; i < 60; i++) t.send('blue-1', { t: 'ping', at: i }, 1_000);

    const seen = t.drain('blue-1');
    const errors = only(seen, 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('rate-limited');
    expect(only(seen, 'pong').length).toBeLessThan(60);

    // And it recovers on its own, without anybody being kicked.
    t.send('blue-1', { t: 'ping', at: 99 }, 21_000);
    expect(only(t.drain('blue-1'), 'pong')[0]?.at).toBe(99);
  });
});
