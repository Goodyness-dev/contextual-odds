import { txLineClient } from './txline-client';

async function testSim() {
  await txLineClient.getHistoricalOdds(18185036); // prime the cache
  
  for (let i = 0; i <= 90; i += 15) {
    (txLineClient as any).simulatedMinute = i;
    const res = await txLineClient.getHistoricalOdds(18185036);
    console.log(`\n--- MINUTE ${i} ---`);
    if (res && res.markets.length > 0) {
      res.markets[0].outcomes.forEach(o => {
        console.log(`${o.name}: ${o.price.toFixed(3)}`);
      });
    }
  }
}

testSim().catch(console.error);
