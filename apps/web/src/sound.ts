// Sound — spec 10.12: "A soft tick on a move, a thud on a capture and a
// chime on a win, with a mute toggle that's remembered."
//
// Synthesized with the Web Audio API rather than shipped audio files: three
// short tones cost nothing to draw wrong the way a licensed or borrowed clip
// would (CLAUDE.md's "original work only" applies to sound as much as art),
// and there is nothing here for a bundler to fetch.
//
// One `AudioContext` for the module's life, created lazily on the first call
// rather than at import time — browsers refuse to start one before a user
// gesture, and importing this module happens before any click does.

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  // A context created during an earlier gesture can still be 'suspended' if
  // autoplay policy caught it; resuming is harmless when it's already running.
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** One tone, optionally two in quick succession — everything below is built from this. */
function tone(freq: number, atMs: number, durationMs: number, gain: number, kind: OscillatorType = 'sine'): void {
  const audio = context();
  if (!audio) return;
  const osc = audio.createOscillator();
  const vol = audio.createGain();
  osc.type = kind;
  osc.frequency.value = freq;
  const start = audio.currentTime + atMs / 1000;
  const end = start + durationMs / 1000;
  // A linear attack and an exponential release, rather than snapping the gain
  // to 0/1: a click at the boundary is what an un-enveloped tone sounds like.
  vol.gain.setValueAtTime(0, start);
  vol.gain.linearRampToValueAtTime(gain, start + 0.008);
  vol.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(vol);
  vol.connect(audio.destination);
  osc.start(start);
  osc.stop(end + 0.02);
}

/** A move that didn't capture anything — spec's "soft tick". */
export function playTick(): void {
  tone(720, 0, 55, 0.05);
}

/** A capture — spec's "thud": lower, longer, a little louder. */
export function playCapture(): void {
  tone(160, 0, 90, 0.09, 'triangle');
}

/**
 * The end of a game — spec's "chime on a win". Played for any result, not
 * only a win: a silent finish reads as the app failing to notice the game
 * ended, whoever it ended for.
 */
export function playChime(): void {
  tone(880, 0, 140, 0.06);
  tone(1318.5, 90, 220, 0.06);
}

/** The illegal-target shake already has a visual; a short low tone backs it up for anyone not looking at the board. */
export function playIllegal(): void {
  tone(220, 0, 70, 0.04, 'square');
}
