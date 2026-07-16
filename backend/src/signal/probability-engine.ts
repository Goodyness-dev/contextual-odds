import { TeamStats } from './team-stats';
import { AgentWeights } from './agents/weights-manager';

export interface ProbabilityResult {
  marketProbabilities: {
    [key: string]: {
      modelProbability: number;
      expectedGoals: number;
      confidence: number;
    }
  };
}

/**
 * Calculates factorial
 */
function factorial(n: number): number {
  if (n === 0 || n === 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

/**
 * Poisson distribution: P(X = k) = (λ^k * e^-λ) / k!
 */
function poissonProbability(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/**
 * Calculate Poisson probability for Under N.5 goals
 */
function calculateBaseUnder(expectedGoals: number, maxGoals: number): number {
  let prob = 0;
  for (let i = 0; i <= maxGoals; i++) {
    prob += poissonProbability(expectedGoals, i);
  }
  return prob;
}

export function computeDynamicProbabilities(
  homeStats: TeamStats,
  awayStats: TeamStats,
  matchMinute: number,
  currentScore: { home: number; away: number },
  redCards: { home: number; away: number },
  weights: AgentWeights
): ProbabilityResult {
  
  // 1. Calculate pre-match expected total goals
  // Average of (Home Scored + Away Conceded) and (Away Scored + Home Conceded)
  const homeAttackAwayDefense = (homeStats.expectedGoalsScoredPerGame + awayStats.expectedGoalsConcededPerGame) / 2;
  const awayAttackHomeDefense = (awayStats.expectedGoalsScoredPerGame + homeStats.expectedGoalsConcededPerGame) / 2;
  const preMatchExpectedTotal = homeAttackAwayDefense + awayAttackHomeDefense;

  // 2. Adjust for in-play time decay
  // Goals don't scale perfectly linearly, but for a hackathon we use a standard linear decay + slight late-game weight
  const totalMinutes = 90;
  const remainingMinutes = Math.max(0, totalMinutes - matchMinute);
  const proportionRemaining = remainingMinutes / totalMinutes;
  
  const currentTotalGoals = currentScore.home + currentScore.away;

  // Expected remaining goals
  const expectedRemainingGoals = preMatchExpectedTotal * proportionRemaining;
  const homeExpectedRemainingGoals = homeAttackAwayDefense * proportionRemaining;
  const awayExpectedRemainingGoals = awayAttackHomeDefense * proportionRemaining;
  
  // Stage 2: Context Adjustments
  let contextAdjustment = 0;

  // Red card adjustment using dynamic weights
  const totalReds = redCards.home + redCards.away;
  if (totalReds > 0) {
    contextAdjustment -= (weights.redCardPenalty * totalReds); 
  }

  // Historical trend adjustment using dynamic weights
  const avgUnderRate = (homeStats.under25Rate + awayStats.under25Rate) / 2;
  const baselineUnderRate = 0.50; // Standard 50% baseline
  const trendDiff = avgUnderRate - baselineUnderRate;
  contextAdjustment += (trendDiff * weights.historicalTrendWeight);

  const targets = [0.5, 1.5, 2.5, 3.5];
  const marketProbabilities: ProbabilityResult['marketProbabilities'] = {};

  for (const target of targets) {
    const maxGoalsForUnder = Math.floor(target); // e.g. 2.5 -> 2
    
    // If we've already exceeded the target, under is 0%
    if (currentTotalGoals > maxGoalsForUnder) {
      marketProbabilities[`under_${target}`] = {
        modelProbability: 0,
        expectedGoals: expectedRemainingGoals,
        confidence: 1
      };
      marketProbabilities[`over_${target}`] = {
        modelProbability: 1,
        expectedGoals: expectedRemainingGoals,
        confidence: 1
      };
      continue;
    }

    const goalsToStayUnder = maxGoalsForUnder - currentTotalGoals;
    const poissonBase = calculateBaseUnder(expectedRemainingGoals, goalsToStayUnder);
    
    // Stage 3: Synthesis
    let rawUnderFinal = poissonBase + contextAdjustment;
    rawUnderFinal = Math.max(0.01, Math.min(0.99, rawUnderFinal));
    
    marketProbabilities[`under_${target}`] = {
      modelProbability: rawUnderFinal,
      expectedGoals: expectedRemainingGoals,
      confidence: 1 // Baseline math confidence
    };
    
    marketProbabilities[`over_${target}`] = {
      modelProbability: 1 - rawUnderFinal,
      expectedGoals: expectedRemainingGoals,
      confidence: 1
    };

    // Calculate Home Team specific probabilities
    const homeGoalsToStayUnder = maxGoalsForUnder - currentScore.home;
    if (currentScore.home > maxGoalsForUnder) {
      marketProbabilities[`home_under_${target}`] = { modelProbability: 0, expectedGoals: homeExpectedRemainingGoals, confidence: 1 };
      marketProbabilities[`home_over_${target}`] = { modelProbability: 1, expectedGoals: homeExpectedRemainingGoals, confidence: 1 };
    } else {
      let homeRawUnder = calculateBaseUnder(homeExpectedRemainingGoals, homeGoalsToStayUnder) + contextAdjustment;
      homeRawUnder = Math.max(0.01, Math.min(0.99, homeRawUnder));
      marketProbabilities[`home_under_${target}`] = { modelProbability: homeRawUnder, expectedGoals: homeExpectedRemainingGoals, confidence: 1 };
      marketProbabilities[`home_over_${target}`] = { modelProbability: 1 - homeRawUnder, expectedGoals: homeExpectedRemainingGoals, confidence: 1 };
    }

    // Calculate Away Team specific probabilities
    const awayGoalsToStayUnder = maxGoalsForUnder - currentScore.away;
    if (currentScore.away > maxGoalsForUnder) {
      marketProbabilities[`away_under_${target}`] = { modelProbability: 0, expectedGoals: awayExpectedRemainingGoals, confidence: 1 };
      marketProbabilities[`away_over_${target}`] = { modelProbability: 1, expectedGoals: awayExpectedRemainingGoals, confidence: 1 };
    } else {
      let awayRawUnder = calculateBaseUnder(awayExpectedRemainingGoals, awayGoalsToStayUnder) + contextAdjustment;
      awayRawUnder = Math.max(0.01, Math.min(0.99, awayRawUnder));
      marketProbabilities[`away_under_${target}`] = { modelProbability: awayRawUnder, expectedGoals: awayExpectedRemainingGoals, confidence: 1 };
      marketProbabilities[`away_over_${target}`] = { modelProbability: 1 - awayRawUnder, expectedGoals: awayExpectedRemainingGoals, confidence: 1 };
    }
  }

  return { marketProbabilities };
}
