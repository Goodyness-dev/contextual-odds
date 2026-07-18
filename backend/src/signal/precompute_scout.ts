import fs from 'fs';
import path from 'path';
import { scoutAgent } from './agents/agent-scout';
import { fullMatchCommentary } from './full-commentary';

async function precompute() {
  const cacheMap: Record<number, any> = {};
  console.log('Starting precomputation for 96 minutes...');
  
  // We'll process them in batches of 10 to avoid rate limits
  const batchSize = 10;
  for (let i = 0; i < 96; i += batchSize) {
    const promises = [];
    for (let j = 0; j < batchSize && (i + j) < 96; j++) {
      const minute = i + j;
      promises.push(
        scoutAgent.analyzeMatchContext('18185036', 'Morocco', 'Canada', minute)
          .then(res => {
            cacheMap[minute] = res;
            console.log(`Precomputed minute ${minute}`);
          })
          .catch(err => {
            console.error(`Failed minute ${minute}:`, err);
          })
      );
    }
    await Promise.all(promises);
    // short delay between batches
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  const targetPath = path.join(__dirname, 'scout_precomputed.json');
  fs.writeFileSync(targetPath, JSON.stringify(cacheMap, null, 2));
  console.log(`Saved precomputed cache to ${targetPath}`);
}

precompute().catch(console.error);
