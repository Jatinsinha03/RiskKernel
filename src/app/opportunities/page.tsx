"use client";

import React, { useState, useEffect } from "react";
import { useVault } from "@/context/VaultContext";
import { 
  TrendingUp, 
  RefreshCw, 
  ArrowRight, 
  CheckCircle2, 
  XCircle, 
  Zap, 
  Clock, 
  Coins,
  ShieldAlert,
  Activity,
  AlertTriangle
} from "lucide-react";

interface OpportunityItem {
  id: string;
  vaultAddress: string;
  route: Array<{ tokenIn: string; tokenOut: string; fee: number }> | string[];
  tradeAmount: string;
  estimatedProfit: string;
  netProfitBps: number;
  minProfit: string;
  gasEstimate?: string;
  status: string; // detected, skipped, sent, confirmed, reverted, awaiting_approval, etc.
  reason?: string;
  aiScore?: number;
  aiReason?: string;
  createdAt: string;
}

interface AgentWorkerStatus {
  alive: boolean;
  status: string;
  killSwitchActive: boolean;
  lastLoopAt: string | null;
  lastBlock: number;
  agentHskBalance: string;
  activeVaultsCount: number;
  candidatesCount: number;
  simulationsCount: number;
  sendsCount: number;
  lastError: string | null;
}

