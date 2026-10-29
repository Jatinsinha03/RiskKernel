"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useVault } from "@/context/VaultContext";
import { RiskGauge } from "@/components/RiskGauge";
import { QuickControls } from "@/components/QuickControls";
import { ActivityFeed } from "@/components/ActivityFeed";
import { formatAddress, getExplorerAddressUrl } from "@/lib/web3";
import { 
  ShieldCheck, 
  Clock, 
  ExternalLink, 
  CheckCircle, 
  XCircle, 
  SlidersHorizontal, 
  TrendingUp, 
  Sparkles, 
  AlertTriangle,
  ArrowRight,
  Plus
} from "lucide-react";

export default function DashboardPage() {
  const { selectedVault, metrics, refreshVault, network } = useVault();
  const [timeLeft, setTimeLeft] = useState<string>("");
  const [isApplying, setIsApplying] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // Timelock countdown timer for queued changes
  useEffect(() => {
    if (!selectedVault?.pendingPolicy?.unlockAt) {
      setTimeLeft("");
      return;
    }

    const interval = setInterval(() => {
      const unlockTime = new Date(selectedVault.pendingPolicy!.unlockAt).getTime();
      const now = Date.now();
      const diff = unlockTime - now;

      if (diff <= 0) {
        setTimeLeft("Ready to Apply");
      } else {
        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        setTimeLeft(`${minutes}m ${seconds}s remaining`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [selectedVault?.pendingPolicy?.unlockAt]);

  const handleCancelPending = async () => {
    if (!selectedVault) return;
    setIsCancelling(true);
    try {
      const res = await fetch(`/api/vaults/${selectedVault.address}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CANCEL_PENDING_POLICY" }),
      });
      if (res.ok) await refreshVault();
    } catch (e) {
      console.error(e);
    } finally {
      setIsCancelling(false);
    }
  };

  const handleApplyPending = async () => {
    if (!selectedVault) return;
    setIsApplying(true);
    try {
      const res = await fetch(`/api/vaults/${selectedVault.address}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "APPLY_PENDING_POLICY" }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to apply");
      } else {
        await refreshVault();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsApplying(false);
    }
  };

  if (!selectedVault) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center max-w-lg mx-auto">
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-6">
          <ShieldCheck className="w-8 h-8 text-indigo-400" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-3">No Active Vault Selected</h2>
        <p className="text-base text-slate-400 mb-8 leading-relaxed">
          Connect your MetaMask wallet or deploy a new deterministic risk vault on HashKey Chain.
        </p>
        <Link
          href="/onboarding"
          id="hero-onboarding-btn"
          className="flex items-center gap-2 px-8 py-3.5 rounded-xl text-base font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition-all"
        >
          <Plus className="w-5 h-5 stroke-[2.5]" />
          <span>Deploy New Vault</span>
        </Link>
      </div>
    );
  }

  const dailyVolume = parseFloat(selectedVault.dailyVolumeUsed) || 0;
  const maxVolume = parseFloat(selectedVault.maxDailyVolume) || 1;
  const volumeProgress = Math.min(100, (dailyVolume / maxVolume) * 100);

  return (
    <div className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-8 py-10 space-y-10">
      {/* Top Banner / Key Metrics */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-2">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              Vault Command Center
            </h1>
            <a
              href={getExplorerAddressUrl(selectedVault.address, network)}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-mono font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 bg-indigo-500/10 px-3 py-1.5 rounded-xl border border-indigo-500/20"
              title="View on HashKey Blockscout"
            >
              <span>{formatAddress(selectedVault.address, 4)}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
          <p className="text-sm text-slate-400 mt-2 font-normal">
            Deterministic circuit breaker active • Max autonomous position: <strong className="text-white">${parseFloat(selectedVault.maxPositionSize).toLocaleString()} {selectedVault.baseAssetSymbol}</strong>
          </p>
        </div>

        {/* Quick Nav Action Chips */}
        <div className="flex items-center gap-3">
          <Link
            href="/chat"
            id="copilot-shortcut-btn"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-[#131722] hover:bg-[#1a202e] text-slate-200 border border-white/10 transition-colors"
          >
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span>AI Copilot</span>
          </Link>
          <Link
            href="/policy"
            id="policy-shortcut-btn"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-[#131722] hover:bg-[#1a202e] text-slate-200 border border-white/10 transition-colors"
          >
            <SlidersHorizontal className="w-4 h-4 text-emerald-400" />
            <span>Edit Mandate</span>
          </Link>
        </div>
      </div>

      {/* Circuit Breaker & Risk Gauge */}
      <RiskGauge />

      {/* Queued Policy Change Banner (If Any Riskier Change is Pending) */}
      {selectedVault.pendingPolicy && (
        <div className="openui-card-warning p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30 shrink-0">
                <Clock className="w-6 h-6 animate-spin text-amber-400" style={{ animationDuration: "10s" }} />
              </div>
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2.5">
                  <span>Queued Mandate Modification (Timelock Active)</span>
                  <span className="text-xs font-bold px-2.5 py-0.5 rounded-full badge-amber">
                    {timeLeft || "Timelock Pending"}
                  </span>
                </h3>
                <p className="text-sm text-slate-300 mt-1">
                  Contains loosened parameters. Risk Kernel invariant requires an on-chain timelock before activation.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleCancelPending}
                id="dashboard-cancel-pending-btn"
                disabled={isCancelling}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 transition-colors"
              >
                <XCircle className="w-4 h-4" />
                <span>Cancel Change</span>
              </button>
              <button
                onClick={handleApplyPending}
                id="dashboard-apply-pending-btn"
                disabled={isApplying || timeLeft !== "Ready to Apply"}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 disabled:opacity-40 transition-all shadow-md shadow-amber-500/20"
              >
                <CheckCircle className="w-4 h-4" />
                <span>Apply After Delay</span>
              </button>
            </div>
          </div>

          {/* Diffs Preview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {selectedVault.pendingPolicy.diffs?.map((diff, i) => (
              <div key={i} className="p-4 rounded-xl bg-[#0e111a] border border-white/5 text-sm">
                <div className="text-slate-400 font-medium">{diff.label}</div>
                <div className="flex items-center gap-2 mt-2 font-mono">
                  <span className="text-slate-400 line-through">{String(diff.oldValue)}</span>
                  <ArrowRight className="w-4 h-4 text-slate-500" />
                  <span className="text-amber-400 font-bold">{String(diff.newValue)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily Volume & Agent Mandate Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 24h Traded Volume */}
        <div className="openui-card p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-sm mb-3">
              <span className="font-semibold text-slate-300">24h Turnover Volume</span>
              <span className="font-mono text-indigo-400 font-bold text-base">
                ${dailyVolume.toLocaleString()} / ${maxVolume.toLocaleString()}
              </span>
            </div>
            <div className="h-2.5 w-full bg-slate-900 rounded-full overflow-hidden p-0.5 border border-white/10 mb-4">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all"
                style={{ width: `${volumeProgress}%` }}
              />
            </div>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Resets every 24 hours. Prevents high-frequency rogue trading cascades.
          </p>
        </div>

        {/* Autonomous Agent Wallet */}
        <div className="openui-card p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="font-semibold text-slate-300">Autonomous Agent Key</span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold badge-emerald">
                Authorized
              </span>
            </div>
            <div className="font-mono text-sm text-white font-bold truncate py-2">
              {selectedVault.agentAddress ? formatAddress(selectedVault.agentAddress, 8) : "No agent granted"}
            </div>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Delegated key for HSKSwap cycles. Owner can revoke execution rights instantly.
          </p>
        </div>

        {/* Human-in-the-Loop Threshold */}
        <div className="openui-card p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="font-semibold text-slate-300">Human Approval Ceiling</span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold badge-brand">
                EIP-712 Active
              </span>
            </div>
            <div className="text-2xl font-extrabold text-white font-mono mt-1">
              {selectedVault.approvalThreshold === "Off" || selectedVault.approvalThreshold === "340282366920938463463374607431768211455"
                ? "Off"
                : `$${parseFloat(selectedVault.approvalThreshold).toLocaleString()} ${selectedVault.baseAssetSymbol}`}
            </div>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Trades above this cap pause for your typed signature in the Approval Inbox.
          </p>
        </div>
      </div>

      {/* Quick Controls & Safety */}
      <QuickControls />

      {/* Activity Feed */}
      <ActivityFeed />
    </div>
  );
}
