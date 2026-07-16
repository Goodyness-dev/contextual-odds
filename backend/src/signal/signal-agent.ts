import { txLineClient } from './txline-client';

import { scoutAgent } from './agents/agent-scout';
import { quantAgent } from './agents/agent-quant';
import { riskManagerAgent } from './agents/agent-risk';
import { writeSignalToSolana } from './solana-writer';
import { paperLedger } from './paper-ledger';
import { SIGNAL_CONFIG } from './signal-config';
import { logger } from '../lib/logger';

class SwarmOrchestrator {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private lastRunTime: Date | null = null;
  private lastSignalTimes = new Map<string, number>();
  private latestEvaluation: any = null;
  private readonly SIGNAL_COOLDOWN_MS = 25 * 1000; // 25 seconds for the demo (5 trades total) 

  public start() {
    if (!SIGNAL_CONFIG.enabled) {
      logger.info('Swarm Orchestrator is disabled in config. Set SIGNAL_ENABLED=true to start.');
      return;
    }
    if (this.isRunning) return;

    this.isRunning = true;
    logger.info('Starting Autonomous Swarm Orchestrator');
    this.tick();
    this.timer = setInterval(() => this.tick(), SIGNAL_CONFIG.pollIntervalMs);
  }

  public stop() {
    if (!this.isRunning) return;
    if (this.timer) clearInterval(this.timer);
    this.isRunning = false;
    logger.info('Stopped Autonomous Swarm Orchestrator');
  }

  public getStatus() {
    return {
      isRunning: this.isRunning,
      lastRunTime: this.lastRunTime,
      uptime: this.isRunning && this.lastRunTime ? Date.now() - this.lastRunTime.getTime() : 0,
      latestEvaluation: this.latestEvaluation
    };
  }

  public resetSimulation() {
    this.lastSignalTimes.clear();
    this.latestEvaluation = null;
    require('./txline-client').txLineClient.simulatedMinute = 0;
    logger.info('Swarm simulation state reset.');
  }

