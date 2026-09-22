import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_BYTES, parseClientMessage } from '../src/index.js';

const parse = (value: unknown) => parseClientMessage(value);

describe('what comes off the wire', () => {
  it('reads the messages spec 13.2 named', () => {
    expect(parse('{"t":"hello","matchId":"m1","token":"abcdefgh","lastPly":0}')).toEqual({
      ok: true,
      message: { t: 'hello', matchId: 'm1', token: 'abcdefgh', lastPly: 0, name: null },
    });
    expect(parse('{"t":"move","ply":3,"move":"Sd4-e5"}')).toEqual({
      ok: true,
      message: { t: 'move', ply: 3, move: 'Sd4-e5' },
    });
    for (const t of ['resign', 'draw-offer', 'draw-accept', 'draw-decline']) {
      expect(parse(`{"t":"${t}"}`)).toEqual({ ok: true, message: { t } });
    }
    expect(parse('{"t":"ping"}')).toEqual({ ok: true, message: { t: 'ping', at: null } });
  });

  it('reads the ones the clock addendum added', () => {
    for (const t of ['abort', 'gift', 'claim', 'draw-withdraw', 'takeback-offer']) {
      expect(parse(`{"t":"${t}"}`)).toEqual({ ok: true, message: { t } });
    }
  });

  it('treats a missing or empty token as no token at all', () => {
    const anonymous = parse('{"t":"hello","matchId":"m1","token":"","lastPly":0}');
    expect(anonymous).toEqual({
      ok: true,
      message: { t: 'hello', matchId: 'm1', token: null, lastPly: 0, name: null },
    });
    expect(parse('{"t":"hello","matchId":"m1","lastPly":0}')).toEqual(anonymous);
  });

  it('never throws, whatever it is handed', () => {
    for (const junk of ['', 'null', '[]', '"hello"', '{', 'undefined', '{"t":42}', '{}']) {
      expect(() => parse(junk)).not.toThrow();
      expect(parse(junk).ok).toBe(false);
    }
    for (const junk of [null, undefined, 42, [], { t: 'move' }]) {
      expect(parse(junk).ok).toBe(false);
    }
  });

  it('refuses a frame too big to be a move', () => {
    const huge = `{"t":"move","ply":1,"move":"${'S'.repeat(MAX_MESSAGE_BYTES)}"}`;
    expect(parse(huge)).toEqual({ ok: false, reason: 'message too large' });
  });

  it('refuses move text long enough to be an attack rather than a move', () => {
    const result = parse(`{"t":"move","ply":1,"move":"${'S'.repeat(64)}"}`);
    expect(result).toEqual({ ok: false, reason: 'move is too long' });
  });

  it('refuses a ply that is not a whole number in range', () => {
    for (const ply of ['-1', '1.5', '"3"', '99999', 'null']) {
      expect(parse(`{"t":"move","ply":${ply},"move":"Sd4-e5"}`).ok).toBe(false);
    }
  });

  it('refuses a message type it has never heard of', () => {
    expect(parse('{"t":"promote"}')).toEqual({
      ok: false,
      reason: 'unknown message type "promote"',
    });
  });

  it('does not let a name become a payload', () => {
    expect(parse(`{"t":"hello","matchId":"m1","lastPly":0,"name":"${'n'.repeat(200)}"}`).ok).toBe(
      false,
    );
  });
});
