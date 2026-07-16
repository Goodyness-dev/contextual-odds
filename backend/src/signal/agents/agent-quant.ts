import { computeDynamicProbabilities, ProbabilityResult } from '../probability-engine';
import { loadWeights } from './weights-manager';
import { scrapeTeamStats } from '../team-stats';
import { logger } from '../../lib/logger';

export class QuantAgent {
  public async analyzeMathModel(
    homeTeam: string,
    awayTeam: string,
    matchMinute: number,
    currentScore: { home: number; away: number },
    redCards: { home: number; away: number }
  ): Promise<ProbabilityResult> {
    logger.info({ homeTeam, awayTeam }, 'Quant Agent processing pure mathematical model...');
    
    // Load dynamic weights
    const weights = loadWeights();
    
    // Get team stats (xG, etc.)
    const homeStats = await scrapeTeamStats(homeTeam);
    const awayStats = await scrapeTeamStats(awayTeam);

    // Run the Poisson engine with weights
    return computeDynamicProbabilities(
      homeStats,
      awayStats,
      matchMinute,
      currentScore,
      redCards,
      weights
    );
  }
}

export const quantAgent = new QuantAgent();
