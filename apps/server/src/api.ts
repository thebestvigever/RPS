// The HTTP half: creating a match, and reading one from the outside.
//
// Kept apart from the Worker and from the Durable Object so that the awkward
// part — what a stranger is allowed to ask for — is plain functions over plain
// data, and can be tested without a runtime.

import type { VariantId } from '@sps/engine';
import { VARIANT_IDS } from '@sps/engine';
import type { TimeControl } from '@sps/match';
import { PRESETS } from '@sps/match';
import type { OnlineMode } from '@sps/referee';
import { isMatchId } from '@sps/referee';

// `CreatedMatch` and `MatchSummary` live in @sps/referee, beside the protocol:
// the browser reads the same definition this writes.
export type { CreatedMatch, MatchSummary } from '@sps/referee';

export interface CreateMatch {
  variant: VariantId;
  control: TimeControl;
  mode: OnlineMode;
  /** The seat the creator keeps; 'random' is decided by the caller. */
  side: 'blue' | 'red' | 'random';
  name: string | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const MODES: OnlineMode[] = ['online-casual', 'rated'];

/**
 * A time control must be one of the presets.
 *
 * Accepting an arbitrary control off the wire would mean accepting a stage
 * list from a stranger, and a room is a thing with an alarm on it. Presets are
 * also what the interface offers, so this refuses nothing anyone can ask for.
 */
function controlById(id: string): TimeControl | null {
  return PRESETS.find((control) => control.id === id) ?? null;
}

export function parseCreateMatch(body: unknown): Parsed<CreateMatch> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, reason: 'expected a JSON object' };
  }
  const input = body as Record<string, unknown>;

  const variant = input['variant'] ?? 'original';
  if (typeof variant !== 'string' || !VARIANT_IDS.includes(variant as VariantId)) {
    return { ok: false, reason: `unknown variant ${JSON.stringify(variant)}` };
  }

  const controlId = input['control'] ?? '3+2';
  if (typeof controlId !== 'string') return { ok: false, reason: 'control must be a preset id' };
  const control = controlById(controlId);
  if (!control) return { ok: false, reason: `unknown time control ${JSON.stringify(controlId)}` };

  const mode = input['mode'] ?? 'online-casual';
  if (typeof mode !== 'string' || !MODES.includes(mode as OnlineMode)) {
    return { ok: false, reason: `unknown mode ${JSON.stringify(mode)}` };
  }

  const side = input['side'] ?? 'random';
  if (side !== 'blue' && side !== 'red' && side !== 'random') {
    return { ok: false, reason: 'side must be blue, red or random' };
  }

  const rawName = input['name'];
  if (rawName !== undefined && rawName !== null && typeof rawName !== 'string') {
    return { ok: false, reason: 'name must be a string' };
  }
  const name = typeof rawName === 'string' ? rawName.trim().slice(0, 40) : null;

  return {
    ok: true,
    value: {
      variant: variant as VariantId,
      control,
      mode: mode as OnlineMode,
      side,
      name: name === '' ? null : name,
    },
  };
}

/** `/api/match/<id>/…` — the id, or null if this is not that shape. */
export function matchIdFrom(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  const id = rest.split('/')[0] ?? '';
  return isMatchId(id) ? id : null;
}

export const CORS_HEADERS = {
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
} as const;

export function json(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      ...CORS_HEADERS,
    },
  });
}

export function problem(reason: string, status: number, origin: string): Response {
  return json({ error: reason }, status, origin);
}
