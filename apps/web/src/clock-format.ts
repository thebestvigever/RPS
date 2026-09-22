// mm:ss for the clock chip. Pure formatting, no state — kept separate so it's
// trivial to see it does exactly one thing.

export function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) return '∞';
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
