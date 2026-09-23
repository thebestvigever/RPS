// Elo difference with an error bar — docs/engine/06-MEASUREMENT-AND-LEVELS.md
// part one: "report Elo difference with an error bar, not just a win count.
// 55 wins in 100 games sounds decisive and is not: the 95% interval spans
// roughly +-70 Elo. This is the single most common way engine work goes
// wrong."
//
// This is the standard method engine-testing tools report (cutechess-cli and
// similar): treat each game's outcome as 1 / 0.5 / 0 for the side under test,
// take the mean score, and convert through the logistic Elo model. The
// interval comes from the normal approximation to that mean's sampling
// distribution, which is the same approximation `sprt.ts` uses to re-estimate
// its draw parameter — accurate once there are a few dozen games, which is
// the regime this whole file is for. It is not meant to replace `sprt.ts` for
// "should this match stop now", only to report what a finished (or
// early-stopped) match found.

export interface WDL {
  wins: number;
  draws: number;
  losses: number;
}

/** The logistic Elo model: how many Elo a score of `p` (0..1) implies. */
export function scoreToElo(score: number): number {
  if (score <= 0) return -Infinity;
  if (score >= 1) return Infinity;
  return -400 * Math.log10(1 / score - 1);
}

export interface EloEstimate {
  games: number;
  score: number;
  elo: number;
  /** 95% confidence interval on `elo`, from the normal approximation. */
  lo: number;
  hi: number;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Elo difference for the side under test, with a 95% error bar, from a
 * win/draw/loss count.
 *
 * A handful of games, or every game the same result, makes the normal
 * approximation meaningless — the interval opens out to +-Infinity rather
 * than reporting a precision the sample doesn't support.
 */
export function eloEstimate(wdl: WDL): EloEstimate {
  const games = wdl.wins + wdl.draws + wdl.losses;
  if (games === 0) return { games: 0, score: 0.5, elo: 0, lo: -Infinity, hi: Infinity };

  const score = (wdl.wins + wdl.draws / 2) / games;
  const pWin = wdl.wins / games;
  const pDraw = wdl.draws / games;
  const pLoss = wdl.losses / games;

  // Variance of one game's score around the mean, then of the mean of `games`
  // of them.
  const variance = pWin * (1 - score) ** 2 + pDraw * (0.5 - score) ** 2 + pLoss * (0 - score) ** 2;
  const stdev = Math.sqrt(variance / games);

  const z = 1.959964; // 95% two-sided
  const lo = scoreToElo(clamp01(score - z * stdev));
  const hi = scoreToElo(clamp01(score + z * stdev));

  return { games, score, elo: scoreToElo(score), lo, hi };
}
