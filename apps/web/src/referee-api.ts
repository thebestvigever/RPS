// Talking to the referee over plain HTTP: creating a match, and reading one.
//
// The socket is `useMatch.ts`; this is the two things that happen before there
// is one. The shapes come from @sps/referee, so there is one definition of
// what a created match is rather than two that agree until somebody edits one.

import type { CreatedMatch, MatchSummary } from '@sps/referee';
import type { VariantId } from '@sps/engine';

/**
 * Where the referee lives. The app is a static page and the room is a Worker,
 * so they are two different origins in every deployment except a local one —
 * hence a variable rather than a relative path.
 */
export const REFEREE_ORIGIN: string =
  (import.meta.env['VITE_REFEREE_ORIGIN'] as string | undefined) ?? 'http://localhost:8788';

export class RefereeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefereeError';
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body.error === 'string') return body.error;
  } catch {
    // Fall through to the status line.
  }
  return `the referee answered ${response.status}`;
}

export interface CreateOptions {
  variant: VariantId;
  control: string;
  side: 'blue' | 'red' | 'random';
  name?: string;
}

export async function createMatch(options: CreateOptions): Promise<CreatedMatch> {
  let response: Response;
  try {
    response = await fetch(`${REFEREE_ORIGIN}/api/match`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...options, mode: 'online-casual' }),
    });
  } catch {
    // A failed fetch here is almost always "the referee is not running",
    // which is worth saying plainly rather than as a network stack trace.
    throw new RefereeError('could not reach the game server');
  }
  if (!response.ok) throw new RefereeError(await readError(response));
  return (await response.json()) as CreatedMatch;
}

export async function readMatch(matchId: string): Promise<MatchSummary> {
  let response: Response;
  try {
    response = await fetch(`${REFEREE_ORIGIN}/api/match/${matchId}`);
  } catch {
    throw new RefereeError('could not reach the game server');
  }
  if (!response.ok) throw new RefereeError(await readError(response));
  return (await response.json()) as MatchSummary;
}

export function socketUrl(matchId: string): string {
  return `${REFEREE_ORIGIN.replace(/^http/, 'ws')}/ws/${matchId}`;
}
