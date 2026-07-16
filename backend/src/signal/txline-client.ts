import axios from 'axios';
import { NETWORK_CONFIG } from './signal-config';
import { getAuthHeaders, clearAuthCache } from './txline-auth';
import { logger } from '../lib/logger';

export interface TxFixture {
  FixtureId: number;
  CompetitionId: number;
  StartTime: string; // ISO string
  Participant1: string; // Home
  Participant2: string; // Away
  Participant1IsHome: boolean;
}

export interface TxOddsOutcome {
  name: string; // e.g. "Under 2.5"
  price: number;
}

export interface TxOddsMarket {
  market_id: string; // e.g. "totals"
  market_name: string;
  outcomes: TxOddsOutcome[];
}

export interface TxOddsEntry {
  fixtureId: number;
  markets: TxOddsMarket[];
}

export interface TxScoreSnapshot {
  fixtureId: number;
  homeScore: number;
  awayScore: number;
  status: string; // e.g. "1H", "HT", "2H", "FT"
  matchMinute: number;
  redCardsHome: number;
  redCardsAway: number;
}

export class TxLineClient {
  private async getClient() {
    const headers = await getAuthHeaders();
    return axios.create({
      baseURL: `${NETWORK_CONFIG.apiOrigin}/api`,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      timeout: 60000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });
  }

  async getFixtures(competitionId?: number, retry = true): Promise<TxFixture[]> {
    try {
      const client = await this.getClient();
      const params = competitionId ? { competitionId } : {};
      const res = await client.get('/fixtures/snapshot', { params });
      return res.data;
    } catch (err: any) {
      if (err.response?.status === 403 && retry) {
        logger.info('Received 403, clearing auth cache and retrying...');
        clearAuthCache();
        return this.getFixtures(competitionId, false);
      }
      logger.error({ err: err.message }, 'Failed to fetch TxLINE fixtures');
      return [];
    }
  }


  async getOdds(fixtureId: number): Promise<TxOddsEntry | null> {
    try {
      const client = await this.getClient();
      const res = await client.get(`/odds/snapshot/${fixtureId}`);
      // Based on docs, it returns an array of entries or a single object. We'll handle assuming it's the odds object.
      // If it's an array, return the first one.
      const data = res.data;
      if (Array.isArray(data) && data.length > 0) return data[0];
      if (!Array.isArray(data)) return data;
      return null;
    } catch (err: any) {
      logger.error({ err: err.message, fixtureId }, 'Failed to fetch TxLINE odds');
      return null;
    }
  }

  async getScore(fixtureId: number): Promise<TxScoreSnapshot | null> {
    try {
      const client = await this.getClient();
      const res = await client.get(`/scores/snapshot/${fixtureId}`);
      // Usually scores are arrays of events or a state object
      const data = res.data;
      if (Array.isArray(data) && data.length > 0) {
         // Naive extraction for hackathon - in reality we'd parse the TxLINE soccer feed format
         // For now, assuming a simplified structure based on standard snapshots
         return {
           fixtureId,
           homeScore: data[0].home_score ?? 0,
           awayScore: data[0].away_score ?? 0,
           status: data[0].match_status ?? 'Scheduled',
           matchMinute: data[0].match_minute ?? 0,
           redCardsHome: data[0].home_red_cards ?? 0,
           redCardsAway: data[0].away_red_cards ?? 0
         };
      }
      return null;
    } catch (err: any) {
      logger.error({ err: err.message, fixtureId }, 'Failed to fetch TxLINE scores');
      return null;
    }
  }

  /**
   * Helper to extract decimal odds for a specific market outcome
   */
  extractMarketOdds(oddsData: TxOddsEntry | null, matchString: string): number | null {
    if (!oddsData || !oddsData.markets) return null;
    
    const totalsMarket = oddsData.markets.find(m => 
      m.market_id?.toLowerCase() === 'totals' || 
      m.market_name?.toLowerCase().includes('total') ||
      m.market_name?.toLowerCase().includes('under')
    );
    
    if (!totalsMarket || !totalsMarket.outcomes) return null;
    
    const targetOutcome = totalsMarket.outcomes.find(o => 
      o.name?.toLowerCase().includes(matchString.toLowerCase())
    );
    
    return targetOutcome ? targetOutcome.price : null;
  }

  // --- HISTORICAL REPLAY METHODS FOR THE DEMO ---
  private simulatedMinute = 0;
  private historicalOddsCache: any = null;

  async getHistoricalFixtures(): Promise<any[]> {
    return [
      {
        FixtureId: 18185036,
        Participant1: 'Morocco',
        Participant2: 'Canada',
        Participant1IsHome: true,
      }
    ];
  }