  private async tick() {
    try {
      this.lastRunTime = new Date();
      logger.info('Swarm TICK');

      const fixtures = await txLineClient.getFixtures(SIGNAL_CONFIG.worldCupCompetitionId);
      
      const liveFixtures = [];
      const completedFixtures = [];

      for (const fixture of fixtures) {
        const score = await txLineClient.getScore(fixture.FixtureId);
        if (!score) continue;
        
        const status = score.status.toUpperCase();
        if (['1H', '2H', 'HT', 'LIVE'].includes(status)) {
          liveFixtures.push({ fixture, score });
        } else if (['FT', 'AET', 'PEN', 'FINISHED'].includes(status)) {
          completedFixtures.push({ fixture, score });
        }
      }

      logger.info(`Found ${liveFixtures.length} live matches, ${completedFixtures.length} completed matches`);

      // 1. Process Live Fixtures
      for (const { fixture, score } of liveFixtures) {
        const matchId = fixture.FixtureId.toString();

        // Resolve open trades mid-game if conditions are definitively met
        const openTrades = paperLedger.getOpenTradesForMatch(matchId);
        const currentTotalGoals = score.homeScore + score.awayScore;
        
        for (const trade of openTrades) {
          const marketGoalTarget = parseFloat(trade.market.split('_')[1] || '0.5'); // e.g. "0.5"
          if (trade.market.startsWith('over')) {
            // OVER bets are instantly WON if the score exceeds the target
            if (currentTotalGoals > marketGoalTarget) {
              logger.info(`Mid-game Settlement: Trade ${trade.id} instantly WON (Goals: ${currentTotalGoals} > ${marketGoalTarget})`);
              paperLedger.resolveTrade(trade.id, { home: score.homeScore, away: score.awayScore });
            }
          } else if (trade.market.startsWith('under')) {
            // UNDER bets are instantly LOST if the score exceeds the target
            if (currentTotalGoals > marketGoalTarget) {
              logger.info(`Mid-game Settlement: Trade ${trade.id} instantly LOST (Goals: ${currentTotalGoals} > ${marketGoalTarget})`);
              paperLedger.resolveTrade(trade.id, { home: score.homeScore, away: score.awayScore });
            }
          }
        }

        // Fetch live odds
        const odds = await txLineClient.getOdds(fixture.FixtureId);
        
        if (!odds) continue;

        // COOLDOWN CHECK: Prevents spamming Gemini APIs!
        const lastSignalTime = this.lastSignalTimes.get(matchId) || 0;
        if (Date.now() - lastSignalTime < this.SIGNAL_COOLDOWN_MS) continue;

        const homeTeam = fixture.Participant1IsHome ? fixture.Participant1 : fixture.Participant2;
        const awayTeam = fixture.Participant1IsHome ? fixture.Participant2 : fixture.Participant1;

        // Step 1: Scout Agent gets context (LLM News)
        const scoutReport = await scoutAgent.analyzeMatchContext(matchId, homeTeam, awayTeam, score.matchMinute);

        // Step 2: Quant Agent gets pure math probabilities
        const quantResult = await quantAgent.analyzeMathModel(
          homeTeam,
          awayTeam,
          score.matchMinute,
          { home: score.homeScore, away: score.awayScore },
          { home: score.redCardsHome, away: score.redCardsAway }
        );

        this.latestEvaluation = {
          matchId,
          matchMinute: score.matchMinute,
          scoutReport,
          quantResult,
          score: `${score.homeScore}-${score.awayScore}`,
          isFinished: score.matchMinute >= 95
        };



        const allTrades = paperLedger.getAllTrades().filter(t => t.matchId === matchId);

        // Step 3: Risk Manager Agent combines both and makes a decision
        const finalSignal = riskManagerAgent.evaluateSignal(
          matchId,
          homeTeam,
          awayTeam,
          score.matchMinute,
          quantResult,
          scoutReport,
          odds,
          allTrades
        );

        if (finalSignal && finalSignal.signal !== 'HOLD') {
          logger.info(
            { matchId, signal: finalSignal.signal, div: finalSignal.divergence }, 
            'SWARM CONSENSUS: TRADE SIGNAL GENERATED'
          );

          const trade = paperLedger.openTrade(finalSignal, 'Awaiting Tx...', '');
          
          writeSignalToSolana(finalSignal).then(solanaResult => {
            paperLedger.updateTradeSignature(trade.id, solanaResult.signature, solanaResult.explorerUrl);
          }).catch(err => {
            logger.error({ err: err.message }, 'Async Solana write failed');
          });
          
          this.lastSignalTimes.set(matchId, Date.now());
        }
      }

      // 2. Resolve Completed Fixtures
      for (const { fixture, score } of completedFixtures) {
        const matchId = fixture.FixtureId.toString();
        const openTrades = paperLedger.getOpenTradesForMatch(matchId);
        
        for (const trade of openTrades) {
          paperLedger.resolveTrade(trade.id, {
            home: score.homeScore,
            away: score.awayScore
          });
        }
      }

    } catch (err: any) {
      logger.error({ err: err.message }, 'Error in Swarm Orchestrator tick');
    }
  }

