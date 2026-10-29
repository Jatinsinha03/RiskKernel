"use client";

import React from "react";
import { useVault } from "@/context/VaultContext";
import { ShieldAlert, AlertCircle, CheckCircle2, PauseCircle, Lock, TrendingUp } from "lucide-react";

export function RiskGauge() {
  const { selectedVault, metrics, refreshVault } = useVault();

  if (!selectedVault || !metrics) {
    return (
      <div className="openui-card p-8 animate-pulse">
        <div className="h-6 bg-slate-800 rounded w-1/4 mb-4"></div>
        <div className="h-12 bg-slate-800 rounded mb-2"></div>
      </div>
    );
  }

  const isFrozen = selectedVault.status === "FROZEN" || metrics.isBreakerTripped;
  const isPaused = selectedVault.status === "PAUSED";
  const isActive = selectedVault.status === "ACTIVE" && !isFrozen;

  // Percentage of allowable drawdown consumed (0% = at peak, 100% = floor reached)
  const drawdownConsumedPct = Math.min(100, Math.max(0, (metrics.drawdownPct / (metrics.maxDrawdownPct || 1)) * 100));

  const handleUnfreeze = async () => {
    try {
      const res = await fetch(`/api/vaults/${selectedVault.address}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SET_STATUS", status: "ACTIVE" }),
      });
      if (res.ok) await refreshVault();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className={`transition-all ${isFrozen ? "openui-card-danger" : "openui-card-elevated"} p-6 sm:p-8 relative overflow-hidden`}>
      {/* Header & Status Indicator */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl sm:text-2xl font-extrabold text-white">
              Deterministic Circuit Breaker &amp; Loss Floor
            </h2>
            {/* Status Badge */}
            {isFrozen ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold badge-rose">
                <ShieldAlert className="w-4 h-4" />
                CIRCUIT BREAKER FROZEN
              </span>
            ) : isPaused ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold badge-amber">
                <PauseCircle className="w-4 h-4" />
                AGENT PAUSED
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold badge-emerald">
                <CheckCircle2 className="w-4 h-4" />
                ACTIVE INVARIANT
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-1.5 font-normal">
            Continuous balance monitor enforcing base-asset loss bounds on HashKey Chain
          </p>
        </div>

        {/* Unfreeze Action if Frozen */}
        {isFrozen && (
          <button
            onClick={handleUnfreeze}
            id="unfreeze-vault-btn"
            className="px-5 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-rose-500 to-amber-500 text-slate-950 shadow-lg shadow-rose-500/25 hover:opacity-90 transition-opacity"
          >
            Reset Loss Floor &amp; Unfreeze
          </button>
        )}
      </div>

      {/* Frozen Alert Banner */}
      {isFrozen && (
        <div className="mb-8 p-5 rounded-2xl bg-rose-950/70 border border-rose-500/40 text-sm text-rose-200 flex items-start gap-3.5">
          <AlertCircle className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-white text-base">Deterministic Safety Invariant Tripped:</span>
            <p className="mt-1 text-rose-200/90 leading-relaxed font-normal">
              Portfolio value dropped to the {metrics.maxDrawdownPct}% drawdown floor. In accordance with the smart contract mandate, all agent trading execution has been immediately frozen on-chain. Capital is preserved in {selectedVault.baseAssetSymbol}. You may withdraw 100% of remaining funds anytime or reset the loss floor.
            </p>
          </div>
        </div>
      )}

      {/* Main Metrics Row with large bold numbers */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="p-5 rounded-2xl bg-[#0e111a] border border-white/5">
          <span className="text-xs uppercase font-semibold tracking-wider text-slate-400">Current Balance</span>
          <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono mt-2">
            ${metrics.currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <span className="text-xs text-indigo-400 font-mono font-medium">{selectedVault.baseAssetSymbol}</span>
        </div>

        <div className="p-5 rounded-2xl bg-[#0e111a] border border-white/5">
          <span className="text-xs uppercase font-semibold tracking-wider text-slate-400">Peak Portfolio Value</span>
          <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono mt-2 flex items-center gap-2">
            ${metrics.peak.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <span className="text-xs text-slate-500">High Water Mark</span>
        </div>

        <div className="p-5 rounded-2xl bg-[#0e111a] border border-white/5">
          <span className="text-xs uppercase font-semibold tracking-wider text-slate-400">Loss Floor (Circuit Breaker)</span>
          <div className="text-2xl sm:text-3xl font-extrabold text-rose-400 font-mono mt-2 flex items-center gap-2">
            ${metrics.lossFloor.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <Lock className="w-4 h-4 text-rose-400/80" />
          </div>
          <span className="text-xs text-slate-500">{metrics.maxDrawdownPct}% Max Drawdown</span>
        </div>

        <div className="p-5 rounded-2xl bg-[#0e111a] border border-white/5">
          <span className="text-xs uppercase font-semibold tracking-wider text-slate-400">Distance to Freeze</span>
          <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono mt-2">
            ${metrics.distanceToFloor.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <span className="text-xs text-slate-500 font-mono">({metrics.distanceToFloorPct}% of capital remaining)</span>
        </div>
      </div>

      {/* Visual Risk Gauge Meter */}
      <div className="p-5 rounded-2xl bg-[#0e111a] border border-white/5">
        <div className="flex items-center justify-between text-sm mb-3">
          <div className="flex items-center gap-2 font-medium">
            <span className="font-bold text-white">Risk Budget Meter</span>
            <span className="text-slate-500">•</span>
            <span className="text-slate-300">
              Drawdown: <strong className="text-white">{metrics.drawdownPct}%</strong> of {metrics.maxDrawdownPct}% limit
            </span>
          </div>
          <span className={`font-mono font-bold text-sm ${
            drawdownConsumedPct > 80 ? "text-rose-400" : drawdownConsumedPct > 40 ? "text-amber-400" : "text-emerald-400"
          }`}>
            {drawdownConsumedPct.toFixed(1)}% of Risk Budget Consumed
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-4 w-full bg-slate-900 rounded-full overflow-hidden p-0.5 border border-white/10 relative mb-3">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              drawdownConsumedPct > 80
                ? "bg-rose-500 shadow-md shadow-rose-500/50"
                : drawdownConsumedPct > 40
                ? "bg-amber-500"
                : "bg-emerald-500"
            }`}
            style={{ width: `${Math.max(3, drawdownConsumedPct)}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-xs text-slate-400 font-mono font-medium">
          <span>0.0% (Safe Peak)</span>
          <span>Warning Threshold ({(metrics.maxDrawdownPct * 0.75).toFixed(1)}%)</span>
          <span className="text-rose-400 font-bold">{metrics.maxDrawdownPct.toFixed(1)}% (Smart Contract Freeze)</span>
        </div>
      </div>
    </div>
  );
}
