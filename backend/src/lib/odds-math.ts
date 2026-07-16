// Pure functions for betting mathematics.
// Zero API calls, fully testable.

/**
 * Calculates the implied probability from decimal odds.
 * @param decimalOdds The bookmaker's decimal odds (e.g., 2.50)
 * @returns The implied probability (e.g., 0.40)
 */
export function impliedProbability(decimalOdds: number): number {
  if (decimalOdds <= 1) return 0;
  return 1 / decimalOdds;
}

/**
 * Removes the bookmaker's margin (Vig) so probabilities across a market sum to 1.
 * Useful if scraping all outcomes of a market.
 * @param oddsArray Array of decimal odds for all possible outcomes
 * @returns Array of fair probabilities
 */
export function removeVig(oddsArray: number[]): number[] {
  const rawProbs = oddsArray.map(impliedProbability);
  const overround = rawProbs.reduce((a, b) => a + b, 0);
  return rawProbs.map(p => p / overround);
}

/**
 * Calculates Expected Value (EV) per unit staked.
 * EV > 0 means a profitable bet long-term.
 * @param decimalOdds The bookmaker's decimal odds
 * @param trueProbability Our estimated true probability (0.0 to 1.0)
 * @returns The expected profit/loss per 1 unit wagered
 */
export function expectedValue(decimalOdds: number, trueProbability: number): number {
  const payout = decimalOdds - 1; // profit per unit if it wins
  return (trueProbability * payout) - (1 - trueProbability);
}

/**
 * Calculates the Kelly Fraction (how much of bankroll to stake).
 * @param decimalOdds The bookmaker's decimal odds
 * @param trueProbability Our estimated true probability (0.0 to 1.0)
 * @returns The fraction of bankroll to bet (0.0 to 1.0). Never returns negative.
 */
export function kellyFraction(decimalOdds: number, trueProbability: number): number {
  const b = decimalOdds - 1;
  if (b <= 0) return 0;
  const f = (b * trueProbability - (1 - trueProbability)) / b;
  return Math.max(0, f);
}

/**
 * Calculates the combined probability for a parlay (naive).
 * Note: Same-game legs need correlation adjustments in practice.
 */
export function parlayProbability(legProbabilities: number[]): number {
  return legProbabilities.reduce((a, b) => a * b, 1);
}
