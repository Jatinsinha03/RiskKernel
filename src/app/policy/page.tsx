"use client";

import React, { useState, useEffect } from "react";
import { useVault } from "@/context/VaultContext";
import { PolicyDiffCard } from "@/components/PolicyDiffCard";
import { evaluatePolicyChange, PolicyEvaluation } from "@/lib/policy";
import { formatAddress, getExplorerTxUrl } from "@/lib/web3";
import { 
  clientSubmitPolicy, 
  clientApplyQueuedPolicy, 
  clientCancelQueuedPolicy, 
  checkIsPolicyLooserOnChain,
  TxResult 
} from "@/lib/contracts/vaultClient";
import { PolicyChangeStruct, APPROVAL_DISABLED } from "@/lib/contracts/vaultContract";
import { 
  SlidersHorizontal, 
  ShieldCheck, 
  Clock, 
  Key, 
  CheckCircle2, 
  AlertTriangle,
  ExternalLink,
  Ban,
  Check,
  RefreshCw
} from "lucide-react";

export default function PolicyPage() {
  const { selectedVault, refreshVault, network } = useVault();
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txState, setTxState] = useState<{
    status: "idle" | "signing" | "confirming" | "success" | "error";
    txHash?: string;
    message?: string;
  }>({ status: "idle" });

  // Form states
  const [drawdownPct, setDrawdownPct] = useState<number>(selectedVault ? selectedVault.maxDrawdownBps / 100 : 5);
  const [positionSize, setPositionSize] = useState<string>(selectedVault?.maxPositionSize || "1000");
  const [dailyVolume, setDailyVolume] = useState<string>(selectedVault?.maxDailyVolume || "5000");
  const [slippagePct, setSlippagePct] = useState<number>(selectedVault ? selectedVault.maxSlippageBps / 100 : 0.5);
  const [threshold, setThreshold] = useState<string>(selectedVault?.approvalThreshold || "2500");
  const [isApprovalDisabled, setIsApprovalDisabled] = useState<boolean>(selectedVault?.approvalThreshold === "Off");
  const [agentAddress, setAgentAddress] = useState<string>(selectedVault?.agentAddress || "");

  // Evaluation diff preview
  const [previewEvaluation, setPreviewEvaluation] = useState<PolicyEvaluation | null>(null);
  const [isOnChainLooser, setIsOnChainLooser] = useState<boolean | null>(null);

  // Sync form when vault loads
  useEffect(() => {
    if (selectedVault) {
      setDrawdownPct(selectedVault.maxDrawdownBps / 100);
      setPositionSize(selectedVault.maxPositionSize);
      setDailyVolume(selectedVault.maxDailyVolume);
      setSlippagePct(selectedVault.maxSlippageBps / 100);
      setThreshold(selectedVault.approvalThreshold === "Off" ? "10000" : selectedVault.approvalThreshold);
      setIsApprovalDisabled(selectedVault.approvalThreshold === "Off");
      setAgentAddress(selectedVault.agentAddress || "");
    }
  }, [selectedVault]);

  if (!selectedVault) {
    return (
      <div className="flex-1 flex items-center justify-center p-12 text-slate-400 text-base">
        Please connect your MetaMask wallet or select an active vault from the navigation header.
      </div>
    );
  }

  const buildPolicyStruct = (): PolicyChangeStruct => {
    const finalThreshold = isApprovalDisabled ? APPROVAL_DISABLED : threshold;
    return {
      mandate: {
        maxDrawdownBps: Math.round(drawdownPct * 100),
        maxSlippageBps: Math.round(slippagePct * 100),
        maxPositionSize: positionSize,
        maxDailyVolume: dailyVolume,
        approvalThreshold: finalThreshold,
      },
      addTokens: [],
      removeTokens: [],
      addRouters: [],
      removeRouters: [],
      newAgent: agentAddress || "0x0000000000000000000000000000000000000000",
    };
  };

  const handlePreviewDiff = async (e: React.FormEvent) => {
    e.preventDefault();

    const evaluation = evaluatePolicyChange(
      {
        maxDrawdownBps: selectedVault.maxDrawdownBps,
        maxPositionSize: selectedVault.maxPositionSize,
        maxDailyVolume: selectedVault.maxDailyVolume,
        maxSlippageBps: selectedVault.maxSlippageBps,
        approvalThreshold: selectedVault.approvalThreshold,
        agentAddress: selectedVault.agentAddress,
      },
      {
        maxDrawdownBps: Math.round(drawdownPct * 100),
        maxPositionSize: positionSize,
        maxDailyVolume: dailyVolume,
        maxSlippageBps: Math.round(slippagePct * 100),
        approvalThreshold: isApprovalDisabled ? "Off" : threshold,
        agentAddress: agentAddress || null,
      }
    );

    setPreviewEvaluation(evaluation);

    // Call on-chain view function isPolicyLooser if possible
    try {
      const struct = buildPolicyStruct();
      const looser = await checkIsPolicyLooserOnChain(selectedVault.address, struct);
      setIsOnChainLooser(looser);
    } catch {
      setIsOnChainLooser(!evaluation.isSaferOverall);
    }
  };

  const handleConfirmSubmit = async () => {
    if (!previewEvaluation) return;
    setIsSubmitting(true);
    setTxState({ status: "signing", message: "Please sign the transaction in MetaMask..." });

    try {
      const policyStruct = buildPolicyStruct();

      // 1. Send MetaMask smart contract write transaction
      setTxState({ status: "confirming", message: "Confirming submitPolicy on HashKey Chain..." });
      const txRes: TxResult = await clientSubmitPolicy(selectedVault.address, policyStruct);

      if (!txRes.success || !txRes.txHash) {
        throw new Error(txRes.error || "MetaMask transaction rejected or failed");
      }

      setTxState({
        status: "success",
        txHash: txRes.txHash,
        message: "Policy transaction confirmed on HashKey Chain!",
      });

      // 2. Synchronize with backend database & record activity event
      await fetch(`/api/vaults/${selectedVault.address}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SUBMIT_POLICY",
          txHash: txRes.txHash,
          proposedPolicy: {
            maxDrawdownBps: Math.round(drawdownPct * 100),
            maxPositionSize: positionSize,
            maxDailyVolume: dailyVolume,
            maxSlippageBps: Math.round(slippagePct * 100),
            approvalThreshold: isApprovalDisabled ? "Off" : threshold,
            agentAddress: agentAddress || null,
          },
        }),
      });

      setPreviewEvaluation(null);
      setIsEditing(false);
      await refreshVault();
    } catch (e: unknown) {
      console.error(e);
      const err = e as { message?: string };
      setTxState({
        status: "error",
        message: err.message || "Failed to submit policy transaction to HashKey Chain",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApplyQueued = async () => {
    if (!selectedVault.pendingPolicy) return;
    setIsSubmitting(true);
    setTxState({ status: "signing", message: "Sign applyQueuedPolicy in MetaMask..." });

    try {
      const proposed = selectedVault.pendingPolicy.proposed as Record<string, unknown>;
      const policyStruct: PolicyChangeStruct = {
        mandate: {
          maxDrawdownBps: Number(proposed.maxDrawdownBps || selectedVault.maxDrawdownBps),
          maxSlippageBps: Number(proposed.maxSlippageBps || selectedVault.maxSlippageBps),
          maxPositionSize: String(proposed.maxPositionSize || selectedVault.maxPositionSize),
          maxDailyVolume: String(proposed.maxDailyVolume || selectedVault.maxDailyVolume),
          approvalThreshold: String(proposed.approvalThreshold || selectedVault.approvalThreshold),
        },
        addTokens: [],
        removeTokens: [],
        addRouters: [],
        removeRouters: [],
        newAgent: (proposed.agentAddress as string) || "0x0000000000000000000000000000000000000000",
      };

      const res = await clientApplyQueuedPolicy(selectedVault.address, policyStruct);
      if (!res.success || !res.txHash) throw new Error(res.error || "Failed to apply queued policy");

      setTxState({
        status: "success",
        txHash: res.txHash,
        message: "Queued policy activated successfully!",
      });

      await fetch(`/api/vaults/${selectedVault.address}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "APPLY_QUEUED", txHash: res.txHash }),
      });

      await refreshVault();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setTxState({ status: "error", message: e.message || "Transaction failed" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelQueued = async () => {
    setIsSubmitting(true);
    setTxState({ status: "signing", message: "Sign cancelQueuedPolicy in MetaMask..." });

    try {
      const res = await clientCancelQueuedPolicy(selectedVault.address);
      if (!res.success || !res.txHash) throw new Error(res.error || "Failed to cancel queued policy");

      setTxState({
        status: "success",
        txHash: res.txHash,
        message: "Pending policy cancelled and purged from queue.",
      });

      await fetch(`/api/vaults/${selectedVault.address}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CANCEL_QUEUED", txHash: res.txHash }),
      });

      await refreshVault();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setTxState({ status: "error", message: e.message || "Cancel failed" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isPendingReady =
    selectedVault.pendingPolicy &&
    new Date(selectedVault.pendingPolicy.unlockAt).getTime() <= Date.now();

  return (
    <div className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-8 py-10 space-y-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-2">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight flex items-center gap-3">
            <SlidersHorizontal className="w-8 h-8 text-indigo-400 stroke-[2.5]" />
            <span>Policy Mandate Card</span>
          </h1>
          <p className="text-sm text-slate-400 mt-2 font-normal">
            Directional invariants enforced directly in smart contract bytecode on HashKey Chain
          </p>
        </div>

        <button
          onClick={() => {
            setIsEditing(!isEditing);
            setPreviewEvaluation(null);
            setTxState({ status: "idle" });
          }}
          id="toggle-edit-policy-btn"
          className="px-5 py-3 rounded-xl text-sm font-bold bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 transition-all self-start sm:self-auto"
        >
          {isEditing ? "Close Form" : "Propose Mandate Modification"}
        </button>
      </div>

      {/* Transaction status banner */}
      {txState.status !== "idle" && (
        <div className={`p-4 rounded-2xl border flex items-center justify-between gap-4 ${
          txState.status === "error"
            ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
            : txState.status === "success"
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
            : "bg-indigo-500/10 border-indigo-500/30 text-indigo-300"
        }`}>
          <div className="flex items-center gap-3">
            {txState.status === "error" ? (
              <AlertTriangle className="w-5 h-5 shrink-0" />
            ) : txState.status === "success" ? (
              <CheckCircle2 className="w-5 h-5 shrink-0" />
            ) : (
              <RefreshCw className="w-5 h-5 shrink-0 animate-spin" />
            )}
            <span className="text-sm font-medium">{txState.message}</span>
          </div>
          {txState.txHash && (
            <a
              href={getExplorerTxUrl(txState.txHash, network)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-mono font-bold hover:underline"
            >
              <span>Explorer</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}

      {/* Pending Timelock Banner */}
      {selectedVault.pendingPolicy && (
        <div className="openui-card-elevated p-6 sm:p-8 border-amber-500/30 bg-amber-500/5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Clock className="w-6 h-6 text-amber-400 shrink-0" />
              <div>
                <h3 className="text-base font-bold text-white">Queued Riskier Policy In Timelock</h3>
                <p className="text-xs text-amber-300/80 mt-0.5">
                  Unlock ETA: {new Date(selectedVault.pendingPolicy.unlockAt).toLocaleString()}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleCancelQueued}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10"
              >
                Cancel Queued Change
              </button>
              <button
                onClick={handleApplyQueued}
                disabled={isSubmitting || !isPendingReady}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold disabled:opacity-40"
              >
                {isPendingReady ? "Apply Queued Policy Now" : "Locked (ETA Pending)"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Directional Safety Explainer Box */}
      <div className="p-6 rounded-2xl bg-[#0e111a] border border-white/5 grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
        <div className="flex items-start gap-3.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20">
            <ShieldCheck className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <span className="font-bold text-white block text-base mb-1">Instant Safer Changes</span>
            <span className="text-slate-300 leading-relaxed font-normal">
              Tightening drawdown, lowering position size caps, reducing turnover, or revoking the agent wallet applies immediately on-chain upon owner confirmation.
            </span>
          </div>
        </div>
        <div className="flex items-start gap-3.5">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/20">
            <Clock className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <span className="font-bold text-white block text-base mb-1">Timelocked Riskier Changes</span>
            <span className="text-slate-300 leading-relaxed font-normal">
              Loosening limits, increasing trade sizes, or granting new agent keys is placed behind an on-chain timelock delay that the owner can review or cancel anytime.
            </span>
          </div>
        </div>
      </div>

      {/* Edit Form with Live Preview */}
      {isEditing && (
        <form onSubmit={handlePreviewDiff} className="openui-card-elevated p-8 space-y-8 animate-in fade-in">
          <div className="flex items-center justify-between border-b border-white/10 pb-5">
            <div>
              <h2 className="text-xl font-bold text-white">Configure Mandate Parameters</h2>
              <p className="text-xs text-slate-400 mt-1">Review directional classification before submitting</p>
            </div>
            <span className="text-xs text-slate-400 font-mono font-bold bg-white/5 px-3 py-1.5 rounded-lg border border-white/10">
              Vault {formatAddress(selectedVault.address)}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Max Drawdown */}
            <div>
              <label className="text-sm font-bold text-slate-200 block mb-2 flex items-center justify-between">
                <span>Max Drawdown Floor</span>
                <span className="text-rose-400 font-mono font-bold text-base">{drawdownPct}%</span>
              </label>
              <input
                type="range"
                min="1"
                max="15"
                step="0.5"
                value={drawdownPct}
                onChange={(e) => setDrawdownPct(parseFloat(e.target.value))}
                className="w-full accent-indigo-500 cursor-pointer"
              />
              <span className="text-xs text-slate-400 mt-1 block">Current: {(selectedVault.maxDrawdownBps / 100).toFixed(1)}%</span>
            </div>

            {/* Max Position Size */}
            <div>
              <label className="text-sm font-bold text-slate-200 block mb-2">
                Max Position Size (USDT)
              </label>
              <input
                type="number"
                value={positionSize}
                onChange={(e) => setPositionSize(e.target.value)}
                className="w-full bg-[#0e111a] border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono font-bold text-sm focus:outline-none focus:border-indigo-500"
              />
              <span className="text-xs text-slate-400 mt-1 block">Current: {selectedVault.maxPositionSize} USDT</span>
            </div>

            {/* Daily Turnover */}
            <div>
              <label className="text-sm font-bold text-slate-200 block mb-2">
                Max Daily Turnover (USDT)
              </label>
              <input
                type="number"
                value={dailyVolume}
                onChange={(e) => setDailyVolume(e.target.value)}
                className="w-full bg-[#0e111a] border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono font-bold text-sm focus:outline-none focus:border-indigo-500"
              />
              <span className="text-xs text-slate-400 mt-1 block">Current: {selectedVault.maxDailyVolume} USDT</span>
            </div>

            {/* Max Slippage */}
            <div>
              <label className="text-sm font-bold text-slate-200 block mb-2 flex items-center justify-between">
                <span>Max Slippage Limit</span>
                <span className="text-amber-400 font-mono font-bold text-base">{slippagePct}%</span>
              </label>
              <input
                type="range"
                min="0.1"
                max="2.0"
                step="0.1"
                value={slippagePct}
                onChange={(e) => setSlippagePct(parseFloat(e.target.value))}
                className="w-full accent-indigo-500 cursor-pointer"
              />
              <span className="text-xs text-slate-400 mt-1 block">Current: {(selectedVault.maxSlippageBps / 100).toFixed(2)}%</span>
            </div>

            {/* Human Approval Threshold */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-bold text-slate-200">Approval Threshold</label>
                <button
                  type="button"
                  onClick={() => setIsApprovalDisabled(!isApprovalDisabled)}
                  className={`text-xs px-2 py-0.5 rounded font-bold transition-all ${
                    isApprovalDisabled
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      : "bg-white/10 text-slate-400 hover:text-white"
                  }`}
                >
                  {isApprovalDisabled ? "Disabled (Off)" : "Set Off"}
                </button>
              </div>
              <input
                type="text"
                disabled={isApprovalDisabled}
                value={isApprovalDisabled ? "Off (Max uint128)" : threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className={`w-full bg-[#0e111a] border border-white/10 rounded-xl px-4 py-2.5 font-mono font-bold text-sm focus:outline-none focus:border-indigo-500 ${
                  isApprovalDisabled ? "text-slate-500 cursor-not-allowed" : "text-white"
                }`}
              />
              <span className="text-xs text-slate-400 mt-1 block">Current: {selectedVault.approvalThreshold}</span>
            </div>

            {/* Agent Address */}
            <div>
              <label className="text-sm font-bold text-slate-200 block mb-2">
                Trading Agent Address
              </label>
              <input
                type="text"
                value={agentAddress}
                placeholder="0x..."
                onChange={(e) => setAgentAddress(e.target.value)}
                className="w-full bg-[#0e111a] border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-indigo-500"
              />
              <span className="text-xs text-slate-400 mt-1 block">
                {selectedVault.agentAddress ? formatAddress(selectedVault.agentAddress) : "No agent assigned"}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-4 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                setPreviewEvaluation(null);
              }}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              id="preview-policy-diff-btn"
              className="px-7 py-3 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition-all"
            >
              Preview Signed Diff
            </button>
          </div>
        </form>
      )}

      {/* Diff Card Preview */}
      {previewEvaluation && (
        <div className="space-y-6">
          <PolicyDiffCard
            evaluation={previewEvaluation}
            onConfirm={handleConfirmSubmit}
            onCancel={() => setPreviewEvaluation(null)}
            isSubmitting={isSubmitting}
          />
        </div>
      )}

      {/* Active Rules Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Drawdown */}
        <div className="openui-card p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">Max Drawdown</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full badge-emerald font-bold">
                Down = Safer
              </span>
            </div>
            <div className="text-3xl font-extrabold text-white font-mono">
              {(selectedVault.maxDrawdownBps / 100).toFixed(1)}%
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-4 leading-relaxed">
            Circuit breaker trips immediately if portfolio drops this percentage from high water mark peak.
          </p>
        </div>

        {/* Trade Size Cap */}
        <div className="openui-card p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">Max Position Size</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full badge-emerald font-bold">
                Down = Safer
              </span>
            </div>
            <div className="text-3xl font-extrabold text-white font-mono">
              ${parseFloat(selectedVault.maxPositionSize).toLocaleString()} {selectedVault.baseAssetSymbol}
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-4 leading-relaxed">
            The largest single arbitrage trade the autonomous agent is allowed to execute on HSKSwap.
          </p>
        </div>

        {/* Daily Volume Cap */}
        <div className="openui-card p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">24h Turnover Cap</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full badge-emerald font-bold">
                Down = Safer
              </span>
            </div>
            <div className="text-3xl font-extrabold text-white font-mono">
              ${parseFloat(selectedVault.maxDailyVolume).toLocaleString()} {selectedVault.baseAssetSymbol}
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-4 leading-relaxed">
            Cumulative 24-hour volume ceiling preventing runaway slippage or capital drain.
          </p>
        </div>

        {/* Max Slippage */}
        <div className="openui-card p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">Max Slippage Tolerance</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full badge-emerald font-bold">
                Down = Safer
              </span>
            </div>
            <div className="text-3xl font-extrabold text-white font-mono">
              {(selectedVault.maxSlippageBps / 100).toFixed(2)}%
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-4 leading-relaxed">
            Strict slippage parameter checked on each hop of the swap cycle.
          </p>
        </div>

        {/* Approval Threshold */}
        <div className="openui-card p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">Human Approval Ceiling</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full badge-emerald font-bold">
                Down = Safer
              </span>
            </div>
            <div className="text-3xl font-extrabold text-indigo-400 font-mono">
              {selectedVault.approvalThreshold === "Off"
                ? "Off"
                : `$${parseFloat(selectedVault.approvalThreshold).toLocaleString()} ${selectedVault.baseAssetSymbol}`}
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-4 leading-relaxed">
            Trades above this size trigger a pending authorization requiring your zero-gas EIP-712 signature.
          </p>
        </div>

        {/* Allowed Venues & Tokens */}
        <div className="openui-card p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">Allowed Tokens &amp; Venues</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full badge-emerald font-bold">
                Removal = Safer
              </span>
            </div>
            <div className="space-y-1.5 font-mono text-xs font-bold text-white">
              <div>Tokens: {selectedVault.allowedTokens.length > 0 ? selectedVault.allowedTokens.map((t) => formatAddress(t)).join(", ") : (process.env.NEXT_PUBLIC_ALLOWED_TOKENS ? formatAddress(process.env.NEXT_PUBLIC_ALLOWED_TOKENS) : "None registered")}</div>
              <div>Router: {selectedVault.allowedPools.length > 0 ? selectedVault.allowedPools.map((p) => formatAddress(p)).join(", ") : (process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS ? formatAddress(process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS) : "None registered")}</div>
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-4 leading-relaxed">
            Arbitrage cycles are mathematically barred from touching disallowed assets or unauthorized routers.
          </p>
        </div>
      </div>
    </div>
  );
}
