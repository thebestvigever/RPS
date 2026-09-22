// Shareable links — spec 8.4: `/#g=<base64url of the record without players
// and seed>`.
//
// This lives in the engine, beside `fen.ts` and `notation.ts`, because spec 8
// is one subject: how a game is written down. A link is the game record (8.3)
// in a form that survives a URL, and it has the same obligation the other two
// have — round-trip exactly, and reject malformed input loudly rather than
// half-decoding it.
//
// Base64 and UTF-8 are hand-rolled rather than reached for from the platform.
// `btoa` is latin1-only and deprecated in Node; `TextEncoder`/`Buffer` are
// environment-specific. The package's contract (index.ts) is that the browser,
// the AI, the test suite and any future server all run it unchanged, so the
// codec is arithmetic here and behaves identically everywhere.

import { ShareError } from './errors.js';
import { VARIANT_IDS } from './variants.js';
import type { GameRecord, VariantId } from './types.js';

/** Spec 8.4's own hash parameter. The app builds the rest of the URL. */
export const SHARE_PREFIX = '#g=';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Reverse lookup, built once. Anything not here is not base64url. */
const VALUES: ReadonlyMap<string, number> = new Map(
  [...ALPHABET].map((character, index) => [character, index]),
);

function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

function utf8Text(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const first = bytes[i]!;
    let code: number;
    let width: number;
    if (first < 0x80) {
      code = first;
      width = 1;
    } else if ((first & 0xe0) === 0xc0) {
      code = first & 0x1f;
      width = 2;
    } else if ((first & 0xf0) === 0xe0) {
      code = first & 0x0f;
      width = 3;
    } else if ((first & 0xf8) === 0xf0) {
      code = first & 0x07;
      width = 4;
    } else {
      throw new ShareError('not valid UTF-8');
    }
    if (i + width > bytes.length) throw new ShareError('truncated UTF-8 sequence');
    for (let k = 1; k < width; k++) {
      const next = bytes[i + k]!;
      if ((next & 0xc0) !== 0x80) throw new ShareError('not valid UTF-8');
      code = (code << 6) | (next & 0x3f);
    }
    out += String.fromCodePoint(code);
    i += width;
  }
  return out;
}

/** No padding: `=` is noise in a URL, and the length alone says how many bits are real. */
export function base64UrlEncode(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2]!;
    out += ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)]!;
    if (b === undefined) break;
    out += ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)]!;
    if (c === undefined) break;
    out += ALPHABET[c & 0x3f]!;
  }
  return out;
}

export function base64UrlDecode(text: string): number[] {
  // A group of 1 encodes nothing — there are no 6-bit records.
  if (text.length % 4 === 1) throw new ShareError('truncated base64url');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const character of text) {
    const next = VALUES.get(character);
    if (next === undefined) throw new ShareError(`not base64url: ${character}`);
    value = (value << 6) | next;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return bytes;
}

/**
 * Spec 8.4 is explicit that `players` and `seed` are left out: a shared game is
 * the moves, not who played them or what the opponent's generator was seeded
 * with. `clock` stays in — it is what stops a shared game hiding that someone
 * handed themselves ten extra minutes (the note on `GameClockRecord`).
 */
export function encodeRecord(record: GameRecord): string {
  const { players: _players, seed: _seed, ...shared } = record;
  return base64UrlEncode(utf8Bytes(JSON.stringify(shared)));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * Strict in the same way `fromFen` and `parseMove` are (spec 8.1, 8.2): a
 * record that says it is some other game, or some other rules version, is
 * rejected rather than replayed under this one's rules. It does NOT check the
 * moves — `replay` is what decides whether they are legal, and it already
 * reports exactly which one was not.
 */
export function decodeRecord(encoded: string): GameRecord {
  const trimmed = encoded.startsWith(SHARE_PREFIX) ? encoded.slice(SHARE_PREFIX.length) : encoded;
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Text(base64UrlDecode(trimmed)));
  } catch (cause) {
    if (cause instanceof ShareError) throw cause;
    throw new ShareError('not a readable game record');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ShareError('a game record must be an object');
  }
  const record = parsed as Partial<GameRecord>;
  if (record.game !== 'stone-paper-scissors') throw new ShareError('not a stone-paper-scissors record');
  if (record.rulesVersion !== 1) throw new ShareError(`unknown rules version: ${String(record.rulesVersion)}`);
  if (!VARIANT_IDS.includes(record.variant as VariantId)) {
    throw new ShareError(`unknown variant: ${String(record.variant)}`);
  }
  if (typeof record.start !== 'string') throw new ShareError('a game record needs a start position');
  if (!isStringArray(record.moves)) throw new ShareError('a game record needs a list of moves');

  return record as GameRecord;
}
