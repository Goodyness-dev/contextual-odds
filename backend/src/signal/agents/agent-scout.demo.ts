import { logger } from '../../lib/logger';
import { getHistoricalNews } from '../historical-news';

export interface ScoutReport {
  matchId: string;
  sentimentSummary: string;
  impactScore: number;     // -1 to 1 (positive = favors Under 2.5, negative = favors Over 2.5)
  trustModifier: number;   // 0 to 1 (1 = fully trust the math, <1 = high uncertainty/chaos)
  teamAffinity?: 'HOME' | 'AWAY' | 'NEUTRAL';
}

export class ScoutAgent {
  public async analyzeMatchContext(
    matchId: string, 
    homeTeam: string, 
    awayTeam: string,
    matchMinute: number
  ): Promise<ScoutReport> {
    const liveCommentary = getHistoricalNews(matchMinute);
    
    let historicalNewsEvent = liveCommentary;
    if (matchMinute === 0) {
      const preMatchContext = "[PRE-MATCH]: Morocco highly motivated to secure top spot. Canada eliminated but playing aggressively for pride.";
      historicalNewsEvent = `${preMatchContext} | ${liveCommentary}`;
    }
    
    logger.info({ matchId, homeTeam, awayTeam, matchMinute }, 'Scout Agent analyzing pre-compiled context gap...');

    // Smart deterministic mock calculation to prevent dumb keyword triggers
    let impactScore = 0;
    let trustModifier = 1.0;
    let teamAffinity: 'HOME' | 'AWAY' | 'NEUTRAL' = 'NEUTRAL';
    
    const s = historicalNewsEvent.toLowerCase();

    // Determine Affinity based on hardcoded demo strings
    if (s.includes('morocco')) teamAffinity = 'HOME';
    else if (s.includes('canada')) teamAffinity = 'AWAY';

    // False positives for 'goal' or 'defensive'
    if (s.includes('goal kick') || s.includes('expected goals') || s.includes('defensive third')) {
      impactScore = 0;
    } else if (s.includes('goal!') || s.includes('goal confirmed') || s.includes('attacking momentum') || s.includes('goal is imminent') || s.includes('counter-attack')) {
      impactScore = -0.8; // massive swing for actual goals/threats
      trustModifier = 0.8;
    } else if (s.includes('defensive substitutions') || s.includes('low block') || s.includes('wasting time')) {
      impactScore = 0.6; // massive swing for actual defensive parking
      trustModifier = 0.9;
    } else if (s.includes('red card')) {
      impactScore = -0.9; // extreme chaos
      trustModifier = 0.5;
    }

    return {
      matchId,
      sentimentSummary: `[ORACLE]: ${liveCommentary}`,
      impactScore,
      trustModifier,
      teamAffinity
    };
  }
}

export const scoutAgent = new ScoutAgent();