  // Used exclusively for Hackathon demo / judges testing
  public async simulateTick(oddsDifferenceThreshold: number = 2.0) {
    try {
      logger.info('Swarm SIMULATION TICK triggered');

      const fixtures = await txLineClient.getHistoricalFixtures();
      
      for (const fixture of fixtures) {
        const matchId = fixture.FixtureId.toString();
        const score = await txLineClient.getHistoricalScore(fixture.FixtureId);
        const odds = await txLineClient.getHistoricalOdds(fixture.FixtureId);
        
        if (!score) continue;

        const homeTeam = fixture.Participant1;
        const awayTeam = fixture.Participant2;

        logger.info(`Simulating live match: ${homeTeam} vs ${awayTeam} (Min: ${score.matchMinute}, Score: ${score.homeScore}-${score.awayScore})`);

        // Resolve open trades mid-game if conditions are definitively met
        const openTrades = paperLedger.getOpenTradesForMatch(matchId);
        const currentTotalGoals = score.homeScore + score.awayScore;
        
        for (const trade of openTrades) {
          const marketGoalTarget = parseFloat(trade.market.split('_').pop() || '0.5'); // "home_over_0.5" -> "0.5"
          
          let relevantGoals = currentTotalGoals;
          if (trade.market.startsWith('home_')) relevantGoals = score.homeScore;
          if (trade.market.startsWith('away_')) relevantGoals = score.awayScore;

          if (trade.market.includes('over')) {
            // OVER bets are instantly WON if the score exceeds the target
            if (relevantGoals > marketGoalTarget) {
              logger.info(`Mid-game Settlement: Trade ${trade.id} instantly WON (Relevant Goals: ${relevantGoals} > ${marketGoalTarget})`);
              paperLedger.resolveTrade(trade.id, { home: score.homeScore, away: score.awayScore });
            }
          } else if (trade.market.includes('under')) {
            // UNDER bets are instantly LOST if the score exceeds the target
            if (relevantGoals > marketGoalTarget) {
              logger.info(`Mid-game Settlement: Trade ${trade.id} instantly LOST (Relevant Goals: ${relevantGoals} > ${marketGoalTarget})`);
              paperLedger.resolveTrade(trade.id, { home: score.homeScore, away: score.awayScore });
            }
          }
        }

        // Resolve any remaining trades if the game is over (Minute 95+)
        if (score.matchMinute >= 95) {
          this.latestEvaluation = { ...this.latestEvaluation, isFinished: true, matchMinute: score.matchMinute, score: `${score.homeScore}-${score.awayScore}` };
          const remainingTrades = paperLedger.getOpenTradesForMatch(matchId);
          if (remainingTrades.length > 0) {
            logger.info(`Match ended! Resolving ${remainingTrades.length} remaining open trades.`);
            for (const trade of remainingTrades) {
              paperLedger.resolveTrade(trade.id, { home: score.homeScore, away: score.awayScore });
            }
          }
          continue; // Stop generating signals if the game is over
        }



        // Step 1: Scout Agent (Using REAL LLM to evaluate sentiment)
        const scoutReport = await scoutAgent.analyzeMatchContext(matchId, homeTeam, awayTeam, score.matchMinute);

        // Step 2: Quant Agent
        const quantResult = await quantAgent.analyzeMathModel(
          homeTeam,
          awayTeam,
          score.matchMinute,
          { home: score.homeScore, away: score.awayScore },
          { home: score.redCardsHome, away: score.redCardsAway }
        );

        this.latestEvaluation = {
          matchId,
          matchMinute: score.matchMinute,
          scoutReport,
          quantResult,
          score: `${score.homeScore}-${score.awayScore}`,
          isFinished: score.matchMinute >= 95
        };



        const allTrades = paperLedger.getAllTrades().filter(t => t.matchId === matchId);

        // Step 3: Risk Manager
        const finalSignal = riskManagerAgent.evaluateSignal(
          matchId,
          homeTeam,
          awayTeam,
          score.matchMinute,
          quantResult,
          scoutReport,
          odds,
          allTrades,
          oddsDifferenceThreshold
        );

        if (finalSignal && finalSignal.signal !== 'HOLD') {
          logger.info(
            { matchId, signal: finalSignal.signal, div: finalSignal.divergence }, 
            'SWARM SIMULATION: TRADE SIGNAL GENERATED'
          );

          const trade = paperLedger.openTrade(finalSignal, 'Awaiting Tx...', '');
          
          writeSignalToSolana(finalSignal).then(solanaResult => {
            paperLedger.updateTradeSignature(trade.id, solanaResult.signature, solanaResult.explorerUrl);
          }).catch(err => {
            logger.error({ err: err.message }, 'Async Solana write failed');
          });
          
          // Record the minute the trade was placed to enforce cooldown
          this.lastSignalTimes.set(matchId, score.matchMinute);
          
          // NOTE: We no longer instantly resolve. The trades stay OPEN until minute 96.
        } else {
          logger.info('Swarm Simulation resulted in HOLD.');
        }
      }
      return { success: true, message: 'Simulation tick complete. Check the dashboard!' };
    } catch (err: any) {
      logger.error({ err: err.message }, 'Error in Swarm Simulation');
      return { success: false, error: err.message };
    }
  }
}

export const signalAgent = new SwarmOrchestrator();
