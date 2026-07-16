import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../lib/logger';

export interface AgentWeights {
  redCardPenalty: number;
  historicalTrendWeight: number;
  baseConfidence: number;
  timeDecayAggressiveness: number;
  lastOptimized: string | null;
}

const WEIGHTS_PATH = path.resolve(process.cwd(), 'data', 'weights.json');

export function loadWeights(): AgentWeights {
  try {
    if (fs.existsSync(WEIGHTS_PATH)) {
      const data = fs.readFileSync(WEIGHTS_PATH, 'utf-8');
      return JSON.parse(data) as AgentWeights;
    }
  } catch (err) {
    logger.error('Failed to load weights.json, using defaults');
  }

  // Fallback defaults
  return {
    redCardPenalty: 0.05,
    historicalTrendWeight: 0.2,
    baseConfidence: 0.85,
    timeDecayAggressiveness: 1.0,
    lastOptimized: null
  };
}

export function saveWeights(weights: AgentWeights) {
  try {
    const dir = path.dirname(WEIGHTS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(weights, null, 2), 'utf-8');
    logger.info('Saved optimized weights to disk');
  } catch (err) {
    logger.error('Failed to save weights.json');
  }
}
