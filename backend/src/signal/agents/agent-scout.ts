import { config } from '../../config';
import { logger } from '../../lib/logger';
import { getHistoricalNews } from '../historical-news';

export interface ScoutReport {
  matchId: string;
  sentimentSummary: string;
  impactScore: number;     // -1 to 1 (positive = favors Under 2.5, negative = favors Over 2.5)
  trustModifier: number;   // 0 to 1 (1 = fully trust the math, <1 = high uncertainty/chaos)
  teamAffinity?: 'HOME' | 'AWAY' | 'NEUTRAL'; // Identifies which team is driving the momentum
}

import fs from 'fs';
import path from 'path';

// Load precomputed cache if available to make demo lightning fast
let precomputedCache: Record<number, any> | null = null;
try {
  const cachePath = path.join(__dirname, 'scout_precomputed.json');
  if (fs.existsSync(cachePath)) {
    precomputedCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    logger.info(`Loaded ${Object.keys(precomputedCache || {}).length} precomputed scout reports for instant simulation.`);
  }
} catch (e) {
  logger.warn('No precomputed scout cache found, will use live LLM.');
}

// In-memory cache to avoid spamming the LLM every 60s for the same match
const reportCache = new Map<string, { report: ScoutReport, timestamp: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

export class ScoutAgent {
  public async analyzeMatchContext(
    matchId: string, 
    homeTeam: string, 
    awayTeam: string,
    matchMinute: number
  ): Promise<ScoutReport> {
    
    // INSTANT RETURN: If we precomputed this minute for the demo match, return it instantly!
    if (precomputedCache && precomputedCache[matchMinute] && matchId === '18185036') {
      return precomputedCache[matchMinute];
    }
    
    const historicalNewsEvent = getHistoricalNews(matchMinute);
    const cacheKey = `${matchId}-${historicalNewsEvent}`;
    
    // Check dynamic cache
    const cached = reportCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.report;
    }

    const fallbackReport: ScoutReport = {
      matchId,
      sentimentSummary: 'No significant news detected. Weather is clear.',
      impactScore: 0,
      trustModifier: 1.0
    };

    if (!config.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is not configured in the .env file. Swarm cannot execute AI logic.');
    }

    try {
      logger.info({ matchId, homeTeam, awayTeam, matchMinute }, 'Scout Agent fetching live context from Groq...');
      
      const url = `https://api.groq.com/openai/v1/chat/completions`;
      
      // Inject the exact historical event into Groq to get a live sentiment score!
      const prompt = `
        You are a quantitative sports betting scout analyzing a live football match between ${homeTeam} and ${awayTeam}.
        The current match minute is ${matchMinute}'.
        
        A critical live event just occurred on the field: 
        "${historicalNewsEvent}"
        
        Based ONLY on this specific event:
        1. Evaluate how this impacts the probability of goals being scored (Over/Under).
        2. Generate an 'impactScore' between -1.0 and 1.0. 
           Positive numbers mean the event strongly favors fewer goals (e.g., a defensive sub, slowing down the game).
           Negative numbers mean the event strongly favors more goals (e.g., an early goal, pure attacking chaos).
           0 means neutral impact.
        3. Generate a 'trustModifier' between 0.0 and 1.0. 
           1.0 means the math model is safe to trust. Lower numbers mean the game is too chaotic to trust the math (e.g., 0.2 if the event is a massive riot).
        4. Generate a 'sentimentSummary' of exactly 1 sentence explaining your reasoning.
        5. Generate a 'teamAffinity' which MUST be either "HOME", "AWAY", or "NEUTRAL". Identify which team is driving the momentum. If the event is about ${homeTeam} attacking, return "HOME". If ${awayTeam} is attacking, return "AWAY". Otherwise "NEUTRAL".
        
        Respond ONLY with a raw JSON object containing these keys: impactScore, trustModifier, sentimentSummary, teamAffinity
      `;

      const payload = {
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
      };

      let apiRes = await fetch(url, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.GROQ_API_KEY}`
        },
        body: JSON.stringify(payload)
      });
      
      if (apiRes.status === 429 || apiRes.status >= 500) {
        if (config.SAMBANOVA_API_KEY) {
          logger.warn('Groq API rate limit hit. Falling back to SambaNova.');
          apiRes = await fetch('https://api.sambanova.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.SAMBANOVA_API_KEY}`
            },
            body: JSON.stringify({
              model: "Meta-Llama-3.1-8B-Instruct",
              messages: [{ role: "user", content: prompt }],
              response_format: { type: "json_object" }
            })
          });
        }
      }

      if (apiRes.status === 429 || apiRes.status >= 500) {
        if (config.CEREBRAS_API_KEY) {
          logger.warn('API limit hit. Falling back to Cerebras.');
          apiRes = await fetch('https://api.cerebras.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.CEREBRAS_API_KEY}`
            },
            body: JSON.stringify({
              model: "llama3.1-8b",
              messages: [{ role: "user", content: prompt }],
              response_format: { type: "json_object" }
            })
          });
        }
      }

      if (apiRes.status === 429 || apiRes.status >= 500) {
        if (config.OPENROUTER_API_KEY) {
          logger.warn('API limit hit. Falling back to OpenRouter.');
          apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.OPENROUTER_API_KEY}`
            },
            body: JSON.stringify({
              model: "meta-llama/llama-3.1-8b-instruct:free",
              messages: [{ role: "user", content: prompt }],
              response_format: { type: "json_object" }
            })
          });
        }
      }

      if (apiRes.status === 429 || apiRes.status >= 500) {
        logger.warn('All API fallbacks exhausted. Falling back to default report.');
        return fallbackReport;
      }

      const data = await apiRes.json();

      if (data.error) {
        logger.warn({ err: data.error }, 'API error. Falling back.');
        return fallbackReport;
      }

      const text = data.choices?.[0]?.message?.content || "{}";
      
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        logger.warn({ text }, 'Failed to parse Groq JSON output. Falling back.');
        return fallbackReport;
      }

      const report: ScoutReport = {
        matchId,
        sentimentSummary: parsed.sentimentSummary || fallbackReport.sentimentSummary,
        impactScore: typeof parsed.impactScore === 'number' ? parsed.impactScore : 0,
        trustModifier: typeof parsed.trustModifier === 'number' ? parsed.trustModifier : 1.0,
        teamAffinity: parsed.teamAffinity || 'NEUTRAL'
      };

      // Ensure bounds
      report.impactScore = Math.max(-1, Math.min(1, report.impactScore));
      report.trustModifier = Math.max(0, Math.min(1, report.trustModifier));

      // Cache it based on the exact news event to bypass rate limits!
      reportCache.set(cacheKey, { report, timestamp: Date.now() });
      return report;

    } catch (err: any) {
      logger.error({ err: err.message }, 'Scout Agent failed to generate report. Terminating tick.');
      throw err; 
    }
  }
}

export const scoutAgent = new ScoutAgent();
