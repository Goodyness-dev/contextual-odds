'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';

interface SignalStatus {
  isRunning: boolean;
  uptime: number;
  latestEvaluation?: {
    matchMinute: number;
    score: string;
    isFinished: boolean;
    scoutReport?: {
      sentimentSummary: string;
    };
  };
}

interface ReasoningStep {
  agent: 'TXODDS' | 'QUANT' | 'SCOUT' | 'RISK' | 'SOLANA';
  label: string;
  value: number;
  detail: string;
}

interface ReasoningChain {
  steps: ReasoningStep[];
  rawMarketOdds: number;
  rawMarketProb: number;
  poissonModelProb: number;
  blendedBaseProb: number;
  nlpMultiplier: number;
  nlpImpactPercent: number;
  finalAdjustedProb: number;
  finalTrueOdds: number;
  edgePercent: number;
  kellyFraction: number;
}

interface AgentPrediction {
  id: string;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  signal: 'BUY' | 'SELL';
  market: string;
  entryOdds: number;
  modelProbability: number;
  marketProbability: number;
  oddsDifference: number;
  timestamp: string;
  matchMinute: number;
  solanaTxSignature: string;
  explorerUrl: string;
  status: 'PENDING' | 'CORRECT' | 'INCORRECT';
  explanation: string;
  reasoningChain?: ReasoningChain;
  resolvedAt?: string;
  finalScore?: { home: number; away: number };
}

interface PredictionSummary {
  totalPredictions: number;
  resolved: number;
  correct: number;
  incorrect: number;
  accuracy: number;
}

interface Fixture {
  FixtureId: number;
  Participant1: string;
  Participant2: string;
}

const TypewriterText = ({ text, delay = 0, onType }: { text: string, delay?: number, onType?: () => void }) => {
  const [displayed, setDisplayed] = useState('');
  
  useEffect(() => {
    let interval: NodeJS.Timeout;
    const timer = setTimeout(() => {
      interval = setInterval(() => {
        setDisplayed(prev => {
          if (prev.length >= text.length) {
            clearInterval(interval);
            return prev;
          }
          if (onType) onType();
          return text.substring(0, prev.length + 1);
        });
      }, 20);
    }, delay);
    
    return () => {
      clearTimeout(timer);
      if (interval) clearInterval(interval);
    };
  }, [text, delay]);
  
  return <span>{displayed}</span>;
};

