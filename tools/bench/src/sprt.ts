// SPRT — the sequential probability ratio test — docs/engine/06-MEASUREMENT-
// AND-LEVELS.md part one: "so a match stops as soon as the answer is clear,
// instead of always running a fixed number of games. Bounds of [0, 5] Elo are
// the usual 'is this an improvement at all?' test."
//
// This is the trinomial win/draw/loss model chess-engine testing tools
// (cutechess-cli, Stockfish's fishtest) use — sometimes called GSPRT. It is
// BayesElo's two-parameter model: `elo` is the strength difference under
// test, and `drawelo` is a nuisance parameter that only controls how often
// games draw, re-estimated from the match's own observed results rather than
// assumed, via the closed-form method-of-moments fit below.
//
// Reference for the shape of this: Michael Byrne / Ronald de Man's SPRT
// writeups for cutechess-cli, and fishtest's own description of GSPRT.

import type { WDL } from './elo.js';

export interface SprtParams {
  /** The "no worse than this" bound, in Elo. Usually 0. */
  elo0: number;
  /** The "actually better than this" bound, in Elo. */
  elo1: number;
  /** False-positive rate: probability of accepting elo1 when the truth is elo0. */
  alpha: number;
  /** False-negative rate: probability of accepting elo0 when the truth is elo1. */
  beta: number;
}

export type SprtStatus = 'accept' | 'reject' | 'continue';

export interface SprtResult {
  /** Log-likelihood ratio of "true strength is elo1" over "true strength is elo0". */
  llr: number;
  lowerBound: number;
  upperBound: number;
  status: SprtStatus;
}

interface Probs {
  win: number;
  draw: number;
  loss: number;
}

const EPS = 1e-9;

function clampProb(p: number): number {
  return Math.min(1 - EPS, Math.max(EPS, p));
}

/** BayesElo's two-parameter model: win/draw/loss probability at a given elo
 *  and drawelo. */
function probsAt(elo: number, drawelo: number): Probs {
  const win = 1 / (1 + Math.pow(10, (drawelo - elo) / 400));
  const loss = 1 / (1 + Math.pow(10, (drawelo + elo) / 400));
  return { win: clampProb(win), draw: clampProb(1 - win - loss), loss: clampProb(loss) };
}

/**
 * Method-of-moments estimate of (elo, drawelo) from the observed win and loss
 * rates — exact for this two-parameter model, and how fishtest and
 * cutechess-cli re-estimate `drawelo` as a match runs rather than assuming
 * one up front. A Laplace-style continuity correction keeps a 0-count tail
 * from sending `log(1/p - 1)` to +-Infinity before there is any real
 * evidence.
 */
function estimateElo(wdl: WDL): { elo: number; drawelo: number } {
  const n = wdl.wins + wdl.draws + wdl.losses;
  const pWin = (wdl.wins + 0.5) / (n + 1);
  const pLoss = (wdl.losses + 0.5) / (n + 1);

  const a = Math.log10(1 / pWin - 1);
  const b = Math.log10(1 / pLoss - 1);
  return { elo: 200 * (b - a), drawelo: 200 * (a + b) };
}

const MIN_GAMES = 8;

/**
 * The test's current state: the log-likelihood ratio of "true strength is
 * elo1" over "true strength is elo0" given the games played so far, and
 * whether that is now conclusive.
 *
 * Reports `continue` for the first `MIN_GAMES` regardless of the running
 * score — with too few games (or zero of either a win or a loss) the
 * drawelo estimate isn't meaningful yet, and an early lucky streak
 * shouldn't be able to end the match.
 */
export function sprt(wdl: WDL, params: SprtParams): SprtResult {
  const { wins, draws, losses } = wdl;
  const n = wins + draws + losses;
  const lowerBound = Math.log(params.beta / (1 - params.alpha));
  const upperBound = Math.log((1 - params.beta) / params.alpha);

  if (n < MIN_GAMES || wins === 0 || losses === 0) {
    return { llr: 0, lowerBound, upperBound, status: 'continue' };
  }

  const { drawelo } = estimateElo(wdl);
  const p0 = probsAt(params.elo0, drawelo);
  const p1 = probsAt(params.elo1, drawelo);

  const llr =
    wins * Math.log(p1.win / p0.win) +
    draws * Math.log(p1.draw / p0.draw) +
    losses * Math.log(p1.loss / p0.loss);

  let status: SprtStatus = 'continue';
  if (llr >= upperBound) status = 'accept';
  else if (llr <= lowerBound) status = 'reject';

  return { llr, lowerBound, upperBound, status };
}
