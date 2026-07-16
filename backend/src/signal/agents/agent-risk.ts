import { ProbabilityResult } from '../probability-engine';
import { ScoutReport } from './agent-scout';
import { calculateDivergence, DivergenceResult } from '../divergence';
import { logger } from '../../lib/logger';
import { SIGNAL_CONFIG } from '../signal-config';
import { txLineClient } from '../txline-client';

export class RiskManagerAgent {
  private lastKnownOddsCache: Record<string, Record<string, number>> = {};
  
  public evaluateSignal(
    matchId: string,
    homeTeam: string,
    awayTeam: string,
    matchMinute: number,
    quantResult: ProbabilityResult,
    scoutReport: ScoutReport,
    oddsData: any,
    alreadyTradedHistory: any[] = [],
    oddsDifferenceThreshold: number = 2.0
  ): DivergenceResult | null {
    
    logger.info({ matchId }, 'Oracle Manager evaluating Context Gap...');

    if (!this.lastKnownOddsCache[matchId]) {
      this.lastKnownOddsCache[matchId] = {};
    }

    const markets = [
      'under_0.5', 'over_0.5',
      'under_1.5', 'over_1.5',
      'under_2.5', 'over_2.5',
      'under_3.5', 'over_3.5',
      'home_under_0.5', 'home_over_0.5',
      'home_under_1.5', 'home_over_1.5',
      'home_under_2.5', 'home_over_2.5',
      'home_under_3.5', 'home_over_3.5',
      'away_under_0.5', 'away_over_0.5',
      'away_under_1.5', 'away_over_1.5',
      'away_under_2.5', 'away_over_2.5',
      'away_under_3.5', 'away_over_3.5'
    ];

    let bestTrade: DivergenceResult | null = null;
    let highestBalancedScore = -Infinity;

    // GLOBAL COOLDOWN: Ensure the agent doesn't spam bets. Max 1 bet every 10 minutes.
    if (alreadyTradedHistory && alreadyTradedHistory.length > 0) {
      // Sort to find the most recent trade by matchMinute
      const sortedHistory = [...alreadyTradedHistory].sort((a, b) => b.matchMinute - a.matchMinute);
      const lastTrade = sortedHistory[0];
      if (matchMinute - lastTrade.matchMinute < 10) {
         logger.info({ matchMinute, lastTradeMin: lastTrade.matchMinute }, 'Risk Manager enforcing 10-minute global cooldown. Skipping evaluation.');
         return null;
      }
    }

    const alreadyTradedMarkets = alreadyTradedHistory.map(t => t.market);

    for (const market of markets) {
      if (alreadyTradedMarkets.includes(market)) continue;

      // Enforce Team Affinity to prevent stupid bets
      if (scoutReport.teamAffinity === 'HOME') {
         if (market.includes('away_over') || market.includes('home_under') || market === 'under_3.5' || market === 'under_2.5') {
            logger.debug({ market }, 'Risk Manager VETO: Market contradicts HOME attacking momentum');
            continue;
         }
      }
      if (scoutReport.teamAffinity === 'AWAY') {
         if (market.includes('home_over') || market.includes('away_under') || market === 'under_3.5' || market === 'under_2.5') {
            logger.debug({ market }, 'Risk Manager VETO: Market contradicts AWAY attacking momentum');
            continue;
         }
      }

      // Prevent betting on extreme lines early in the game when variance is too high
      if (matchMinute < 15 && market.includes('3.5')) {
         logger.debug({ market }, 'Risk Manager VETO: Variance too high for 3.5 lines early in game');
         continue;
      }

      let marketOdds = txLineClient.extractMarketOdds(oddsData, market.replace(/_/g, ' '));
      let isSuspended = false;
      
      if (marketOdds) {
         // Update cache with the latest live odds
         this.lastKnownOddsCache[matchId][market] = marketOdds;
      } else {
         isSuspended = true;
         // Use the last known odds just before the suspension!
         marketOdds = this.lastKnownOddsCache[matchId][market] ?? null;
         if (!marketOdds) {
            // Absolute fallback if we never even saw an odds tick for this market
            marketOdds = 2.0; 
         }
      }

      const modelProbObj = quantResult.marketProbabilities[market];
      if (!modelProbObj || modelProbObj.modelProbability <= 0) continue;

      const rawModelProb = modelProbObj.modelProbability;
      if (rawModelProb === 1) continue;
      
      let finalConfidence = modelProbObj.confidence * scoutReport.trustModifier;

      const isUnder = market.includes('under');
      let impact = scoutReport.impactScore; // -1.0 to 1.0
      
      // If momentum is against the team, invert the impact
      if (scoutReport.teamAffinity === 'AWAY' && market.startsWith('home_')) impact = -Math.abs(impact);
      if (scoutReport.teamAffinity === 'HOME' && market.startsWith('away_')) impact = -Math.abs(impact);
      
      // Calculate a proportional multiplier instead of a flat percentage shift
      let newsMultiplier = 1.0;
      if (isUnder) {
        newsMultiplier = 1 - (impact * 0.40); // Up to 40% shift based on NLP
      } else {
        newsMultiplier = 1 + (impact * 0.40);
      }

      const marketImpliedProb = 1 / marketOdds;

      // CONTEXTUAL BLENDING: 50% Bookmaker Math + 50% Poisson Quant Math, shifted by NLP Context
      const baseProb = (marketImpliedProb * 0.5) + (rawModelProb * 0.5);
      const adjustedModelProbability = Math.max(0.01, Math.min(0.99, baseProb * newsMultiplier));
      
      const trueOdds = 1 / adjustedModelProbability;
      
      // Expected Value (Edge) = (Market Odds / True Odds) - 1
      const expectedValue = (marketOdds / trueOdds) - 1;

      if (matchMinute >= 15 && matchMinute <= 17 && market === 'over_1.5') {
        logger.info({ matchMinute, market, marketOdds, marketImpliedProb, rawModelProb, newsMultiplier, adjustedModelProbability, trueOdds, expectedValue, finalConfidence }, 'DEBUG RISK MANAGER');
      }

      // Always fire if the Edge is positive! (Positive EV)
      if (expectedValue <= 0) continue;

      // Lower confidence threshold to allow aggressive context-based bets
      if (finalConfidence < 0.20) continue;

      // Rank primarily on the actual Expected Value (Edge) + Confidence
      const balancedScore = (expectedValue * 0.7) + (finalConfidence * 0.3);

      if (balancedScore > highestBalancedScore) {
        highestBalancedScore = balancedScore;
        
        // Generate the raw signal data using our divergence utility
        bestTrade = calculateDivergence(
          matchId,
          homeTeam,
          awayTeam,
          matchMinute,
          adjustedModelProbability,
          marketOdds,
          market
        );
        
        let scoutNewsDirection = newsMultiplier > 1 ? '+' : '';
        const impactPercent = (newsMultiplier - 1) * 100;
        // Finalize explanation
        if (isSuspended) {
          bestTrade.explanation = `[QUANT_AGENT]: Market suspended. Forcing prediction purely on Context Gap.\n` +
                                  `[SCOUT_AGENT]: "${scoutReport.sentimentSummary}"\n` +
                                  `[RISK_MANAGER]: Immediate Action! Take ${market.replace('_', ' ')} based on momentum shift.`;
        } else {
          bestTrade.explanation = `[QUANT_AGENT]: Poisson model target ${market.replace('_', ' ')}.\n` +
                                  `[SCOUT_AGENT]: "${scoutReport.sentimentSummary}" (NLP impact: ${scoutNewsDirection}${impactPercent.toFixed(1)}%)\n` +
                                  `[RISK_MANAGER]: Selected as highest EV trade. Edge: ${(expectedValue * 100).toFixed(1)}%, Score: ${balancedScore.toFixed(3)}.`;
        }
      }
    }

    if (!bestTrade) {
      logger.info({ matchId }, 'Risk Manager VETO: No balanced trades found.');
    }

    return bestTrade;
  }
}

export const riskManagerAgent = new RiskManagerAgent();