export default function OpportunitiesPage() {
  const { selectedVault } = useVault();
  const [opportunities, setOpportunities] = useState<OpportunityItem[]>([]);
  const [workerStatus, setWorkerStatus] = useState<AgentWorkerStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isTogglingKill, setIsTogglingKill] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const url = selectedVault
        ? `/api/opportunities?vaultAddress=${selectedVault.address}`
        : "/api/opportunities";
      const [oppRes, statusRes] = await Promise.all([
        fetch(url),
        fetch("/api/agent/status").catch(() => null),
      ]);

      const oppData = await oppRes.json();
      if (oppData.opportunities) {
        setOpportunities(oppData.opportunities);
      }

      if (statusRes && statusRes.ok) {
        const sData = await statusRes.json();
        setWorkerStatus(sData);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, [selectedVault?.address]);

  const toggleKillSwitch = async () => {
    if (!workerStatus) return;
    const action = workerStatus.killSwitchActive ? "RESUME" : "KILL";
    const confirmMsg = workerStatus.killSwitchActive
      ? "Resume automated agent worker trading?"
      : "EMERGENCY: Immediately halt all automated trading attempts across all vaults?";

    if (!confirm(confirmMsg)) return;

    setIsTogglingKill(true);
    try {
      const res = await fetch("/api/agent/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsTogglingKill(false);
    }
  };

  return (
    <div className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-8 py-10 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-2">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight flex items-center gap-3">
            <TrendingUp className="w-8 h-8 text-indigo-400 stroke-[2.5]" />
            <span>HSKSwap Arbitrage Scanner Feed</span>
          </h1>
          <p className="text-sm text-slate-400 mt-2 font-normal">
            Real-time candidate cycles routed through HashKey Chain decentralized liquidity pools
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-[#141721] border border-white/10 text-slate-300 hover:text-white transition-colors text-sm font-semibold"
            title="Refresh feed"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>

          {workerStatus && (
            <button
              onClick={toggleKillSwitch}
              disabled={isTogglingKill}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-bold transition-all ${
                workerStatus.killSwitchActive
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                  : "bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20"
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
              <span>{workerStatus.killSwitchActive ? "Resume Agent" : "Emergency Kill Switch"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Live Agent Worker Heartbeat Banner */}
      {workerStatus && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="openui-card p-4 rounded-xl flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
              <Activity className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <div className="text-xs text-slate-400 font-medium">Worker Status</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    workerStatus.killSwitchActive
                      ? "bg-rose-500"
                      : workerStatus.alive
                      ? "bg-emerald-400 animate-pulse"
                      : "bg-slate-500"
                  }`}
                />
                <span className="text-sm font-bold text-white capitalize">
                  {workerStatus.killSwitchActive
                    ? "Halted (Kill Switch)"
                    : workerStatus.alive
                    ? workerStatus.status
                    : "Offline"}
                </span>
              </div>
            </div>
          </div>

          <div className="openui-card p-4 rounded-xl flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-400 font-medium">Agent Gas Balance</div>
              <div className="text-sm font-bold font-mono text-white mt-0.5">
                {parseFloat(workerStatus.agentHskBalance).toFixed(4)} HSK
              </div>
            </div>
          </div>

          <div className="openui-card p-4 rounded-xl flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-400 font-medium">Candidates Evaluated</div>
              <div className="text-sm font-bold font-mono text-white mt-0.5">
                {workerStatus.candidatesCount} cycles ({workerStatus.simulationsCount} sims)
              </div>
            </div>
          </div>

          <div className="openui-card p-4 rounded-xl flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-400 font-medium">Trades Executed</div>
              <div className="text-sm font-bold font-mono text-emerald-400 mt-0.5">
                {workerStatus.sendsCount} Confirmed
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invariant Explanation Banner */}
      <div className="p-6 rounded-2xl bg-[#0e111a] border border-white/5 flex items-start gap-4 text-sm text-slate-300">
        <Coins className="w-6 h-6 text-indigo-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-white text-base block mb-1">
            Phase 2 Profit-or-Revert Smart Contract Guarantee
          </span>
          <p className="text-slate-300 leading-relaxed font-normal">
            Every trade starts and ends in the base asset (USDT). The execution module checks that the final vault balance is strictly greater than the starting capital plus the required minimum profit threshold—otherwise, the entire transaction reverts and only network fees are incurred.
          </p>
        </div>
      </div>

      {/* Opportunities Table */}
      <div className="openui-card overflow-hidden">
        <div className="p-6 border-b border-white/10 flex items-center justify-between text-sm text-slate-400">
          <span className="font-bold text-white text-base">Detected Cycle Opportunities</span>
          <span className="font-mono text-xs">{opportunities.length} Total Logged</span>
        </div>

        {isLoading && opportunities.length === 0 ? (
          <div className="p-8 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-[#0e111a] rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : opportunities.length === 0 ? (
          <div className="p-16 text-center text-sm text-slate-400">
            No arbitrage opportunities logged for this vault yet. Opportunities discovered by the automated agent worker will appear here automatically.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {opportunities.map((opp) => (
              <div
                key={opp.id}
                className="p-5 hover:bg-white/5 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 text-sm font-mono"
              >
                {/* Route & Size */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <span className="font-extrabold text-white text-base">
                      ${parseFloat(opp.tradeAmount).toLocaleString()} USDT
                    </span>
                    <span className="text-slate-500 font-sans text-xs">cycle</span>
                    <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs sm:text-sm">
                      {Array.isArray(opp.route) ? (
                        opp.route.map((step, i) => {
                          const label =
                            typeof step === "string"
                              ? step.slice(0, 6)
                              : `${step.tokenIn.slice(0, 6)}➔${step.tokenOut.slice(0, 6)}`;
                          return (
                            <React.Fragment key={i}>
                              <span>{label}</span>
                              {i < opp.route.length - 1 && (
                                <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                              )}
                            </React.Fragment>
                          );
                        })
                      ) : (
                        <span>USDT Arbitrage Cycle</span>
                      )}
                    </div>
                  </div>
                  {opp.aiReason ? (
                    <div className="text-xs text-indigo-300 font-sans font-normal italic flex items-center gap-1.5">
                      <Zap className="w-3 h-3 text-indigo-400 shrink-0" />
                      <span>{opp.aiReason}</span>
                    </div>
                  ) : opp.reason ? (
                    <div className="text-xs text-slate-400 font-sans font-normal">{opp.reason}</div>
                  ) : null}
                </div>

                {/* Returns & Status */}
                <div className="flex items-center gap-8 shrink-0">
                  <div className="text-right">
                    <div className="text-emerald-400 font-bold text-base">
                      +{opp.estimatedProfit} USDT
                    </div>
                    <div className="text-xs text-slate-500 font-sans">
                      +{(opp.netProfitBps / 100).toFixed(2)}% net spread
                    </div>
                  </div>

                  <div>
                    {(opp.status === "confirmed" || opp.status === "COMPLETED") && (
                      <span className="px-3 py-1 rounded-full text-xs font-bold badge-emerald flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        CONFIRMED
                      </span>
                    )}
                    {(opp.status === "awaiting_approval" || opp.status === "PENDING") && (
                      <span className="px-3 py-1 rounded-full text-xs font-bold badge-amber flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        PENDING APPROVAL
                      </span>
                    )}
                    {(opp.status === "reverted" || opp.status === "CANCELLED") && (
                      <span className="px-3 py-1 rounded-full text-xs font-bold badge-rose flex items-center gap-1.5">
                        <XCircle className="w-3.5 h-3.5" />
                        REVERTED
                      </span>
                    )}
                    {opp.status === "sent" && (
                      <span className="px-3 py-1 rounded-full text-xs font-bold badge-brand flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5" />
                        SENT TO CHAIN
                      </span>
                    )}
                    {opp.status === "detected" && (
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-white/10 text-slate-300 flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5" />
                        DETECTED
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
