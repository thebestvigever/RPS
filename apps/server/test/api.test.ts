import { describe, expect, it } from 'vitest';
import { isMatchId, isToken, parseInvite } from '@sps/referee';
import { matchIdFrom, parseCreateMatch } from '../src/api.js';
import { newMatchId, newToken, pickSide } from '../src/ids.js';

describe('creating a match', () => {
  it('has defaults, so an empty body is a game', () => {
    const parsed = parseCreateMatch({});
    expect(parsed.ok && parsed.value.variant).toBe('original');
    expect(parsed.ok && parsed.value.control.id).toBe('3+2');
    expect(parsed.ok && parsed.value.mode).toBe('online-casual');
    expect(parsed.ok && parsed.value.side).toBe('random');
  });

  it('takes the three variants and the presets', () => {
    expect(parseCreateMatch({ variant: 'neutrals', control: '10+5' })).toMatchObject({
      ok: true,
      value: { variant: 'neutrals' },
    });
    expect(parseCreateMatch({ control: 'unlimited' }).ok).toBe(true);
  });

  it('refuses a time control nobody offered', () => {
    // A control off the wire is a stage list from a stranger, and a room is a
    // thing with an alarm on it.
    expect(parseCreateMatch({ control: '9999+0' })).toEqual({
      ok: false,
      reason: 'unknown time control "9999+0"',
    });
    expect(parseCreateMatch({ control: { stages: [] } }).ok).toBe(false);
  });

  it('refuses anything else it does not recognise', () => {
    expect(parseCreateMatch({ variant: 'chess' }).ok).toBe(false);
    expect(parseCreateMatch({ mode: 'friendly' }).ok).toBe(false);
    expect(parseCreateMatch({ side: 'green' }).ok).toBe(false);
    expect(parseCreateMatch({ name: 42 }).ok).toBe(false);
    expect(parseCreateMatch([]).ok).toBe(false);
    expect(parseCreateMatch(null).ok).toBe(false);
    expect(parseCreateMatch('original').ok).toBe(false);
  });

  it('trims a name down to something a board can show', () => {
    const parsed = parseCreateMatch({ name: `  ${'V'.repeat(80)}  ` });
    expect(parsed.ok && parsed.value.name).toHaveLength(40);
    expect(parseCreateMatch({ name: '   ' })).toMatchObject({ ok: true, value: { name: null } });
  });
});

describe('routing', () => {
  it('finds a match id in the paths that carry one', () => {
    expect(matchIdFrom('/ws/abcd1234', '/ws/')).toBe('abcd1234');
    expect(matchIdFrom('/api/match/abcd1234', '/api/match/')).toBe('abcd1234');
    expect(matchIdFrom('/api/match/abcd1234/summary', '/api/match/')).toBe('abcd1234');
  });

  it('finds nothing in a path that does not carry one', () => {
    expect(matchIdFrom('/api/match', '/api/match/')).toBe(null);
    expect(matchIdFrom('/ws/', '/ws/')).toBe(null);
    expect(matchIdFrom('/ws/../secrets', '/ws/')).toBe(null);
    expect(matchIdFrom('/api/match/has spaces', '/api/match/')).toBe(null);
  });
});

describe('ids', () => {
  it('makes tokens and match ids the referee will accept', () => {
    for (let i = 0; i < 50; i++) {
      expect(isToken(newToken())).toBe(true);
      expect(isMatchId(newMatchId())).toBe(true);
    }
  });

  it('makes links that survive the round trip', () => {
    const matchId = newMatchId();
    const token = newToken();
    expect(parseInvite(`https://sps.example/#m=${matchId}.${token}`)).toEqual({ matchId, token });
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newToken()));
    expect(seen.size).toBe(200);
  });

  it('honours a chosen side and actually varies a random one', () => {
    expect(pickSide('blue')).toBe('blue');
    expect(pickSide('red')).toBe('red');
    const drawn = new Set(Array.from({ length: 100 }, () => pickSide('random')));
    expect([...drawn].sort()).toEqual(['blue', 'red']);
  });
});
