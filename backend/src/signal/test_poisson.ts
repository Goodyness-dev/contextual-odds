function testPoisson() {
  // Assume team P(0) is 0.6 (60% chance to score 0 goals)
  // This means Team Under 0.5 price is 1/0.6 = 1.66.
  const pTeamZero = 0.6;
  const lambdaTeam = -Math.log(pTeamZero);
  console.log(`Lambda Team: ${lambdaTeam.toFixed(3)}`);
  
  const lambdaGlobal = 2 * lambdaTeam;
  console.log(`Lambda Global: ${lambdaGlobal.toFixed(3)}`);
  
  const poissonProb = (lambda: number, k: number) => {
    let prob = 0;
    for (let i = 0; i <= k; i++) {
       let fact = 1;
       for (let j = 1; j <= i; j++) fact *= j;
       prob += (Math.pow(lambda, i) * Math.exp(-lambda)) / fact;
    }
    return prob;
  }
  
  // Test globalNeeded = 1.5 (k = 1)
  const pUnder15 = poissonProb(lambdaGlobal, 1);
  console.log(`P(Under 1.5): ${pUnder15.toFixed(3)} -> Price: ${(1/pUnder15).toFixed(2)}`);
  console.log(`P(Over 1.5): ${(1-pUnder15).toFixed(3)} -> Price: ${(1/(1-pUnder15)).toFixed(2)}`);
  
  // Test globalNeeded = 2.5 (k = 2)
  const pUnder25 = poissonProb(lambdaGlobal, 2);
  console.log(`P(Under 2.5): ${pUnder25.toFixed(3)} -> Price: ${(1/pUnder25).toFixed(2)}`);
  console.log(`P(Over 2.5): ${(1-pUnder25).toFixed(3)} -> Price: ${(1/(1-pUnder25)).toFixed(2)}`);
}

testPoisson();
