import { Router } from 'express';
import { signalAgent } from '../signal/signal-agent';
import { paperLedger } from '../signal/paper-ledger';
import { logger } from '../lib/logger';

const router = Router();

// GET /api/signal/status
router.get('/status', (req, res) => {
  res.json(signalAgent.getStatus());
});

import { txLineClient } from '../signal/txline-client';
import { SIGNAL_CONFIG } from '../signal/signal-config';

// GET /api/signal/fixtures
// Returns live and upcoming fixtures from TxLINE
router.get('/fixtures', async (req, res) => {
  try {
    const fixtures = await txLineClient.getFixtures(SIGNAL_CONFIG.worldCupCompetitionId);
    // Also attach our demo historical fixture so it's always selectable
    const historical = await txLineClient.getHistoricalFixtures();
    res.json([...fixtures, ...historical]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch fixtures' });
  }
});

// GET /api/signal/signals
// Returns all signals (trades) in the paper ledger
router.get('/signals', (req, res) => {
  const trades = paperLedger.getAllTrades();
  res.json(trades);
});

// GET /api/signal/signals/:matchId
// Returns signals for a specific match
router.get('/signals/:matchId', (req, res) => {
  const { matchId } = req.params;
  const trades = paperLedger.getAllTrades().filter(t => t.matchId === matchId);
  res.json(trades);
});

// GET /api/signal/ledger
// Returns summary P&L stats
router.get('/ledger', (req, res) => {
  const summary = paperLedger.getSummary();
  res.json(summary);
});

// GET /api/signal/ledger/trades
// Returns the raw trade list
router.get('/ledger/trades', (req, res) => {
  const trades = paperLedger.getAllTrades();
  res.json(trades);
});

import { config } from '../config';

// POST /api/signal/simulate
router.post('/simulate', async (req, res) => {
  const threshold = req.body?.oddsDifferenceThreshold;
  const result = await signalAgent.simulateTick(threshold ? Number(threshold) : undefined);
  res.json(result);
});

// POST /api/signal/simulate/reset
router.post('/simulate/reset', (req, res) => {
  paperLedger.clear();
  signalAgent.resetSimulation();
  res.json({ success: true });
});

// POST /api/signal/simulate/preload
router.post('/simulate/preload', async (req, res) => {
  const { fixtureId } = req.body;
  if (fixtureId) {
    // Fire and forget to start the massive data fetch in the background
    txLineClient.getHistoricalOdds(fixtureId).catch(err => logger.error({ err }, 'Failed preloading odds'));
  }
  res.json({ success: true });
});

// POST /api/signal/chat
router.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!config.GROQ_API_KEY) {
      return res.json({ reply: 'Sorry, I cannot chat right now as the Groq API key is missing.' });
    }

    const url = 'https://api.groq.com/openai/v1/chat/completions';
    
    // Give the LLM context of what the Swarm is doing
    const status = signalAgent.getStatus();
    const trades = paperLedger.getAllTrades();
    const openTrades = trades.filter(t => t.status === 'PENDING').length;
    const recentTrades = trades.slice(-3).map(t => `Minute: ${t.matchMinute}, Market: ${t.market}, Gap: +${(t.oddsDifference*100).toFixed(1)}%, Reason: ${t.explanation}`).join('\n');
    
    const systemPrompt = `
      You are the Oracle interface for the Elastico Signal Swarm, an AI sports betting system.
      You analyze live football (soccer) matches and beat bookmakers by exploiting "Context Gaps" between mathematical odds and real-time live commentary.
      
      You are composed of 3 sub-agents:
      1. Scout Agent (NLP analysis of live commentary to gauge attacking/defensive momentum)
      2. Quant Agent (Mathematical Poisson distribution based on TxOdds)
      3. Risk Manager (Combines math and sentiment to execute value bets)

      Current status: ${status.isRunning ? 'Running' : 'Stopped'}.
      Open trades: ${openTrades}. Total historical trades: ${trades.length}.
      
      Recent Trades Made:
      ${recentTrades || 'No trades yet.'}

      INSTRUCTIONS:
      1. Explain your reasoning in simple, exciting terms that a football fan would understand. 
      2. NEVER use stock market jargon (like "sell signals", "market drops", or "bull/bear"). Use terms like "attacking momentum", "goals", "value bet", "bookies".
      3. If asked why a specific bet was made, reference the Recent Trades context provided above.
      4. Keep your answers brief, punchy, and slightly futuristic.
    `;

    const payload = {
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      temperature: 0.7,
      max_tokens: 300
    };

    const apiRes = await fetch(url, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${config.GROQ_API_KEY}`,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify(payload)
    });
    
    const data = await apiRes.json();
    const text = data.choices?.[0]?.message?.content || "No response generated.";
    
    res.json({ reply: text });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Groq API Error');
    res.status(500).json({ reply: 'API ERROR: Neural link to Swarm failed.' });
  }
});

export default router;
