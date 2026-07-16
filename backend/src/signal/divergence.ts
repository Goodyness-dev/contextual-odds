import { ProbabilityResult } from './probability-engine';
import { SIGNAL_CONFIG } from './signal-config';

export interface DivergenceResult {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  market: string;
  modelProbability: number;
  marketProbability: number;
  divergence: number;
  oddsDifference: number;
  explanation: string;
  direction: 'MODEL_HIGHER' | 'MODEL_LOWER';
  signal: 'BUY' | 'SELL' | 'HOLD';
  decimalOdds: number;
  ev: number;
  kellyFraction: number;
  timestamp: string;
  matchMinute: number;
}

export function oddsToImpliedProbability(decimalOdds: number): number {
  return 1 / decimalOdds;
}

export function calculateDivergence(
  matchId: string,
  homeTeam: string,
  awayTeam: string,
  matchMinute: number,
  modelProbability: number,
  marketOdds: number,
  marketName: string = 'under_2.5'
): DivergenceResult {
  
  const marketProbability = oddsToImpliedProbability(marketOdds);
  const divergence = modelProbability - marketProbability;
  
  const direction = divergence > 0 ? 'MODEL_HIGHER' : 'MODEL_LOWER';
  
  let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  
  // BUY when model thinks it's more likely than market thinks
  if (divergence >= SIGNAL_CONFIG.threshold) {
    signal = 'BUY';
  } 
  // SELL when model thinks it's less likely than market thinks
  else if (divergence <= -SIGNAL_CONFIG.threshold) {
    signal = 'SELL';
  }

  // Expected Value (EV): 
  // EV = (Probability of Win * Potential Profit) - (Probability of Loss * Stake)
  // Potential Profit = Stake * (Odds - 1)
  // For stake = 1 unit: EV = (P_win * (Odds - 1)) - ((1 - P_win) * 1)
  let ev = 0;
  if (signal === 'BUY') {
    ev = (modelProbability * (marketOdds - 1)) - (1 - modelProbability);
  } else if (signal === 'SELL') {
    // Laying (Selling) is harder to calculate EV for simple decimal odds without liability math,
    // so we approximate it as the inverse.
    const layOdds = marketOdds; 
    ev = ((1 - modelProbability) * (layOdds - 1)) - modelProbability;
  }

  // Kelly Criterion: fraction of bankroll to wager = (bp - q) / b
  // b = fractional odds (decimal - 1)
  // p = probability of winning
  // q = probability of losing (1 - p)
  let kellyFraction = 0;
  if (signal === 'BUY' && ev > 0) {
    const b = marketOdds - 1;
    const p = modelProbability;
    const q = 1 - p;
    kellyFraction = (b * p - q) / b;
  }

  return {
    matchId,
    homeTeam,
    awayTeam,
    market: marketName,
    modelProbability: modelProbability,
    marketProbability: Number(marketProbability.toFixed(4)),
    divergence: Number(divergence.toFixed(4)),
    oddsDifference: Number((marketOdds - (1/modelProbability)).toFixed(4)),
    direction,
    signal,
    decimalOdds: marketOdds,
    ev: Number(ev.toFixed(4)),
    kellyFraction: Number(Math.max(0, kellyFraction).toFixed(4)), // No negative Kelly
    explanation: 'Awaiting Scout context.',
    timestamp: new Date().toISOString(),
    matchMinute
  };
}
