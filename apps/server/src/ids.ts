// Match ids and seat tokens.
//
// This is the one place in online play that needs real randomness, which is
// why it is here and not in `@sps/referee`: the referee takes its tokens as
// arguments, the same way the AI takes a seed (spec 7.8), so a room can be
// tested with tokens a person can read.
//
// A seat token is the only thing standing between a stranger and somebody's
// game (see `seats.ts`), so it is 132 bits from the platform's CSPRNG. Guessing
// one is not a threat model; forwarding the link is.

/** URL-safe, so a token can sit in a link with nothing escaped. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Six bits per byte rather than a modulo, so every character is equally
 * likely. The two thrown-away bits cost nothing and a biased id is the kind of
 * mistake that is never noticed.
 */
function randomId(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte & 63];
  return out;
}

export function newMatchId(): string {
  return randomId(12);
}

export function newToken(): string {
  return randomId(22);
}

/** Which seat the creator keeps. 'random' is resolved here, where the entropy is. */
export function pickSide(choice: 'blue' | 'red' | 'random'): 'blue' | 'red' {
  if (choice !== 'random') return choice;
  return (crypto.getRandomValues(new Uint8Array(1))[0]! & 1) === 0 ? 'blue' : 'red';
}
