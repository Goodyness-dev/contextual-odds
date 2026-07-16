import * as fs from 'fs';
import * as path from 'path';
import { DivergenceResult } from './divergence';
import { SIGNAL_CONFIG } from './signal-config';
import { logger } from '../lib/logger';

export interface AgentPrediction {
  id: string;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  signal: 'BUY' | 'SELL';
  market: string;
  entryOdds: number;
  modelProbability: number;
  marketProbability: number;
  oddsDifference: number;
  timestamp: string;
  matchMinute: number;
  solanaTxSignature: string;
  explorerUrl: string;
  status: 'PENDING' | 'CORRECT' | 'INCORRECT';
  explanation: string;
  resolvedAt?: string;
  finalScore?: { home: number; away: number };
}

export interface PredictionSummary {
  totalPredictions: number;
  resolved: number;
  correct: number;
  incorrect: number;
  accuracy: number;
}

class PaperLedger {
  private predictions: Map<string, AgentPrediction> = new Map();

  constructor() {}

  public clear() {
    this.predictions.clear();
    logger.info('Paper ledger memory cleared.');
  }

  public openTrade(signal: DivergenceResult, signature: string, explorerUrl: string): AgentPrediction {
    const prediction: AgentPrediction = {
      id: `${signal.matchId}-${Date.now()}`,
      matchId: signal.matchId,
      homeTeam: signal.homeTeam,
      awayTeam: signal.awayTeam,
      signal: signal.signal as 'BUY' | 'SELL',
      market: signal.market,
      entryOdds: signal.decimalOdds,
      modelProbability: signal.modelProbability,
      marketProbability: signal.marketProbability,
      oddsDifference: signal.oddsDifference,
      timestamp: signal.timestamp,
      matchMinute: signal.matchMinute,
      solanaTxSignature: signature,
      explorerUrl,
      status: 'PENDING',
      explanation: signal.explanation
    };

    this.predictions.set(prediction.id, prediction);
    logger.info({ predictionId: prediction.id }, 'Logged new on-chain prediction');
    return prediction;
  }

  public getOpenTradesForMatch(matchId: string): AgentPrediction[] {
    return Array.from(this.predictions.values()).filter(t => t.matchId === matchId && t.status === 'PENDING');
  }

  public updateTradeSignature(tradeId: string, signature: string, explorerUrl: string) {
    const trade = this.predictions.get(tradeId);
    if (trade) {
      trade.solanaTxSignature = signature;
      trade.explorerUrl = explorerUrl;
      this.predictions.set(tradeId, trade);
    }
  }

  public getAllTrades(): AgentPrediction[] {
    return Array.from(this.predictions.values()).sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  public resolveTrade(tradeId: string, finalScore: { home: number; away: number }) {
    const totalGoals = finalScore.home + finalScore.away;

    // Resolve
    const prediction = this.predictions.get(tradeId);
    if (prediction && prediction.status === 'PENDING') {
      let marketWon = false;
      if (prediction.market.startsWith('home_')) {
        const parts = prediction.market.replace('home_', '').split('_');
        const target = parseFloat(parts[1] || '1.5');
        if (parts[0] === 'under') marketWon = finalScore.home < target;
        if (parts[0] === 'over') marketWon = finalScore.home > target;
      } else if (prediction.market.startsWith('away_')) {
        const parts = prediction.market.replace('away_', '').split('_');
        const target = parseFloat(parts[1] || '1.5');
        if (parts[0] === 'under') marketWon = finalScore.away < target;
        if (parts[0] === 'over') marketWon = finalScore.away > target;
      } else {
        const parts = prediction.market.split('_');
        const target = parseFloat(parts[1] || '2.5');
        if (parts[0] === 'under') marketWon = totalGoals < target;
        if (parts[0] === 'over') marketWon = totalGoals > target;
      }

      let isWin = false;
      if (prediction.signal === 'BUY' && marketWon) isWin = true;
      if (prediction.signal === 'SELL' && !marketWon) isWin = true;

      prediction.status = isWin ? 'CORRECT' : 'INCORRECT';
      prediction.finalScore = finalScore;
      prediction.resolvedAt = new Date().toISOString();
      this.predictions.set(tradeId, prediction);
    }
  }

  private generateSummaryObj(predictionsList: AgentPrediction[]): PredictionSummary {
    const resolved = predictionsList.filter(t => t.status !== 'PENDING');
    const correct = resolved.filter(t => t.status === 'CORRECT').length;
    const incorrect = resolved.filter(t => t.status === 'INCORRECT').length;
    
    const accuracy = resolved.length > 0 ? correct / resolved.length : 0;

    return {
      totalPredictions: predictionsList.length,
      resolved: resolved.length,
      correct,
      incorrect,
      accuracy
    };
  }

  public getSummary(): PredictionSummary {
    return this.generateSummaryObj(Array.from(this.predictions.values()));
  }
}

export const paperLedger = new PaperLedger();
