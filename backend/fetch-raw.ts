import { txLineClient } from './src/signal/txline-client';
import * as fs from 'fs';

async function run() {
  console.log('Starting...');
  try {
    const odds = await txLineClient.getHistoricalOdds(18185036);
    const rawCache = (txLineClient as any).historicalOddsCache;
    if (rawCache) {
      fs.writeFileSync('raw-txodds.json', JSON.stringify(rawCache, null, 2));
      console.log('Wrote raw-txodds.json with ' + rawCache.length + ' updates.');
    } else {
      console.log('No cache found!');
    }
  } catch (err) {
    console.error('Error:', err);
  }
}
run();