export default function SignalDashboard() {
  const [status, setStatus] = useState<SignalStatus | null>(null);
  const [predictions, setPredictions] = useState<AgentPrediction[]>([]);
  const [summary, setSummary] = useState<PredictionSummary | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [selectedFixtureId, setSelectedFixtureId] = useState<string>('');
  
  const handleFixtureSelect = (id: string) => {
    setSelectedFixtureId(id);
    if (id) {
      fetch('/api/signal/simulate/preload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixtureId: Number(id) })
      }).catch(console.error);
    }
  };

  const [oddsDifferenceThreshold, setOddsDifferenceThreshold] = useState<string>('0.2');
  const [narrativeStream, setNarrativeStream] = useState<Exclude<SignalStatus['latestEvaluation'], undefined>[]>([]);
  const streamEndRef = useRef<HTMLDivElement>(null);
  
  const [loading, setLoading] = useState(true);
  const [chatMessage, setChatMessage] = useState('');
  const [chatResponse, setChatResponse] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [activeAlarm, setActiveAlarm] = useState<AgentPrediction | null>(null);

  const resolvedPredictions = predictions.filter(p => p.status === 'CORRECT' || p.status === 'INCORRECT');
  const totalInvested = resolvedPredictions.length * 1.0;
  let totalPayout = 0;
  resolvedPredictions.forEach(p => {
    if (p.status === 'CORRECT') {
      totalPayout += p.entryOdds;
    }
  });
  const profit = totalPayout - totalInvested;
  const percentageProfit = totalInvested > 0 ? (profit / totalInvested) * 100 : 0;

  // Auto-refresh data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statusRes, predictionsRes, summaryRes, fixturesRes] = await Promise.all([
          fetch(`/api/signal/status`),
          fetch(`/api/signal/signals`),
          fetch(`/api/signal/ledger`),
          fetch(`/api/signal/fixtures`).catch(() => ({ ok: false, json: () => Promise.resolve([]) } as unknown as Response))
        ]);

        if (statusRes.ok) setStatus(await statusRes.json());
        if (predictionsRes.ok) setPredictions(await predictionsRes.json());
        if (summaryRes.ok) setSummary(await summaryRes.json());
        
        if (fixturesRes.ok) {
           const f = await fixturesRes.json();
           setFixtures(f);
        }
      } catch (err) {
        console.error('Failed to fetch signal data', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const scrollStreamToBottom = () => {
    if (streamEndRef.current) {
      streamEndRef.current.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    }
  };

  useEffect(() => {
    scrollStreamToBottom();
  }, [narrativeStream]);

  const runSimulation = async () => {
    if (isSimulating) return;
    if (!selectedFixtureId) {
      alert("Please select a game to deploy the scout.");
      return;
    }
    
    setIsSimulating(true);
    setNarrativeStream([]);
    
    // Clear past demo data
    await fetch('/api/signal/simulate/reset', { method: 'POST' });
    setPredictions([]);
    setSummary(null);
    
    // Stream live updates
    let localPredictionCount = 0;
    for (let i = 0; i < 96; i++) {
      await fetch(`/api/signal/simulate`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oddsDifferenceThreshold: parseFloat(oddsDifferenceThreshold) || 2.0 })
      });
      
      const [statusRes, predictionsRes, summaryRes] = await Promise.all([
        fetch(`/api/signal/status`),
        fetch(`/api/signal/signals`),
        fetch(`/api/signal/ledger`)
      ]);
      
      if (statusRes.ok) {
        const s = await statusRes.json();
        setStatus(s);
        if (s.latestEvaluation) {
          setNarrativeStream(prev => {
             if (prev.length > 0 && prev[prev.length - 1].matchMinute === s.latestEvaluation.matchMinute) {
                return prev;
             }
             return [...prev, s.latestEvaluation];
          });
        }
      }
      let hasNewEvent = false;
      if (predictionsRes.ok) {
        const newPredictions = await predictionsRes.json();
        if (newPredictions.length > localPredictionCount) {
           hasNewEvent = true;
           localPredictionCount = newPredictions.length;
        }
        
        setPredictions(prev => {
          const thresholdVal = parseFloat(oddsDifferenceThreshold) || 0;
          newPredictions.forEach((p: AgentPrediction) => {
            const isNew = !prev.find(oldP => oldP.id === p.id);
            if (isNew && p.oddsDifference >= thresholdVal) {
              // Play a digital alarm sound using Web Audio API
              try {
                const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
                const audioCtx = new AudioContextClass();
                const oscillator = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();
                
                oscillator.type = 'square';
                oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
                oscillator.frequency.setValueAtTime(1108.73, audioCtx.currentTime + 0.15); // C#6
                oscillator.frequency.setValueAtTime(880, audioCtx.currentTime + 0.3);
                oscillator.frequency.setValueAtTime(1108.73, audioCtx.currentTime + 0.45);
                
                gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
                
                oscillator.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                
                oscillator.start();
                oscillator.stop(audioCtx.currentTime + 0.6);
              } catch (e) {
                console.error('Audio play failed', e);
              }

              // Show the custom pop-up card
              setActiveAlarm(p);
            }
          });
          return newPredictions;
        });
      }
      if (summaryRes.ok) setSummary(await summaryRes.json());
      
      if (i < 95) {
        // Target ~45 seconds total: 91 normal ticks * 350ms + 5 anomalies * 2000ms = ~42 seconds + network overhead = ~45 seconds
        const delay = hasNewEvent ? 2000 : 350; 
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    setIsSimulating(false);
  };



  const sendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;
    setIsChatting(true);
    setChatResponse('');
    try {
      const res = await fetch(`/api/signal/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: chatMessage })
      });
      const data = await res.json();
      
      let i = 0;
      const fullText = data.reply;
      const typingInterval = setInterval(() => {
        setChatResponse(prev => prev + fullText.charAt(i));
        i++;
        if (i >= fullText.length) clearInterval(typingInterval);
      }, 20);

    } catch (err) {
      console.error(err);
      setChatResponse('Error reaching Oracle core. Neural link severed.');
    } finally {
      setIsChatting(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white selection:bg-green-500/30">
      
      {/* Alarm Pop-Up Toast */}
      {activeAlarm && (
        <div className="fixed top-6 right-6 z-[100] animate-in slide-in-from-top-10 fade-in duration-500 max-w-[400px] w-full">
          <div className="bg-[#111] border-2 border-green-500 rounded-xl p-6 shadow-[0_0_30px_rgba(34,197,94,0.3)]">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center animate-pulse">
                  <span className="text-green-500 text-2xl">🚨</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Value Bet Detected</h2>
                  <p className="text-sm text-green-400">Context Gap Confirmed</p>
                </div>
              </div>
              <button 
                onClick={() => setActiveAlarm(null)}
                className="text-gray-500 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4 mb-6">
              <div className="bg-[#222] p-4 rounded-lg border border-[#333]">
                <div className="text-sm text-gray-400 mb-1">Recommended Action</div>
                <div className="text-2xl font-black text-green-400 tracking-tight uppercase">
                  BET {activeAlarm.market.replace('_', ' ')}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#222] p-3 rounded-lg border border-[#333]">
                  <div className="text-xs text-gray-400">Model Prob</div>
                  <div className="text-lg text-white font-mono">{(activeAlarm.modelProbability * 100).toFixed(1)}%</div>
                </div>
                <div className="bg-[#222] p-3 rounded-lg border border-[#333]">
                  <div className="text-xs text-gray-400">Odds Gap</div>
                  <div className="text-lg text-green-400 font-mono">+{activeAlarm.oddsDifference.toFixed(2)}</div>
                </div>
              </div>
              
              <div className="bg-[#222] p-3 rounded-lg border border-[#333] max-h-48 overflow-y-auto">
                <div className="text-xs text-gray-400 mb-2">AI Reasoning</div>
                <div className="text-sm text-gray-300 italic whitespace-pre-wrap">
                  {activeAlarm.explanation}
                </div>
              </div>
            </div>
            
            <button 
              onClick={() => setActiveAlarm(null)}
              className="w-full py-2 mt-4 bg-green-500 hover:bg-green-400 text-black font-bold rounded-lg transition-colors text-sm"
            >
              ACKNOWLEDGE & CLOSE
            </button>
          </div>
        </div>
      )}

      {/* Brutalist Header */}
      <div className="border-b border-[#333] py-8 px-6 lg:px-12 sticky top-0 z-50 bg-[#0A0A0A]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-4">
            <div className="w-3 h-3 bg-white rounded-full mercury-bg shadow-[0_0_10px_rgba(255,255,255,0.8)]"></div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white mb-1 uppercase">
                CONTEXTUAL ODDS <span className="text-[#888] font-light">|</span> POWERED BY TXODDS
              </h1>
              <p className="text-[10px] text-[#888] uppercase tracking-[0.2em]">
                AGENTIC ORACLE &middot; TXLINE DATA &middot; SOLANA PROOFS
              </p>
            </div>
          </div>
          <div className="flex gap-4">
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 lg:px-12 py-10 space-y-12">
        
        {/* Game Deployment Form */}
        <section className="bg-[#111] border border-[#333] p-8 md:p-12 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl"></div>
          <h2 className="text-2xl font-bold mb-4 uppercase">Deploy Watcher Agent</h2>
          <p className="text-sm text-[#888] mb-8 max-w-2xl">
            Select an upcoming or live match. The agent will monitor the mathematical odds provided by TxOdds and cross-reference them with live NLP commentary. When a &quot;Context Gap&quot; emerges, the agent will anchor a verifiable prediction to Solana.
          </p>
          
          <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-grow w-full">
              <label className="block text-[10px] tracking-widest text-[#555] uppercase mb-2">Select Target Match</label>
              <select 
                value={selectedFixtureId || ''}
                onChange={(e) => handleFixtureSelect(e.target.value)}
                className="w-full bg-[#0A0A0A] border border-[#333] text-white px-4 py-3 focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="">-- Choose a Match --</option>
                {fixtures.map(f => (
                  <option key={f.FixtureId} value={f.FixtureId}>
                    [World Cup] {f.Participant1} vs {f.Participant2}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="flex-grow w-full md:w-32 flex-none" style={{ display: 'none' }}>
              {/* Removed Min Odds Gap input entirely to rely purely on backend EV calculations */}
            </div>
            
            <button
              onClick={runSimulation}
              disabled={isSimulating || !selectedFixtureId}
              className={`px-8 py-3 h-[50px] border border-[#333] transition-colors text-xs uppercase tracking-widest w-full md:w-auto ${isSimulating ? 'text-[#888] mercury-bg text-black font-bold' : 'bg-white text-black hover:bg-gray-200'}`}
            >
              {isSimulating ? 'SCOUT ACTIVE...' : 'DEPLOY SCOUT'}
            </button>
          </div>
        </section>

        {/* Oracle Performance */}
        <section>
          <div className="flex items-center gap-4 mb-6">
            <h2 className="text-xs tracking-[0.2em] text-[#666] uppercase">ORACLE REPUTATION (ON-CHAIN)</h2>
            <div className="h-[1px] flex-grow bg-[#333]"></div>
          </div>
          
          <div className="border border-[#333] flex flex-col md:flex-row relative">
            <div className="p-8 w-full border-[#333]">
              <div className="flex flex-wrap justify-between gap-8">
                <ArenaStat label="TOTAL PREDICTIONS" value={summary?.totalPredictions || 0} />
                <ArenaStat label="CORRECT CALLS" value={summary?.correct || 0} highlight="text-green-400" />
                <ArenaStat label="INCORRECT CALLS" value={summary?.incorrect || 0} highlight="text-red-400" />
                <ArenaStat label="ACCURACY RATE" value={`${((summary?.accuracy || 0) * 100).toFixed(1)}%`} highlight={(summary?.accuracy || 0) >= 0.5 ? 'text-green-400' : 'text-white'} />
              </div>
            </div>
          </div>
        </section>

        {status?.latestEvaluation?.isFinished && resolvedPredictions.length > 0 && (
          <section className="bg-blue-900/10 border border-blue-500/30 p-8 relative overflow-hidden animate-in fade-in duration-1000">
             <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl"></div>
             <h2 className="text-2xl font-bold text-white tracking-tight uppercase mb-2">Final Financial Yield</h2>
             <p className="text-[#aaa] text-sm mb-8">Calculated based on a flat $1.00 per prediction.</p>
             
             <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
               <div className="bg-[#0A0A0A] p-6 border border-[#333]">
                 <div className="text-xs tracking-widest text-[#888] uppercase mb-2">Total Predicted</div>
                 <div className="text-3xl font-bold text-white">${totalInvested.toFixed(2)}</div>
               </div>
               <div className="bg-[#0A0A0A] p-6 border border-[#333]">
                 <div className="text-xs tracking-widest text-[#888] uppercase mb-2">Total Payout</div>
                 <div className="text-3xl font-bold text-white">${totalPayout.toFixed(2)}</div>
               </div>
               <div className="bg-[#0A0A0A] p-6 border border-[#333]">
                 <div className="text-xs tracking-widest text-[#888] uppercase mb-2">Net Profit</div>
                 <div className={`text-3xl font-bold ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                   {profit >= 0 ? '+' : ''}${(profit).toFixed(2)}
                 </div>
               </div>
               <div className="bg-[#0A0A0A] p-6 border border-[#333]">
                 <div className="text-xs tracking-widest text-[#888] uppercase mb-2">ROI / Yield</div>
                 <div className={`text-3xl font-bold ${percentageProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                   {percentageProfit >= 0 ? '+' : ''}{percentageProfit.toFixed(1)}%
                 </div>
               </div>
             </div>
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[60%_40%] gap-8">
          {/* Live Signal Feed */}
          <section>
            <div className="flex items-center gap-4 mb-6">
              <h2 className="text-xs tracking-[0.2em] text-[#666] uppercase">LIVE PREDICTION STREAM</h2>
              <div className="h-[1px] flex-grow bg-[#333]"></div>
            </div>

            {/* Narrative Intelligence Stream */}
            <div className="mb-6 border border-[#333] bg-[#0A0A0A]">
              <div className="p-3 border-b border-[#333] bg-[#111] flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></div>
                <span className="text-[10px] text-blue-400 font-bold uppercase tracking-widest">
                  AI Cortex / Narrative Stream
                </span>
              </div>
              <div className="h-64 overflow-y-auto p-4 custom-scrollbar flex flex-col gap-4 font-mono text-xs">
                {narrativeStream.length === 0 ? (
                  <div className="text-[#555] italic">System idle. Deploy scout to begin surveillance...</div>
                ) : (
                  narrativeStream.map((log, idx) => (
                    <div key={idx} className="flex flex-col gap-1 border-l-2 border-[#333] pl-3 py-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="text-[10px] text-[#666]">Minute {log.matchMinute} | Score: {log.score}</div>
                      <div className="text-[#ccc] whitespace-pre-wrap leading-relaxed">
                        {log.scoutReport?.sentimentSummary || ''}
                      </div>
                    </div>
                  ))
                )}
                {/* Auto-scroll anchor */}
                <div ref={streamEndRef} />
              </div>
            </div>
            
            {/* Solana Transaction Log (All Trades) */}
            <div className="mb-6 border border-[#333] bg-[#0A0A0A]">
              <div className="p-3 border-b border-[#333] bg-[#111] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></div>
                  <span className="text-[10px] text-purple-400 font-bold uppercase tracking-widest">
                    Solana Transaction Log (All Trades)
                  </span>
                </div>
              </div>
              <div className="h-48 overflow-y-auto p-4 custom-scrollbar flex flex-col gap-2 font-mono text-xs">
                {predictions.length === 0 ? (
                  <div className="text-[#555] italic">No transactions anchored yet...</div>
                ) : (
                  predictions.map(p => (
                    <div key={p.id} className="flex justify-between items-center border-b border-[#333] pb-2 last:border-0 last:pb-0">
                      <span className="text-[#aaa]">
                        Min {p.matchMinute || '?'} | {p.market.replace('_', ' ').toUpperCase()} | Gap: {p.oddsDifference > 0 ? '+' : ''}{(p.oddsDifference * 100).toFixed(1)}%
                      </span>
                      <a href={p.explorerUrl} target="_blank" className="text-blue-400 hover:text-blue-300 underline text-[10px]">
                        {p.solanaTxSignature ? p.solanaTxSignature.slice(0,16) + '...' : 'Verify'}
                      </a>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Streaming Analysis Context */}
            {status?.latestEvaluation && (
              <div className="mb-6 p-4 border border-[#333] bg-[#0A0A0A] relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-500"></div>
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
                    <span className="text-[10px] text-green-400 font-bold uppercase tracking-widest">
                      ACTIONABLE PREDICTIONS LOG
                    </span>
                  </div>
                  {status.latestEvaluation.isFinished ? (
                    <span className="text-[10px] text-red-400 font-bold tracking-widest border border-red-400/30 px-2 py-0.5 bg-red-400/10">MATCH ENDED</span>
                  ) : (
                    <span className="text-[10px] text-[#888] font-mono tracking-widest">SCORE {status.latestEvaluation.score}</span>
                  )}
                </div>
              </div>
            )}
            
            {loading ? (
              <div className="animate-pulse h-24 bg-[#111] border border-[#333]"></div>
            ) : predictions.length === 0 ? (
              <div className="text-center py-16 border border-[#333] border-dashed">
                <p className="text-[#555] text-xs">Waiting for a positive EV context anomaly...</p>
              </div>
            ) : (
              <div className="grid gap-6">
                {predictions.map(pred => (
                  <PredictionCard key={pred.id} prediction={pred} />
                ))}
              </div>
            )}
          </section>

          {/* Neural Link Chat */}
          <section>
            <div className="flex items-center gap-4 mb-6">
              <h2 className="text-xs tracking-[0.2em] text-[#666] uppercase">ORACLE UPLINK</h2>
              <div className="h-[1px] flex-grow bg-[#333]"></div>
            </div>
            <div className="border border-[#333] flex flex-col h-[600px] bg-[#0C0D0E] p-6 relative sticky top-32">
              <div className="flex justify-between items-center mb-8 border-b border-[#333] pb-4">
                <span className="text-[10px] tracking-widest text-[#555] uppercase">Terminal</span>
                <span className="text-[10px] tracking-widest text-[#555]">SESSION_0x4F</span>
              </div>
              
              <div className="flex-grow overflow-y-auto mb-4 custom-scrollbar flex flex-col justify-end text-[11px] text-[#888] space-y-2">
                {chatResponse ? (
                  <div className="text-[#ddd] whitespace-pre-wrap leading-relaxed">
                    {`> `}{chatResponse}
                    {isChatting && <span className="animate-pulse">_</span>}
                  </div>
                ) : (
                  <div className="opacity-50 mb-auto">
                    &gt; Connection established.<br/>
                    &gt; Awaiting input.<br/><br/>
                    Try: &quot;Why did you predict Over 1.5 in the Morocco game?&quot;<br/>
                    Try: &quot;What is your current win rate?&quot;
                  </div>
                )}
              </div>
              <form onSubmit={sendChatMessage} className="flex gap-2 border border-[#333] p-1 rounded-sm">
                <input
                  type="text"
                  value={chatMessage}
                  onChange={e => setChatMessage(e.target.value)}
                  placeholder="ask the oracle..."
                  className="flex-grow px-3 py-2 bg-transparent text-[#ddd] text-sm focus:outline-none placeholder-[#555]"
                  disabled={isChatting}
                />
                <button
                  type="submit"
                  disabled={isChatting}
                  className="px-6 py-2 bg-[#111] border border-[#333] text-white text-xs tracking-widest hover:bg-[#222] transition-colors"
                >
                  SEND
                </button>
              </form>
            </div>
          </section>
        </div>

      </div>
    </div>
  );
}

function ArenaStat({ label, value, highlight = 'text-white' }: { label: string, value: string | number, highlight?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] text-[#555] tracking-widest">{label}</p>
      <p className={`text-xl font-bold whitespace-pre-wrap leading-tight ${highlight}`}>{value}</p>
    </div>
  );
}

function PredictionCard({ prediction }: { prediction: AgentPrediction }) {
  const [expanded, setExpanded] = useState(false);
  const isWon = prediction.status === 'CORRECT';
  const isLost = prediction.status === 'INCORRECT';
  const isOpen = prediction.status === 'PENDING';

  const expLines = prediction.explanation.split('\n');
  const quantLine = expLines.find(l => l.includes('[QUANT_AGENT]'))?.replace('[QUANT_AGENT]: ', '') || 'Poisson model active.';
  const scoutLine = expLines.find(l => l.includes('[SCOUT_AGENT]'))?.replace('[SCOUT_AGENT]: ', '') || 'NLP impact 0.0%';
  const riskLine = expLines.find(l => l.includes('[RISK_MANAGER]'))?.replace('[RISK_MANAGER]: ', '') || 'True probability calculated.';

  const divPercent = (prediction.modelProbability - prediction.marketProbability) * 100;
  const divColor = divPercent > 15 ? 'text-green-400' : divPercent > 5 ? 'text-yellow-400' : 'text-red-400';

  const marketParts = prediction.market.split('_');
  const isTeamMarket = marketParts.length === 3;
  const line1 = isTeamMarket ? `${marketParts[0]} ${marketParts[1]}`.toUpperCase() : marketParts[0].toUpperCase();
  const line2 = isTeamMarket ? marketParts[2] : marketParts[1];

  const chain = prediction.reasoningChain;

  const agentColors: Record<string, string> = {
    TXODDS: '#888',
    QUANT: '#60a5fa',
    RISK: '#a78bfa',
    SCOUT: '#34d399',
    SOLANA: '#f472b6',
  };

  const agentLabels: Record<string, string> = {
    TXODDS: 'TxOdds Feed',
    QUANT: 'Quant Agent',
    RISK: 'Risk Manager',
    SCOUT: 'Scout NLP',
    SOLANA: 'Solana',
  };

  return (
    <div className="border border-[#333] bg-[#0A0A0A] flex flex-col text-[#FAFAF7] hover:border-[#666] transition-colors relative overflow-hidden">
      {/* Edge Indicator Banner */}
      <div className={`absolute top-0 right-0 px-4 py-1 text-[10px] font-bold tracking-widest ${divColor} border-l border-b border-[#333] bg-[#111]`}>
        CONTEXT GAP: {divPercent > 0 ? '+' : ''}{divPercent.toFixed(1)}%
      </div>

      {/* Top Header Row */}
      <div className="flex items-center p-6 border-b border-[#333] pt-8">
        <h3 className="text-xl font-bold tracking-tight">
          {prediction.homeTeam} <span className="text-[#666] text-sm font-normal mx-2">vs</span> {prediction.awayTeam}
        </h3>
        <div className="ml-6 border border-white bg-white text-black mercury-bg px-3 py-1.5 text-center leading-tight">
          <p className="text-[10px] font-bold">{line1}</p>
          <p className="text-[10px] font-bold leading-none">{line2} GOALS</p>
        </div>
        <div className="ml-auto text-[10px] text-[#666]">
          {new Date(prediction.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}
        </div>
      </div>

      {/* Hero Battle Grid */}
      <div className="grid grid-cols-2 p-6 border-b border-[#333] bg-[#111]">
        <div className="flex flex-col justify-center items-center border-r border-[#333] pr-6">
          <span className="text-[10px] tracking-widest text-[#666] uppercase mb-2">TxOdds Mathematical Price</span>
          <span className="text-4xl font-black text-[#888]">{(1 / prediction.marketProbability).toFixed(2)}</span>
          <span className="text-[10px] text-[#555] mt-1">Implied: {(prediction.marketProbability * 100).toFixed(1)}%</span>
        </div>
        <div className="flex flex-col justify-center items-center pl-6">
          <span className="text-[10px] tracking-widest text-[#666] uppercase mb-2 text-center">Oracle Contextual True Price</span>
          <span className="text-4xl font-black text-white">{(1 / prediction.modelProbability).toFixed(2)}</span>
          <span className="text-[10px] text-green-400 mt-1">Calculated: {(prediction.modelProbability * 100).toFixed(1)}%</span>
        </div>
      </div>

      {/* Live Context Block */}
      <div className="p-6 border-b border-[#333] bg-blue-900/10">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></div>
          <span className="text-[10px] tracking-widest text-blue-400 font-bold uppercase">Commentary Context Injection</span>
        </div>
        <div className="border-l-2 border-blue-400 pl-4 py-1 text-sm text-[#ccc] italic leading-relaxed">
          <TypewriterText text={scoutLine} delay={0} />
        </div>
      </div>

      {/* Agents Reasoning */}
      <div className="p-4 border-b border-[#333] space-y-2 text-[10px] text-[#666] bg-[#0A0A0A]">
        <div className="grid grid-cols-[80px_1fr]">
          <span className="text-[#444]">QUANT:</span>
          <span>{quantLine}</span>
        </div>
        <div className="grid grid-cols-[80px_1fr]">
          <span className="text-[#444]">ORACLE:</span>
          <span>{riskLine}</span>
        </div>
      </div>

      {/* Explain This Trade Button */}
      {chain && (
        <button 
          onClick={() => setExpanded(!expanded)}
          className="w-full p-3 border-b border-[#333] bg-[#0D0D0D] hover:bg-[#161616] transition-all duration-200 flex items-center justify-center gap-2 group cursor-pointer"
        >
          <svg 
            className={`w-3 h-3 text-purple-400 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          <span className="text-[10px] tracking-[0.25em] text-purple-400 font-bold uppercase group-hover:text-purple-300 transition-colors">
            {expanded ? 'COLLAPSE REASONING' : 'EXPLAIN THIS TRADE'}
          </span>
          <svg 
            className={`w-3 h-3 text-purple-400 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}

      {/* Expandable Reasoning Chain Panel */}
      {chain && expanded && (
        <div className="border-b border-[#333] bg-gradient-to-b from-[#0A0A1A] to-[#0A0A0A] overflow-hidden"
             style={{ animation: 'slideDown 0.3s ease-out' }}>
          
          {/* Header */}
          <div className="px-6 pt-5 pb-3 border-b border-[#222]">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse"></div>
              <span className="text-[10px] tracking-[0.25em] text-purple-400 font-bold uppercase">Agent Reasoning Pipeline</span>
            </div>
            <p className="text-[10px] text-[#555] mt-1">Each step shows how the swarm transformed raw market data into an actionable edge.</p>
          </div>

          {/* Waterfall Chart */}
          <div className="px-6 py-5">
            <div className="space-y-0">
              {chain.steps.map((step, i) => {
                const probDisplay = step.agent === 'SOLANA' 
                  ? '✓' 
                  : step.agent === 'RISK' && step.label === 'Edge Calculation'
                    ? `${(step.value * 100).toFixed(1)}% EV`
                    : `${(step.value * 100).toFixed(1)}%`;
                
                const barWidth = step.agent === 'SOLANA' 
                  ? 100 
                  : step.agent === 'RISK' && step.label === 'Edge Calculation'
                    ? Math.min(100, Math.max(10, step.value * 100 * 2))
                    : Math.min(100, Math.max(5, step.value * 100));

                const color = agentColors[step.agent] || '#666';
                
                return (
                  <div key={i} className="relative">
                    {/* Connector Line */}
                    {i > 0 && (
                      <div className="flex justify-center py-0">
                        <div className="w-px h-3 bg-[#333]"></div>
                      </div>
                    )}
                    
                    <div className="flex items-center gap-3 group/step">
                      {/* Step Number Node */}
                      <div 
                        className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 border"
                        style={{ 
                          borderColor: color, 
                          color: color,
                          backgroundColor: `${color}15`
                        }}
                      >
                        {i + 1}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color }}>
                            {agentLabels[step.agent]}
                          </span>
                          <span className="text-[10px] text-[#666]">→</span>
                          <span className="text-[10px] font-bold text-white">{step.label}</span>
                          <span className="ml-auto text-xs font-mono font-bold" style={{ color }}>
                            {probDisplay}
                          </span>
                        </div>
                        
                        {/* Visual Bar */}
                        <div className="h-1.5 bg-[#1a1a2e] rounded-full overflow-hidden mb-1.5">
                          <div 
                            className="h-full rounded-full transition-all duration-700"
                            style={{ 
                              width: `${barWidth}%`, 
                              backgroundColor: color,
                              opacity: 0.7
                            }}
                          />
                        </div>
                        
                        {/* Detail Text */}
                        <p className="text-[9px] text-[#555] leading-relaxed">{step.detail}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Summary Stats Row */}
          <div className="grid grid-cols-4 border-t border-[#222] bg-[#080812]">
            <div className="p-3 text-center border-r border-[#222]">
              <div className="text-[8px] text-[#555] tracking-widest uppercase mb-1">Market Odds</div>
              <div className="text-sm font-bold text-[#888] font-mono">{chain.rawMarketOdds.toFixed(2)}</div>
            </div>
            <div className="p-3 text-center border-r border-[#222]">
              <div className="text-[8px] text-[#555] tracking-widest uppercase mb-1">True Odds</div>
              <div className="text-sm font-bold text-white font-mono">{chain.finalTrueOdds.toFixed(2)}</div>
            </div>
            <div className="p-3 text-center border-r border-[#222]">
              <div className="text-[8px] text-[#555] tracking-widest uppercase mb-1">Edge</div>
              <div className="text-sm font-bold text-green-400 font-mono">+{chain.edgePercent.toFixed(1)}%</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-[8px] text-[#555] tracking-widest uppercase mb-1">Kelly %</div>
              <div className="text-sm font-bold text-purple-400 font-mono">{(chain.kellyFraction * 100).toFixed(1)}%</div>
            </div>
          </div>
        </div>
      )}

      {/* Footer Prediction Status */}
      <div className="p-4 px-6 flex justify-between items-center bg-[#0C0D0E]">
        <div className="flex gap-4 items-center">
          <div className={`font-bold text-sm tracking-widest ${isWon ? 'text-green-400' : isLost ? 'text-red-400' : 'text-white animate-pulse'}`}>
            {isOpen ? 'AWAITING OUTCOME...' : `PREDICTION ${isWon ? 'CORRECT' : 'INCORRECT'}`}
          </div>
        </div>
        <Link 
          href={prediction.explorerUrl}
          target="_blank"
          className="text-[10px] text-[#555] hover:text-white transition-colors flex items-center gap-1"
        >
          {prediction.solanaTxSignature ? `Proof: ${prediction.solanaTxSignature.slice(0, 6)}... \u2192` : 'verify on-chain \u2192'}
        </Link>
      </div>

    </div>
  );
}
