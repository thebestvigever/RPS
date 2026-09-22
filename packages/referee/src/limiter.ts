// Rate limiting, per connection — spec 13.7 ("rate-limit match creation, joins
// and moves").
//
// A token bucket, and pure like everything else here: it is handed `now` and
// holds no timer. The numbers are set so that nothing a person can do by
// playing hits them — a move is one message a turn, a ping a few a minute —
// while a loop hammering the socket runs dry in a couple of seconds.

export interface Bucket {
  tokens: number;
  updatedAt: number;
  /** Set once a burst is refused, so the refusal is answered once and not per dropped frame. */
  warned: boolean;
}

export const BUCKET_CAPACITY = 30;
export const REFILL_PER_SECOND = 3;

export function createBucket(now: number): Bucket {
  return { tokens: BUCKET_CAPACITY, updatedAt: now, warned: false };
}

export type Charge =
  /** Allowed. */
  | { ok: true; bucket: Bucket }
  /** Refused. `warn` is true exactly once per burst, so a flood costs one reply. */
  | { ok: false; bucket: Bucket; warn: boolean };

export function charge(bucket: Bucket, now: number): Charge {
  const elapsed = Math.max(0, now - bucket.updatedAt);
  const tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + (elapsed * REFILL_PER_SECOND) / 1000);

  if (tokens < 1) {
    return {
      ok: false,
      bucket: { tokens, updatedAt: now, warned: true },
      warn: !bucket.warned,
    };
  }

  return { ok: true, bucket: { tokens: tokens - 1, updatedAt: now, warned: false } };
}