  async getHistoricalScore(fixtureId: number): Promise<TxScoreSnapshot | null> {
    const currentMinute = this.simulatedMinute;
    
    // Advance time for the next tick (max 96 to include additional/stoppage time)
    if (this.simulatedMinute < 96) {
      this.simulatedMinute++;
    } else {
      // Loop the demo back to the 0th minute so it never gets stuck!
      this.simulatedMinute = 0;
    }

    let home = 0;
    let away = 0;
    if (currentMinute >= 4) home = 1; // Ziyech goal
    if (currentMinute >= 23) home = 2; // En-Nesyri goal
    if (currentMinute >= 40) away = 1; // Aguerd OG

    return {
      fixtureId,
      homeScore: home,
      awayScore: away,
      status: currentMinute >= 96 ? 'FINISHED' : currentMinute >= 45 ? '2H' : '1H',
      matchMinute: currentMinute,
      redCardsHome: 0,
      redCardsAway: 0
    };
  }

  async getHistoricalOdds(fixtureId: number): Promise<TxOddsEntry | null> {
    try {
      if (!this.historicalOddsCache) {
        logger.info(`Fetching massive historical updates array for fixture ${fixtureId} (only happens once)...`);
        const client = await this.getClient();
        const res = await client.get(`/odds/updates/${fixtureId}`);
        this.historicalOddsCache = res.data;
      }
      
      const updates = this.historicalOddsCache;
      if (!Array.isArray(updates) || updates.length === 0) return null;

      // Find the absolute global time boundaries of the match
      const allTs = updates.map(u => u.Ts).filter(Boolean);
      const minTs = Math.min(...allTs);
      const maxTs = Math.max(...allTs);
      const totalDurationMs = maxTs - minTs;

      // Calculate the true timestamp for the current simulated minute
      const currentSimPercentage = Math.min(this.simulatedMinute / 96, 0.99);
      const targetTs = minTs + (totalDurationMs * currentSimPercentage);
      
      const targets = ['0.5', '1.5', '2.5', '3.5'];
      const outcomes: { name: string; price: number }[] = [];

      for (const target of targets) {
        const targetUpdates = updates.filter(u => 
          u.SuperOddsType?.includes('OVERUNDER') && 
          u.MarketParameters?.includes(target) &&
          u.Prices && u.Prices.length >= 2
        );

        // Find the most recent update that happened ON OR BEFORE our current target timestamp
        const validUpdates = targetUpdates.filter(u => u.Ts <= targetTs);
        
        if (validUpdates.length > 0) {
          // Take the absolute most recent one
          const targetUpdate = validUpdates[validUpdates.length - 1];
          
          const priceNames = targetUpdate.PriceNames || [];
          const underIdx = priceNames.findIndex((n: string) => n.toLowerCase().includes('under'));
          const overIdx = priceNames.findIndex((n: string) => n.toLowerCase().includes('over'));
          
          if (underIdx !== -1 && overIdx !== -1) {
            const globalUnderPrice = targetUpdate.Prices[underIdx] / 1000;
            const globalOverPrice = targetUpdate.Prices[overIdx] / 1000;
            
            outcomes.push({ name: `Under ${target}`, price: globalUnderPrice });
            outcomes.push({ name: `Over ${target}`, price: globalOverPrice });
            
            // Synthetic Team Totals:
            // Since home/away team scoring probability is roughly half of the total goals probability (plus or minus based on team strength),
            // For a hackathon demo, we'll synthesize realistic Team Totals odds by scaling the Global Totals odds.
            // If Global OVER 2.5 is 2.0 (50%), then Home OVER 1.5 might be around 2.5 (40%).
            // A simple realistic hack is: Team Over = Global Over * 1.5, Team Under = Global Under * 0.8
            outcomes.push({ name: `Home Under ${target}`, price: Math.max(1.01, globalUnderPrice * 0.8) });
            outcomes.push({ name: `Home Over ${target}`, price: globalOverPrice * 1.5 });
            
            outcomes.push({ name: `Away Under ${target}`, price: Math.max(1.01, globalUnderPrice * 0.75) }); // Away slightly less likely to score
            outcomes.push({ name: `Away Over ${target}`, price: globalOverPrice * 1.6 });
          }
        }
      }

      if (outcomes.length > 0) {
        // Find 2.5 for logging just to keep terminal somewhat clean, or log all
        const under25 = outcomes.find(o => o.name === 'Under 2.5')?.price;
        const over25 = outcomes.find(o => o.name === 'Over 2.5')?.price;
        if (under25 && over25) {
          console.log(`\n[REPLAY MIN ${this.simulatedMinute}] -> OVER 2.5: ${over25.toFixed(3)} | UNDER 2.5: ${under25.toFixed(3)}`);
        }
        
        return {
          fixtureId,
          markets: [
            {
              market_id: 'totals',
              market_name: 'Total Goals',
              outcomes
            }
          ]
        };
      }
      return null;
    } catch (err: any) {
      logger.error({ err: err.message, fixtureId }, 'Failed to fetch historical TxLINE odds');
      return null;
    }
  }
}

export const txLineClient = new TxLineClient();
