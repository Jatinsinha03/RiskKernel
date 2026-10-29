"use client";

import React, { useState } from "react";
import { useVault } from "@/context/VaultContext";
import { 
  clientDeposit, 
  clientWithdraw, 
  clientPause, 
  clientUnpause, 
  clientUnfreeze,
  clientRevokeAgent 
} from "@/lib/contracts/vaultClient";
import { getExplorerTxUrl } from "@/lib/web3";
import { 
  ArrowUpRight, 
  ArrowDownLeft, 
  Pause, 
  Play, 
  Flame, 
  ShieldCheck,
  X,
  Coins,
  RefreshCw,
  ExternalLink,
  UserX
} from "lucide-react";

export function QuickControls() {
  const { selectedVault, refreshVault, network } = useVault();
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [txNotice, setTxNotice] = useState<{ txHash?: string; message: string; isError?: boolean } | null>(null);

  if (!selectedVault) return null;

  const isFrozen = selectedVault.status === "FROZEN";
  const isPaused = selectedVault.status === "PAUSED";

  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    setIsProcessing(true);
    setTxNotice({ message: "Confirming USDT approval & deposit in MetaMask..." });

    try {
      // 1. MetaMask write
      const txRes = await clientDeposit(selectedVault.address, amount, selectedVault.baseAsset);
      if (!txRes.success || !txRes.txHash) {
        throw new Error(txRes.error || "Deposit transaction rejected or failed");
      }

      setTxNotice({
        txHash: txRes.txHash,
        message: `Successfully deposited ${amount} USDT on-chain!`,
      });

      // 2. Sync DB
      await fetch(`/api/vaults/${selectedVault.address}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DEPOSIT", amount, txHash: txRes.txHash }),
      });

      setIsDepositOpen(false);
      setAmount("");
      await refreshVault();
    } catch (e: unknown) {
      console.error(e);
      const err = e as { message?: string };
      setTxNotice({ isError: true, message: err.message || "Deposit transaction failed" });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    setIsProcessing(true);
    setTxNotice({ message: "Confirming withdraw in MetaMask..." });

    try {
      // 1. MetaMask write
      const txRes = await clientWithdraw(selectedVault.address, amount);
      if (!txRes.success || !txRes.txHash) {
        throw new Error(txRes.error || "Withdraw transaction rejected or failed");
      }

      setTxNotice({
        txHash: txRes.txHash,
        message: `Successfully withdrew ${amount} USDT!`,
      });

      // 2. Sync DB
      await fetch(`/api/vaults/${selectedVault.address}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "WITHDRAW", amount, txHash: txRes.txHash }),
      });

      setIsWithdrawOpen(false);
      setAmount("");
      await refreshVault();
    } catch (e: unknown) {
      console.error(e);
      const err = e as { message?: string };
      setTxNotice({ isError: true, message: err.message || "Withdraw transaction failed" });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTogglePause = async () => {
    setIsProcessing(true);
    const nextPaused = !isPaused;
    setTxNotice({ message: nextPaused ? "Sign pause in MetaMask..." : "Sign unpause in MetaMask..." });

    try {
      const txRes = nextPaused
        ? await clientPause(selectedVault.address)
        : await clientUnpause(selectedVault.address);

      if (!txRes.success || !txRes.txHash) {
        throw new Error(txRes.error || "Transaction cancelled or failed");
      }

      await fetch(`/api/vaults/${selectedVault.address}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SET_STATUS",
          status: nextPaused ? "PAUSED" : "ACTIVE",
          txHash: txRes.txHash,
        }),
      });

      setTxNotice({
        txHash: txRes.txHash,
        message: nextPaused ? "Vault successfully paused!" : "Vault unpaused!",
      });

      await refreshVault();
    } catch (e: unknown) {
      console.error(e);
      const err = e as { message?: string };
      setTxNotice({ isError: true, message: err.message || "Action failed" });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRevokeAgent = async () => {
    if (!confirm("Are you sure you want to revoke the trading agent? All autonomous trading will stop immediately.")) {
      return;
    }
    setIsProcessing(true);
    setTxNotice({ message: "Signing revokeAgent in MetaMask..." });

    try {
      const txRes = await clientRevokeAgent(selectedVault.address);
      if (!txRes.success || !txRes.txHash) {
        throw new Error(txRes.error || "Revoke agent transaction cancelled");
      }

      await fetch(`/api/vaults/${selectedVault.address}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REVOKE_AGENT", txHash: txRes.txHash }),
      });

      setTxNotice({
        txHash: txRes.txHash,
        message: "Trading agent revoked successfully on HashKey Chain!",
      });

      await refreshVault();
    } catch (e: unknown) {
      console.error(e);
      const err = e as { message?: string };
      setTxNotice({ isError: true, message: err.message || "Revoke failed" });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUnfreeze = async () => {
    setIsProcessing(true);
    setTxNotice({ message: "Signing unfreeze in MetaMask..." });

    try {
      const txRes = await clientUnfreeze(selectedVault.address);
      if (!txRes.success || !txRes.txHash) {
        throw new Error(txRes.error || "Unfreeze transaction cancelled");
      }

      await fetch(`/api/vaults/${selectedVault.address}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SET_STATUS", status: "ACTIVE", txHash: txRes.txHash }),
      });

      setTxNotice({
        txHash: txRes.txHash,
        message: "Vault unfrozen and high water mark reset to current balance!",
      });

      await refreshVault();
    } catch (e: unknown) {
      console.error(e);
      const err = e as { message?: string };
      setTxNotice({ isError: true, message: err.message || "Unfreeze failed" });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="openui-card p-6 sm:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Coins className="w-5 h-5 text-indigo-400" />
            <span>Vault &amp; Safety Controls</span>
          </h3>
          <p className="text-sm text-slate-400 mt-1">Direct owner transactions executed with MetaMask</p>
        </div>
      </div>

      {txNotice && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs font-medium ${
            txNotice.isError
              ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
              : "bg-indigo-500/10 border-indigo-500/30 text-indigo-300"
          }`}
        >
          <span>{txNotice.message}</span>
          {txNotice.txHash && (
            <a
              href={getExplorerTxUrl(txNotice.txHash, network)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 font-bold text-indigo-400 hover:underline"
            >
              <span>View Tx</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Deposit */}
        <button
          onClick={() => { setIsDepositOpen(true); setIsWithdrawOpen(false); }}
          id="btn-deposit-open"
          className="flex flex-col items-center justify-center p-5 rounded-2xl bg-[#0e111a] hover:bg-[#161a25] border border-white/5 hover:border-indigo-500/30 text-white transition-all group"
        >
          <div className="w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <ArrowUpRight className="w-6 h-6 stroke-[2.5]" />
          </div>
          <span className="text-sm font-bold">Deposit USDT</span>
          <span className="text-xs text-slate-400 mt-1">Increase capital</span>
        </button>

        {/* Withdraw */}
        <button
          onClick={() => { setIsWithdrawOpen(true); setIsDepositOpen(false); }}
          id="btn-withdraw-open"
          className="flex flex-col items-center justify-center p-5 rounded-2xl bg-[#0e111a] hover:bg-[#161a25] border border-white/5 hover:border-emerald-500/30 text-white transition-all group"
        >
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <ArrowDownLeft className="w-6 h-6 stroke-[2.5]" />
          </div>
          <span className="text-sm font-bold">Withdraw</span>
          <span className="text-xs text-slate-400 mt-1">Always available</span>
        </button>

        {/* Emergency Pause / Unpause */}
        <button
          onClick={handleTogglePause}
          disabled={isProcessing}
          id="btn-toggle-pause"
          className={`flex flex-col items-center justify-center p-5 rounded-2xl border transition-all group ${
            isPaused
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
              : "bg-[#0e111a] hover:bg-[#161a25] border-white/5 hover:border-amber-500/30 text-white"
          }`}
        >
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform ${
            isPaused ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/10 text-amber-400"
          }`}>
            {isPaused ? <Play className="w-6 h-6" /> : <Pause className="w-6 h-6" />}
          </div>
          <span className="text-sm font-bold">{isPaused ? "Resume Trading" : "Emergency Pause"}</span>
          <span className="text-xs text-slate-400 mt-1">{isPaused ? "Vault paused" : "Kill switch"}</span>
        </button>

        {/* Circuit Breaker Status / Unfreeze */}
        {isFrozen ? (
          <button
            onClick={handleUnfreeze}
            disabled={isProcessing}
            id="btn-unfreeze"
            className="flex flex-col items-center justify-center p-5 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 transition-all group"
          >
            <div className="w-12 h-12 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <ShieldCheck className="w-6 h-6 stroke-[2.5]" />
            </div>
            <span className="text-sm font-bold">Unfreeze Vault</span>
            <span className="text-xs text-rose-400/80 mt-1">Reset peak HWM</span>
          </button>
        ) : (
          <button
            onClick={handleRevokeAgent}
            disabled={isProcessing || !selectedVault.agentAddress}
            id="btn-revoke-agent"
            className="flex flex-col items-center justify-center p-5 rounded-2xl bg-[#0e111a] hover:bg-[#161a25] border border-white/5 hover:border-rose-500/30 text-white transition-all group disabled:opacity-40"
          >
            <div className="w-12 h-12 rounded-xl bg-rose-500/10 text-rose-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <UserX className="w-6 h-6 stroke-[2.5]" />
            </div>
            <span className="text-sm font-bold">Revoke Agent</span>
            <span className="text-xs text-slate-400 mt-1">Instant kill switch</span>
          </button>
        )}
      </div>

      {/* Deposit Inline Modal */}
      {isDepositOpen && (
        <div className="p-6 rounded-2xl bg-[#0e111a] border border-indigo-500/30 space-y-4 animate-in fade-in">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4 text-indigo-400" />
              <span>Deposit {selectedVault.baseAssetSymbol} to Vault</span>
            </h4>
            <button onClick={() => setIsDepositOpen(false)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-3">
            <input
              type="number"
              placeholder="Amount in USDT"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              id="input-deposit-amount"
              className="flex-1 bg-[#131722] border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={handleDeposit}
              disabled={isProcessing || !amount}
              id="btn-deposit-confirm"
              className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-all disabled:opacity-40"
            >
              {isProcessing ? "Confirming..." : "Deposit via MetaMask"}
            </button>
          </div>
        </div>
      )}

      {/* Withdraw Inline Modal */}
      {isWithdrawOpen && (
        <div className="p-6 rounded-2xl bg-[#0e111a] border border-emerald-500/30 space-y-4 animate-in fade-in">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
              <span>Withdraw {selectedVault.baseAssetSymbol} to Owner Wallet</span>
            </h4>
            <button onClick={() => setIsWithdrawOpen(false)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <input
                type="number"
                placeholder="Amount in USDT"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                id="input-withdraw-amount"
                className="w-full bg-[#131722] border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={() => setAmount(selectedVault.balance)}
                className="absolute right-2 top-2 text-xs font-mono font-bold text-indigo-400 hover:text-indigo-300 px-2 py-0.5 rounded bg-indigo-500/10"
              >
                Max
              </button>
            </div>
            <button
              onClick={handleWithdraw}
              disabled={isProcessing || !amount}
              id="btn-withdraw-confirm"
              className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-all disabled:opacity-40"
            >
              {isProcessing ? "Confirming..." : "Withdraw via MetaMask"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
