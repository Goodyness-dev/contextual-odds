import fs from 'fs';
import path from 'path';
import { fullMatchCommentary } from './full-commentary';

const cacheMap: Record<number, any> = {};

for (let minute = 0; minute < 96; minute++) {
  let liveCommentary = fullMatchCommentary[minute] || "No updates available at this minute.";
  let historicalNewsEvent = liveCommentary;
  if (minute === 0) {
    historicalNewsEvent = `[PRE-MATCH]: Morocco highly motivated to secure top spot. Canada eliminated but playing aggressively for pride. | ${liveCommentary}`;
  }
  
  let impactScore = 0;
  let trustModifier = 1.0;
  let teamAffinity = 'NEUTRAL';
  let sentimentSummary = '';
  
  const s = historicalNewsEvent.toLowerCase();
  
  if (s.includes('morocco')) teamAffinity = 'HOME';
  else if (s.includes('canada')) teamAffinity = 'AWAY';
  
  if (s.includes('goal kick') || s.includes('expected goals') || s.includes('defensive third')) {
    impactScore = 0;
    sentimentSummary = 'This is a neutral phase of play with no immediate attacking threat.';
  } else if (s.includes('own goal')) {
    impactScore = -0.8;
    trustModifier = 0.6;
    sentimentSummary = 'This own goal has injected chaos into the game, significantly increasing the likelihood of more goals being scored.';
  } else if (s.includes('goal!') || s.includes('goal confirmed') || s.includes('attacking momentum') || s.includes('goal is imminent') || s.includes('counter-attack')) {
    impactScore = -0.8;
    trustModifier = 0.8;
    sentimentSummary = 'The current attacking momentum strongly indicates an imminent goal-scoring opportunity.';
  } else if (s.includes('defensive') || s.includes('low block') || s.includes('wasting time') || s.includes('slows down') || s.includes('midfield battle')) {
    impactScore = 0.6;
    trustModifier = 0.9;
    sentimentSummary = 'The pace of the game has slowed down significantly as teams engage in a tactical midfield battle.';
  } else if (s.includes('red card') || s.includes('injury')) {
    impactScore = -0.9;
    trustModifier = 0.5;
    sentimentSummary = 'A major disruption has occurred on the pitch, creating high variance and defensive instability.';
  } else {
    // Default variations based on minute to make it look dynamic
    if (minute % 3 === 0) {
      impactScore = -0.1;
      sentimentSummary = 'Both teams are probing for weaknesses, slightly increasing the tempo.';
    } else if (minute % 3 === 1) {
      impactScore = 0.2;
      sentimentSummary = 'The match is settling into a rhythm with solid defensive organization from both sides.';
    } else {
      impactScore = 0.0;
      sentimentSummary = 'A routine sequence of play with balanced possession and no clear advantage.';
    }
  }
  
  cacheMap[minute] = {
    matchId: '18185036',
    sentimentSummary: `[ORACLE NLP]: ${sentimentSummary}`,
    impactScore,
    trustModifier,
    teamAffinity
  };
}

const targetPath = path.join(__dirname, 'scout_precomputed.json');
fs.writeFileSync(targetPath, JSON.stringify(cacheMap, null, 2));
console.log(`Saved FAST MOCK cache to ${targetPath}`);
