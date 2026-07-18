# 🧠 Elastico Signal Swarm (Autonomous AI Sports Betting Agent)

Welcome to the **Elastico Signal Swarm**, an autonomous, multi-agent AI system designed to exploit "Context Gaps" in live in-play sports betting markets. 

Built entirely in TypeScript as a Monorepo (Next.js Frontend + Express Node.js Backend), this architecture deploys a "Swarm" of specialized agents that evaluate live football (soccer) matches. It mathematically fuses quantitative Poisson distribution modeling with real-time NLP sentiment analysis of live commentary to identify Positive Expected Value (+EV) trades, and commits the immutable ledger of those trades to the Solana Blockchain.

If you are a judge for the hackathon or a fellow degenerate quantitative developer diving into the code, this document explicitly breaks down the technical anatomy of the Swarm, the exact math used, how the agents interact, and how we achieve alpha against bookmaker odds.

---

## 🏗️ System Architecture & Tech Stack

### Tech Stack
- **Frontend App:** Next.js (App Router), React, styled with Tailwind CSS (pnpm workspace in `apps/web`).
- **Backend Swarm Engine:** Node.js, Express, TypeScript (`backend/`).
- **AI / LLM Engine:** Llama-3.1-8b-instant via the Groq API (ultra-low latency), with built-in cascading fallbacks to SambaNova, Cerebras, and OpenRouter.
- **Blockchain integration:** Solana Devnet via `@solana/web3.js` and `@solana/spl-memo`.
- **Live Data Provider:** TxOdds / TxLine API for live fixtures, scores, minute-by-minute updates, and live bookmaker odds.

### The "Context Gap" Thesis
The core philosophy of Elastico is that **pure math is blind to context, and pure sentiment is blind to probability.** 

Bookmakers heavily rely on automated math models (like Poisson distribution) to set live lines. However, these models cannot "watch" the game. If a team is heavily dominating possession, pinning the opponent back, and generating dangerous attacks that don't result in a shot on target, the math model won't shift the odds fast enough. We call this delay the **Context Gap**.

To exploit this, the Swarm orchestration engine (`SwarmOrchestrator` in `backend/src/signal/signal-agent.ts`) runs a continuous event loop (`tick()`) that polls the TxLine API for live fixtures. For every live match, the engine dispatches three agents:

1. **The Scout Agent** (NLP Sentiment & Context)
2. **The Quant Agent** (Pure Mathematical Modeling)
3. **The Risk Manager** (The Oracle / Decision Engine)

---

## 🕵️ 1. The Scout Agent (`agent-scout.ts`)

The Scout Agent is responsible for ingesting live match commentary and returning a structured, deterministic sentiment matrix. 

**Execution Flow:**
1. A live commentary event is fetched for the current match minute.
2. We inject this event into a strict JSON-enforced prompt to Groq's Llama-3.1 API.
3. The LLM acts as a quantitative scout and returns a `ScoutReport`.

**Output Matrix (`ScoutReport`):** 
- `impactScore` (-1.0 to 1.0): Represents momentum. Positive means the event heavily favors fewer goals (e.g., defensive sub, time-wasting). Negative heavily favors more goals (e.g., pure attacking chaos, frantic pressing).
- `trustModifier` (0.0 to 1.0): A measure of how much the Swarm should trust the underlying math. If the game has devolved into a chaotic riot, the LLM outputs a low trust modifier, meaning the math should be heavily discounted.
- `teamAffinity` (`HOME`, `AWAY`, `NEUTRAL`): Identifies which team is currently dictating the momentum.

*Caching mechanisms are built-in (15 min TTL on specific commentary strings) to avoid hitting Groq rate limits while processing hundreds of live games simultaneously.*

---

## 🧮 2. The Quant Agent (`agent-quant.ts` & `probability-engine.ts`)

The Quant Agent acts as the cold, emotionless calculator. It is completely blind to the "vibe" of the game. It uses a **Dynamic Poisson Distribution Engine** to project the raw probability for every single permutation of goals from the current minute to the 90th minute.

**The Math Breakdown:**
1. **Pre-Match Baseline Calculation:** 
   The engine takes the average of (`Home xG Scored` + `Away xG Conceded`) and vice versa to establish `preMatchExpectedTotal`.
2. **In-Play Time Decay:** 
   Goals don't scale perfectly linearly, but the engine applies a time-decay algorithm proportional to the `remainingMinutes / 90`.
   ```typescript
   const expectedRemainingGoals = preMatchExpectedTotal * proportionRemaining;
   ```
3. **Context Adjustments (Red Cards & Historical Trends):** 
   Using dynamic `AgentWeights`, the engine heavily penalizes expected goals for red cards and adjusts the baseline based on historical Under 2.5 hit rates.
4. **Poisson Calculation:**
   The Poisson formula: `P(X = k) = (λ^k * e^-λ) / k!`
   ```typescript
   function poissonProbability(lambda: number, k: number): number {
     return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
   }
   ```
   The engine iterates this over every target (0.5, 1.5, 2.5, 3.5) and every market scope (Home, Away, Total), outputting a massive JSON object mapping 24 different markets to a raw `modelProbability` (0.0 to 1.0).

---

## ⚖️ 3. The Risk Manager (`agent-risk.ts`)

This is the Oracle. The Risk Manager ingests the outputs from both the Scout Agent and Quant Agent, alongside the current live Bookmaker Odds provided by TxOdds. 

