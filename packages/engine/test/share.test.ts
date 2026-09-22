// Spec 8.4: `/#g=<base64url of the record without players and seed>`.
// A link that does not round-trip exactly is a game that opens as a different
// game, so this leans on the same fixtures the rules are tested against.

import { describe, expect, it } from 'vitest';
import { ShareError } from '../src/errors.js';
import { SHARE_PREFIX, base64UrlDecode, base64UrlEncode, decodeRecord, encodeRecord } from '../src/share.js';
import { replay } from '../src/game.js';
import { VARIANTS } from '../src/variants.js';
import type { GameRecord } from '../src/types.js';

const RECORD: GameRecord = {
  game: 'stone-paper-scissors',
  rulesVersion: 1,
  variant: 'original',
  start: VARIANTS.original.start,
  moves: ['Sd4-d5', 'Se7-d6', 'Rc3-c2'],
};

describe('base64url', () => {
  it('round-trips every byte length, so no group of 1, 2 or 3 is mishandled', () => {
    for (let length = 0; length < 64; length++) {
      const bytes = Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
      expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
    }
  });

  it('is URL-safe: no +, / or = ever appears', () => {
    const bytes = Array.from({ length: 256 }, (_, i) => i);
    const encoded = base64UrlEncode(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects text that is not base64url', () => {
    expect(() => base64UrlDecode('abc!')).toThrow(ShareError);
    expect(() => base64UrlDecode('a')).toThrow(ShareError); // no 6-bit records
  });
});

describe('game records (spec 8.4)', () => {
  it('round-trips a record', () => {
    expect(decodeRecord(encodeRecord(RECORD))).toEqual(RECORD);
  });

  it('drops players and seed, and keeps the clock', () => {
    const encoded = encodeRecord({
      ...RECORD,
      players: { blue: 'human', red: 'computer:hard' },
      seed: 918273,
      clock: { control: '10+5', initialMs: 600_000, incrementMs: 5_000, remainingMs: [1, 2, 3] },
    });
    const decoded = decodeRecord(encoded);
    expect(decoded.players).toBeUndefined();
    expect(decoded.seed).toBeUndefined();
    // Spec's own reason: a shared game must not be able to hide a time gift.
    expect(decoded.clock?.remainingMs).toEqual([1, 2, 3]);
  });

  it('accepts the hash form as well as the bare payload', () => {
    const encoded = encodeRecord(RECORD);
    expect(decodeRecord(`${SHARE_PREFIX}${encoded}`)).toEqual(RECORD);
  });

  it('decodes into a position that actually replays', () => {
    const decoded = decodeRecord(encodeRecord(RECORD));
    const { state } = replay(VARIANTS[decoded.variant], decoded.moves);
    expect(state.ply).toBe(3);
  });

  it('survives a long game, and stays small enough for a URL', () => {
    // Spec 8.4's own sizing claim: "a 140-ply game is about 1 KB of moves
    // before encoding, which fits comfortably in a URL".
    const long: GameRecord = { ...RECORD, moves: Array.from({ length: 140 }, () => 'Sd4-d5') };
    expect(decodeRecord(encodeRecord(long)).moves).toHaveLength(140);
    expect(encodeRecord(long).length).toBeLessThan(2048);
  });

  it('rejects a record from another game, version or variant', () => {
    const mangle = (record: object) => base64UrlEncode([...JSON.stringify(record)].map((c) => c.charCodeAt(0)));
    expect(() => decodeRecord(mangle({ ...RECORD, game: 'chess' }))).toThrow(ShareError);
    expect(() => decodeRecord(mangle({ ...RECORD, rulesVersion: 2 }))).toThrow(ShareError);
    expect(() => decodeRecord(mangle({ ...RECORD, variant: 'hexagonal' }))).toThrow(ShareError);
    expect(() => decodeRecord(mangle({ ...RECORD, moves: [1, 2] }))).toThrow(ShareError);
    expect(() => decodeRecord(mangle([1, 2, 3]))).toThrow(ShareError);
  });

  it('rejects truncated or corrupt payloads rather than half-reading them', () => {
    const encoded = encodeRecord(RECORD);
    expect(() => decodeRecord(encoded.slice(0, 20))).toThrow(ShareError);
    expect(() => decodeRecord('')).toThrow(ShareError);
  });

  it('carries non-ASCII text through intact', () => {
    // Nothing in v1 writes a player name into a shared record, but the codec
    // is the kind of thing that gets reused before it gets re-read — so UTF-8
    // is tested now rather than discovered later by a name with an accent.
    const decoded = decodeRecord(encodeRecord({ ...RECORD, start: 'café ♞ 𝒢' as string }));
    expect(decoded.start).toBe('café ♞ 𝒢');
  });
});
