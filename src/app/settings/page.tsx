"use client";

import React, { useState } from "react";
import { useVault } from "@/context/VaultContext";
import { formatAddress, getExplorerTxUrl } from "@/lib/web3";
import {
  clientPause,
  clientUnpause,
  clientRevokeAgent,
  clientUnfreeze,
  clientWithdraw,
  clientRescueToken,
  TxResult
} from "@/lib/contracts/vaultClient";
import {
  Settings as SettingsIcon,
  Pause,
  Play,
  Flame,
  ShieldAlert,
  ArrowDownLeft,
  LifeBuoy,
  UserX,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Coins
} from "lucide-react";

export default function SettingsPage() {
  const { selectedVault, refreshVault, network } = useVault();
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [rescueTokenAddress, setRescueTokenAddress] = useState("");
  const [rescueRecipient, setRescueRecipient] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [txState, setTxState] = useState<{
    status: "idle" | "signing" | "confirming" | "success" | "error";
    action?: string;
    txHash?: string;
    message?: string;
  }>({ status: "idle" });

  if (!selectedVault) {
    return (
      <div className="flex-1 flex items-center justify-center p-12 text-slate-400 text-base">
        Please connect your MetaMask wallet or select an active vault from the navigation header.
      </div>
    );
  }

  const isFrozen = selectedVault.status === "FROZEN";
  const isPaused = selectedVault.status === "PAUSED";

  const executeMetaMaskAction = async (
    actionName: string,
    actionFn: () => Promise<TxResult>,
    backendSync?: () => Promise<void>
  ) => {
    setIsProcessing(true);
    setTxState({ status: "signing", action: actionName, message: `Please confirm ${actionName} in MetaMask...` });

    try {
      const res = await actionFn();
      if (!res.success || !res.txHash) {
        throw new Error(res.error || `MetaMask rejected ${actionName}`);
      }

      setTxState({
        status: "confirming",
        action: actionName,
        txHash: res.txHash,
        message: `Transaction submitted! Confirming on HashKey Chain...`,
      });

      if (backendSync) {
        await backendSync();
      }

      setTxState({
        status: "success",
        action: actionName,
        txHash: res.txHash,
        message: `${actionName} confirmed successfully on-chain!`,
      });

      await refreshVault();
    } catch (e: unknown) {
      console.error(e);
      const err = e as { message?: string };
      setTxState({
        status: "error",
        action: actionName,
        message: err.message || `${actionName} failed`,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTogglePause = async () => {
    const nextPaused = !isPaused;
    await executeMetaMaskAction(
      nextPaused ? "Emergency Pause" : "Unpause Vault",
      () => (nextPaused ? clientPause(selectedVault.address) : clientUnpause(selectedVault.address)),
      async () => {
        await fetch(`/api/vaults/${selectedVault.address}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "SET_STATUS", status: nextPaused ? "PAUSED" : "ACTIVE" }),
        });
      }
    );
  };

  const handleUnfreeze = async () => {
    await executeMetaMaskAction(
      "Unfreeze Circuit Breaker",
      () => clientUnfreeze(selectedVault.address),
      async () => {
        await fetch(`/api/vaults/${selectedVault.address}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "SET_STATUS", status: "ACTIVE" }),
        });
      }
    );
  };

  const handleRevokeAgent = async () => {
    if (!confirm("Are you sure you want to revoke the trading agent? All autonomous trading will stop immediately.")) {
      return;
    }
    await executeMetaMaskAction(
      "Revoke Agent",
      () => clientRevokeAgent(selectedVault.address),
      async () => {
        await fetch(`/api/vaults/${selectedVault.address}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "REVOKE_AGENT" }),
        });
      }
    );
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) return;
    await executeMetaMaskAction(
      `Withdraw ${withdrawAmount} USDT`,
      () => clientWithdraw(selectedVault.address, withdrawAmount),
      async () => {
        await fetch(`/api/vaults/${selectedVault.address}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "WITHDRAW", amount: withdrawAmount }),
        });
        setWithdrawAmount("");
      }
    );
  };

  const handleRescueToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rescueTokenAddress || !rescueRecipient) return;
    await executeMetaMaskAction(
      "Rescue Mistaken Token",
      () => clientRescueToken(selectedVault.address, rescueTokenAddress, rescueRecipient),
      async () => {
        setRescueTokenAddress("");
        setRescueRecipient("");
      }
    );
  };

  return (
    <div className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-8 py-10 space-y-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-2">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight flex items-center gap-3">
            <SettingsIcon className="w-8 h-8 text-indigo-400 stroke-[2.5]" />
            <span>Vault Settings &amp; Owner Controls</span>
          </h1>
          <p className="text-sm text-slate-400 mt-2 font-normal">
            MetaMask owner transactions: pause, unfreeze, agent revocation, withdrawals, and token rescue
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto font-mono text-xs">
          <span className="text-slate-400">Owner Wallet:</span>
          <span className="font-bold text-white bg-white/5 px-2.5 py-1 rounded-lg border border-white/10">
            {formatAddress(selectedVault.ownerAddress)}
          </span>
        </div>
      </div>

      {/* Transaction status alert */}
      {txState.status !== "idle" && (
        <div
          className={`p-4 rounded-2xl border flex items-center justify-between gap-4 ${
            txState.status === "error"
              ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
              : txState.status === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : "bg-indigo-500/10 border-indigo-500/30 text-indigo-300"
          }`}
        >
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

      {/* Live State Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="openui-card p-6">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">Vault Status</span>
          <div className="flex items-center gap-3">
            <span className={`w-3 h-3 rounded-full ${isFrozen ? "bg-rose-500 animate-ping" : isPaused ? "bg-amber-400" : "bg-emerald-400"}`} />
            <span className="text-2xl font-extrabold text-white font-mono">{selectedVault.status}</span>
          </div>
          <span className="text-xs text-slate-400 mt-2 block">
            {isFrozen ? "Circuit breaker tripped" : isPaused ? "Agent execution paused" : "All systems normal"}
          </span>
        </div>

        <div className="openui-card p-6">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">Authorized Agent</span>
          <div className="text-lg font-bold text-white font-mono">
            {selectedVault.agentAddress ? formatAddress(selectedVault.agentAddress) : "None (Revoked)"}
          </div>
          <span className="text-xs text-slate-400 mt-2 block">Authorized to execute bounded arbitrage</span>
        </div>

        <div className="openui-card p-6">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">Vault Balance</span>
          <div className="text-2xl font-extrabold text-emerald-400 font-mono">
            ${parseFloat(selectedVault.balance).toLocaleString()} {selectedVault.baseAssetSymbol}
          </div>
          <span className="text-xs text-slate-400 mt-2 block">Peak HWM: ${parseFloat(selectedVault.peakValue).toLocaleString()}</span>
        </div>
      </div>

      {/* Action Panels */}
      <div className="space-y-6">
        {/* Panel 1: Emergency Pause / Resume */}
        <div className="openui-card-elevated p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Pause className="w-5 h-5 text-amber-400" />
              <span>Kill Switch: Pause Autonomous Agent</span>
            </h3>
            <p className="text-sm text-slate-400 mt-1 max-w-xl font-normal leading-relaxed">
              Instantly blocks the agent from executing any transactions on HashKey Chain. Funds remain 100% safe and withdrawable by the owner.
            </p>
          </div>
          <button
            onClick={handleTogglePause}
            disabled={isProcessing}
            id="settings-pause-toggle-btn"
            className={`px-6 py-3.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 shrink-0 ${
              isPaused
                ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30"
                : "bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/30"
            }`}
          >
            {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            <span>{isPaused ? "Unpause Vault" : "Emergency Pause"}</span>
          </button>
        </div>

        {/* Panel 2: Reset Circuit Breaker (Unfreeze) */}
        {isFrozen && (
          <div className="openui-card-elevated p-6 sm:p-8 border-rose-500/40 bg-rose-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div>
              <h3 className="text-lg font-bold text-rose-300 flex items-center gap-2">
                <Flame className="w-5 h-5 text-rose-400" />
                <span>Reset Circuit Breaker (Unfreeze)</span>
              </h3>
              <p className="text-sm text-slate-300 mt-1 max-w-xl font-normal leading-relaxed">
                The vault is currently frozen. Unfreezing resets the high water mark peak to the current balance and resumes active trading.
              </p>
            </div>
            <button
              onClick={handleUnfreeze}
              disabled={isProcessing}
              id="settings-unfreeze-btn"
              className="px-6 py-3.5 rounded-xl text-sm font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition-all flex items-center gap-2 shrink-0"
            >
              <ShieldAlert className="w-4 h-4" />
              <span>Unfreeze &amp; Reset Peak</span>
            </button>
          </div>
        )}

        {/* Panel 3: Revoke Trading Agent */}
        <div className="openui-card-elevated p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <UserX className="w-5 h-5 text-rose-400" />
              <span>Revoke Agent Key</span>
            </h3>
            <p className="text-sm text-slate-400 mt-1 max-w-xl font-normal leading-relaxed">
              Instantly strips trading authority from the current agent address. To grant a new agent, propose an update through the Policy Card.
            </p>
          </div>
          <button
            onClick={handleRevokeAgent}
            disabled={isProcessing || !selectedVault.agentAddress}
            id="settings-revoke-agent-btn"
            className="px-6 py-3.5 rounded-xl text-sm font-bold bg-white/5 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-white/10 hover:border-rose-500/30 transition-all flex items-center gap-2 shrink-0 disabled:opacity-40"
          >
            <UserX className="w-4 h-4" />
            <span>Revoke Agent</span>
          </button>
        </div>

        {/* Panel 4: Withdraw Base Asset USDT */}
        <div className="openui-card-elevated p-6 sm:p-8 space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <ArrowDownLeft className="w-5 h-5 text-emerald-400" />
            <span>Withdraw Base Asset ({selectedVault.baseAssetSymbol})</span>
          </h3>
          <p className="text-sm text-slate-400 font-normal">
            Withdraw funds directly to your owner wallet. Withdrawals are always allowed, even when frozen.
          </p>

          <form onSubmit={handleWithdraw} className="flex flex-col sm:flex-row items-center gap-4 pt-2">
            <div className="relative flex-1 w-full">
              <input
                type="number"
                step="any"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="Amount in USDT"
                className="w-full bg-[#0e111a] border border-white/10 rounded-xl px-4 py-3 text-white font-mono font-bold text-sm focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={() => setWithdrawAmount(selectedVault.balance)}
                className="absolute right-3 top-2.5 text-xs font-mono font-bold text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded bg-indigo-500/10"
              >
                Max
              </button>
            </div>
            <button
              type="submit"
              disabled={isProcessing || !withdrawAmount}
              id="settings-withdraw-btn"
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 transition-all disabled:opacity-40"
            >
              Sign &amp; Withdraw
            </button>
          </form>
        </div>

        {/* Panel 5: Rescue Mistaken Token */}
        <div className="openui-card-elevated p-6 sm:p-8 space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-indigo-400" />
            <span>Rescue Mistaken Token (rescueToken)</span>
          </h3>
          <p className="text-sm text-slate-400 font-normal leading-relaxed">
            Recover any ERC20 token that was mistakenly sent to this vault contract. Base asset USDT is strictly protected and cannot be rescued through this method.
          </p>

          <form onSubmit={handleRescueToken} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1.5">ERC20 Token Contract Address</label>
                <input
                  type="text"
                  placeholder="0x..."
                  value={rescueTokenAddress}
                  onChange={(e) => setRescueTokenAddress(e.target.value)}
                  className="w-full bg-[#0e111a] border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1.5">Recipient Address</label>
                <input
                  type="text"
                  placeholder="0x..."
                  value={rescueRecipient}
                  onChange={(e) => setRescueRecipient(e.target.value)}
                  className="w-full bg-[#0e111a] border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isProcessing || !rescueTokenAddress || !rescueRecipient}
                id="settings-rescue-btn"
                className="px-7 py-3 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-40"
              >
                Rescue Token via MetaMask
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
