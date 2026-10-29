"use client";

import React, { useState } from "react";
import Link from "next/link";
import { 
  ShieldCheck, 
  ArrowRight, 
  Lock, 
  Clock, 
  Cpu, 
  Zap, 
  Activity, 
  Sparkles, 
  TrendingUp, 
  CheckCircle2, 
  AlertTriangle, 
  ExternalLink,
  ChevronRight,
  ShieldAlert,
  SlidersHorizontal,
  Flame,
  Check
} from "lucide-react";

export default function LandingPage() {
  // Interactive Simulator State right on the Landing Page
  const [simDrawdown, setSimDrawdown] = useState<number>(3.5);
  const maxDrawdownLimit = 5.0; // 5% limit
  const isSimFrozen = simDrawdown >= maxDrawdownLimit;
  const initialCapital = 10000;
  const currentBalance = initialCapital * (1 - simDrawdown / 100);
  const floorBalance = initialCapital * (1 - maxDrawdownLimit / 100);

  return (
    <div className="flex-1 flex flex-col w-full selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* Hero Section */}
      <section className="relative pt-16 pb-24 px-4 sm:px-8 max-w-7xl mx-auto w-full text-center">
        {/* Eyebrow badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-sm font-semibold mb-8">
          <Sparkles className="w-4 h-4 text-indigo-400" />
          <span>HashKey Chain Hackathon • Deterministic Vault Infrastructure</span>
        </div>

        {/* Main Headline with large confident typography */}
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold text-white tracking-tight leading-[1.1] max-w-5xl mx-auto mb-6">
          Autonomous Trading. <br className="hidden sm:inline" />
          <span className="bg-gradient-to-r from-indigo-400 via-indigo-300 to-emerald-400 bg-clip-text text-transparent">
            Deterministic Invariants.
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-lg sm:text-xl text-slate-300 max-w-3xl mx-auto leading-relaxed mb-10 font-normal">
          Risk Kernel is the smart contract mandate engine on HashKey Chain that turns natural language policies into bytecode-enforced loss floors, instant directional safety rules, and zero-gas trade approvals.
        </p>

        {/* Primary CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto mb-16">
          <Link
            href="/dashboard"
            id="hero-launch-app-btn"
            className="w-full sm:w-auto flex items-center justify-center gap-2.5 px-8 py-4 rounded-2xl text-base font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-xl shadow-indigo-600/30 transition-all hover:scale-[1.02]"
          >
            <span>Open Vault Command</span>
            <ArrowRight className="w-5 h-5" />
          </Link>
          <Link
            href="/onboarding"
            id="hero-configure-vault-btn"
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 rounded-2xl text-base font-semibold bg-[#161a25] hover:bg-[#1e2332] text-slate-200 border border-white/10 transition-all"
          >
            <span>Deploy New Vault</span>
          </Link>
        </div>

        {/* Interactive Live Vault Simulator */}
        <div className="openui-card-elevated p-6 sm:p-10 text-left max-w-5xl mx-auto border border-white/10 relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-white/10">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse"></span>
                <h3 className="text-xl font-bold text-white">Live Smart Contract Circuit Breaker Simulator</h3>
              </div>
              <p className="text-sm text-slate-400 mt-1">
                Drag the simulated portfolio drawdown slider to observe deterministic smart contract halt in real time.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {isSimFrozen ? (
                <span className="px-3.5 py-1.5 rounded-xl text-xs font-bold badge-rose flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                  CIRCUIT BREAKER TRIPPED (FROZEN)
                </span>
              ) : (
                <span className="px-3.5 py-1.5 rounded-xl text-xs font-bold badge-emerald flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  AUTONOMOUS AGENT ACTIVE
                </span>
              )}
            </div>
          </div>

          {/* Interactive Drawdown Slider */}
          <div className="mb-8">
            <div className="flex items-center justify-between text-sm font-semibold mb-3">
              <span className="text-slate-300">Simulate Market Drawdown:</span>
              <span className="text-lg font-mono font-bold text-indigo-400">{simDrawdown.toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="10"
              step="0.1"
              value={simDrawdown}
              onChange={(e) => setSimDrawdown(parseFloat(e.target.value))}
              id="landing-drawdown-slider"
              className="w-full accent-indigo-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-2 font-mono">
              <span>0% (Peak Value: $10,000)</span>
              <span className="text-amber-400 font-bold">5.0% Mandate Floor: $9,500</span>
              <span className="text-rose-400 font-bold">10% Catastrophic Loss (Halted)</span>
            </div>
          </div>

          {/* Dynamic Metrics Display */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="p-4 rounded-xl bg-[#0e111a] border border-white/5">
              <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Simulated Balance</span>
              <div className="text-2xl font-bold font-mono text-white mt-1">
                ${currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <span className="text-xs text-slate-500">Base Asset (USDT)</span>
            </div>

            <div className="p-4 rounded-xl bg-[#0e111a] border border-white/5">
              <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Peak Portfolio Value</span>
              <div className="text-2xl font-bold font-mono text-white mt-1">
                $10,000.00
              </div>
              <span className="text-xs text-slate-500">High Water Mark</span>
            </div>

            <div className="p-4 rounded-xl bg-[#0e111a] border border-white/5">
              <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Loss Floor Limit</span>
              <div className="text-2xl font-bold font-mono text-rose-400 mt-1">
                $9,500.00
              </div>
              <span className="text-xs text-slate-500">5.0% Max Drawdown</span>
            </div>

            <div className="p-4 rounded-xl bg-[#0e111a] border border-white/5">
              <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Agent Trading Status</span>
              <div className={`text-xl font-bold mt-1 ${isSimFrozen ? "text-rose-400" : "text-emerald-400"}`}>
                {isSimFrozen ? "Blocked on Chain" : "Authorized"}
              </div>
              <span className="text-xs text-slate-500">
                {isSimFrozen ? "Zero Gas Spent" : "Within Position Limits"}
              </span>
            </div>
          </div>

          {/* Live Action Banner based on simulator state */}
          {isSimFrozen ? (
            <div className="p-4 rounded-xl openui-card-danger flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="text-sm">
                <span className="font-bold text-white">Circuit Breaker Enforced: </span>
                <span className="text-slate-300">
                  Drawdown breached the 5% threshold. The smart contract immediately froze agent authorization. Funds remain 100% in USDT. As the owner, you can withdraw your entire remaining capital or reset the floor anytime.
                </span>
                <div className="mt-3">
                  <button
                    onClick={() => setSimDrawdown(2.0)}
                    className="px-4 py-2 rounded-lg bg-rose-500 hover:bg-rose-400 text-slate-950 font-bold text-xs"
                  >
                    Reset & Unfreeze Simulation
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-[#0e111a] border border-emerald-500/20 flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-slate-300">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>Operating within safe boundaries. Distance to loss floor: <strong>${(currentBalance - floorBalance).toFixed(2)} USDT</strong>.</span>
              </div>
              <Link href="/dashboard" className="text-indigo-400 font-semibold hover:text-indigo-300 text-xs flex items-center gap-1">
                <span>View Real Vaults</span>
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Core Architectural Pillars */}
      <section className="py-20 px-4 sm:px-8 max-w-7xl mx-auto w-full border-t border-white/5">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-4">
            Built for Autonomous Financial Agents
          </h2>
          <p className="text-base text-slate-400 leading-relaxed">
            Existing smart contracts force you to choose between giving an agent full custody or micromanaging every transaction. Risk Kernel introduces a deterministic third way.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Pillar 1 */}
          <div className="openui-card p-6 flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mb-5">
                <ShieldCheck className="w-6 h-6 stroke-[2.5]" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Deterministic Loss Floor</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                The vault measures its value purely in its base asset (USDT). No external price oracles, no liquidation cascades. Every trade cycle must start and return in base asset.
              </p>
            </div>
            <div className="pt-6 border-t border-white/5 mt-6 text-xs text-slate-500 font-mono">
              INVARIANT: PnL = Bal - Peak
            </div>
          </div>

          {/* Pillar 2 */}
          <div className="openui-card p-6 flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-5">
                <SlidersHorizontal className="w-6 h-6 stroke-[2.5]" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Directional Mandates</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Rules that tighten risk (lowering drawdown, reducing trade caps) apply immediately without gas delays. Loosening rules are automatically quarantined behind a timelock delay.
              </p>
            </div>
            <div className="pt-6 border-t border-white/5 mt-6 text-xs text-slate-500 font-mono">
              POLICY: Safer = Instant | Looser = Delayed
            </div>
          </div>

          {/* Pillar 3 */}
          <div className="openui-card p-6 flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mb-5">
                <Clock className="w-6 h-6 stroke-[2.5]" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Zero-Gas EIP-712 Signatures</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Trades exceeding your autonomy threshold pause for owner confirmation. Sign a typed cryptographic message in MetaMask with zero gas; the agent attaches it to execute.
              </p>
            </div>
            <div className="pt-6 border-t border-white/5 mt-6 text-xs text-slate-500 font-mono">
              AUTH: EIP-712 Off-Chain Verification
            </div>
          </div>

          {/* Pillar 4 */}
          <div className="openui-card p-6 flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center mb-5">
                <Sparkles className="w-6 h-6 stroke-[2.5]" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Bounded AI Copilot</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Gemini LLM acts as an assistant with read tools and structured diff proposals. The AI is cryptographically incapable of transferring tokens or executing transactions on its own.
              </p>
            </div>
            <div className="pt-6 border-t border-white/5 mt-6 text-xs text-slate-500 font-mono">
              COPILOT: Propose Diffs Only
            </div>
          </div>
        </div>
      </section>

      {/* HashKey Chain Integration Highlights */}
      <section className="py-20 px-4 sm:px-8 max-w-7xl mx-auto w-full border-t border-white/5">
        <div className="openui-card-elevated p-8 sm:p-12 flex flex-col lg:flex-row items-center justify-between gap-8">
          <div className="max-w-xl">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-400 mb-2 block">
              Native HashKey Chain Integration
            </span>
            <h2 className="text-3xl font-extrabold text-white tracking-tight mb-4">
              HSK Gas, HSKSwap Liquidity, Blockscout Verification
            </h2>
            <p className="text-base text-slate-300 leading-relaxed mb-6 font-normal">
              Built natively for the HashKey ecosystem. Every trade cycle utilizes HSK for ultra-low gas execution, scans HSKSwap V2 and V3 pools for arbitrage spreads, and indexes events directly from the HashKey Blockscout explorer.
            </p>

            <div className="flex flex-wrap gap-3 text-xs font-mono">
              <span className="px-3 py-1.5 rounded-lg bg-[#0e111a] border border-white/10 text-slate-300">
                Chain ID: 133 (Testnet)
              </span>
              <span className="px-3 py-1.5 rounded-lg bg-[#0e111a] border border-white/10 text-slate-300">
                Chain ID: 177 (Mainnet)
              </span>
              <span className="px-3 py-1.5 rounded-lg bg-[#0e111a] border border-white/10 text-emerald-400 font-bold">
                Gas Token: HSK
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 w-full lg:w-auto">
            <Link
              href="/dashboard"
              className="px-8 py-4 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white text-center shadow-lg shadow-indigo-600/25 transition-all"
            >
              Enter Vault Dashboard
            </Link>
            <Link
              href="/chat"
              className="px-8 py-4 rounded-xl text-sm font-semibold bg-[#131722] hover:bg-[#1a202e] text-slate-200 border border-white/10 text-center transition-all"
            >
              Talk to AI Copilot
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