**How the Alpha (+EV) is Calculated:**
1. **Market Extraction:** Extracts the bookmaker's implied probability for a specific market (`1 / marketOdds`).
2. **Contextual Blending:** The engine establishes a `baseProb` by blending the Bookmaker's math and the Quant Agent's math (50/50 weighting).
3. **NLP Shift Calculation:** It then applies the Scout Agent's `impactScore` as a proportional multiplier. The NLP context can aggressively shift the blended probability by up to 40% in either direction.
   ```typescript
   // Example of NLP shift applied to the base probability
   let newsMultiplier = isUnder ? 1 - (impact * 0.40) : 1 + (impact * 0.40);
   const adjustedModelProbability = Math.max(0.01, Math.min(0.99, baseProb * newsMultiplier));
   ```
4. **Expected Value (Edge) Calculation:** The engine recalculates the `trueOdds` (`1 / adjustedModelProbability`) and compares it against the live market odds.
   ```typescript
   // Positive Expected Value = Edge > 0
   const expectedValue = (marketOdds / trueOdds) - 1;
   ```
5. **Vetoes & Risk Rules:**
   - **Team Affinity Veto:** If the Scout Agent declares `HOME` affinity (Home team is dominating), the Risk Manager will strictly veto any bets on `home_under` or `away_over`.
   - **Variance Veto:** Hard vetoes on extreme lines (like 3.5 goals) in the first 15 minutes to avoid early game variance trapdoors.
   - **Global Cooldowns:** Enforces a strict 10-minute cooldown per match to prevent the Swarm from blindly spamming bets during a single chaotic sequence.

If a trade has a positive EV (Edge > 0%) and survives the risk gauntlet, the Risk Manager fires a Trade Signal!

---

## ⛓️ The Blockchain Ledger (`solana-writer.ts`)

Talk is cheap, and historical betting records are easily manipulated. To ensure absolute cryptographic proof of the Swarm's performance, every single generated signal is asynchronously written to the **Solana Devnet**.

We utilize the `@coral-xyz/anchor` and `@solana/web3.js` libraries alongside the standard SPL Memo program. 

**On-Chain Execution Flow:**
1. When a trade is executed, the parameters (Match ID, Market, Model Prob, Implied Prob, Edge, Prediction, and Timestamp) are compacted into a JSON payload:
   ```json
   {
      "v": "Elastico-Oracle-v1",
      "match": "Arsenal_v_Chelsea",
      "market": "over_2.5",
      "edge": 0.041,
      "prediction": "EXECUTE"
   }
   ```
2. For verification, we hash the payload using `SHA-256`.
3. An on-chain transaction is fired invoking the Memo program (`createMemoInstruction`), permanently burning the prediction string and the hash onto the block.
4. The resulting transaction signature and Solana Explorer URL are attached back to the local `paper-ledger.ts` state, fully auditable by anyone in the world.

---

## 🎙️ The Interactive Oracle Chat (`POST /api/signal/chat`)

Because staring at terminal logs can be boring, we built a conversational Oracle interface directly into the API. 

Using Llama-3.1, users can interrogate the Swarm directly from the Next.js frontend about its trading logic. The `/chat` endpoint dynamically injects the real-time context of the `paperLedger`, the number of open trades, and the stringified rationale of the 3 most recently executed trades into the system prompt. 

This allows the LLM to explain the underlying quantitative Poisson math and NLP shifts in colloquial, exciting football terms (without using dry stock-market jargon).

---

## 📈 Synthesizing Illiquid Markets via Poisson Distributions

A major challenge in building a live sports-betting agent is that bookmakers **do not stream odds for every market at every minute**. For example, once a team scores 2 goals, the "Over 1.5" market is instantly suspended. Similarly, extreme long-shot markets (like "Home Over 4.5" in the 5th minute) are rarely offered due to low liquidity. Bookmakers typically only stream the **Active Global Line** (e.g., if 3 goals have been scored, the active line is 3.5).

If an AI agent merely *looked up* odds, it would constantly crash with `Market Suspended` errors when trying to find mispriced edges in deeper markets. 

To solve this, Elastico operates exactly like Wall Street quantitative hedge funds: it **reverse-engineers the bookmaker's math**. 
1. The system reads the single active, highly liquid market from the TxOdds API.
2. It derives the true expected goals (`lambda`) for the remainder of the match using the formula `λ = -ln(P(0))`.
3. It uses a **Poisson Distribution Engine** to mathematically synthesize the entire probability space across all sub-markets (Global, Home, Away) for *any* target.

**Why extreme odds are mathematically correct:** 
Because the math calculates the exact probability of *remaining* expected goals, late-game odds scale exponentially. If a game is in the 85th minute, and the agent identifies a contextual edge for a team to score another goal, the mathematically synthesized odds might read `72.46` (a 1.4% implied probability). This is not an error—it perfectly represents the true real-world long-shot odds of a 90th-minute goal in a game the market expects to be dead. By synthesizing the entire market mathematically, the Elastico Swarm can hunt for Alpha in dark corners where the bookmaker isn't even looking!

---

## 🚀 Running the Agent

**1. Environment Setup:**
You will need a `.env` file in the `backend/` directory containing:
```env
GROQ_API_KEY=gsk_...
SIGNAL_ENABLED=true
NODE_ENV=development
```
You will also need a valid Solana wallet keypair named `devnet-wallet.json` in the `backend/` root to pay for gas fees on Devnet.

**2. Booting the Swarm Backend:**
```bash
cd backend
npm install
npm run dev
```
The Swarm Orchestrator will immediately boot, connect to TxOdds, initialize the Paper Ledger, and begin its autonomous polling loop.

**3. Booting the Next.js Dashboard:**
```bash
cd apps/web
pnpm install
pnpm dev
```
Navigate to `localhost:3000` to watch the Swarm hunt for Alpha in real time!
