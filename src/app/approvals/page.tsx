"use client";

import React, { useState, useEffect } from "react";
import { useVault } from "@/context/VaultContext";
import { ethers } from "ethers";
import { formatAddress } from "@/lib/web3";
import { clientSignTradeApproval } from "@/lib/contracts/vaultClient";
import { 
  CheckCheck, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  TrendingUp, 
  ArrowRight,
  Lock,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  ExternalLink
} from "lucide-react";

interface ApprovalItem {
  id: string;
  vaultAddress: string;
  opportunityId?: string;
  tradeAmount: string;
  summary: string;
  expiry: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  signature?: string;
  nonce: string;
  opportunity?: {
    route: string[];
    estimatedProfit: string;
    netProfitBps: number;
    minProfit: string;
  };
  vault?: {
    baseAssetSymbol: string;
    approvalThreshold: string;
  };
}

export default function ApprovalsPage() {
  const { selectedVault, walletAddress, network } = useVault();
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [signStatus, setSignStatus] = useState<string | null>(null);

  const fetchApprovals = async () => {
    setIsLoading(true);
    try {
      const url = selectedVault
        ? `/api/approvals?vaultAddress=${selectedVault.address}`
        : "/api/approvals";
      const res = await fetch(url);
      const data = await res.json();
      if (data.approvals) {
        setApprovals(data.approvals);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchApprovals();
  }, [selectedVault?.address]);

  const handleApprove = async (approval: ApprovalItem) => {
    setIsProcessing(true);
    setSignStatus("Requesting EIP-712 typed signature from MetaMask (0 gas)...");

    try {
      const expirySec = Math.floor(new Date(approval.expiry).getTime() / 1000);
      const minReturn = (parseFloat(approval.tradeAmount) + parseFloat(approval.opportunity?.minProfit || "1")).toString();
      
      // Generate standard cycle hash from route or opportunity
      const routeStr = approval.opportunity?.route?.join("->") || "USDT->HSK->USDT";
      const cycleHash = ethers.keccak256(ethers.toUtf8Bytes(routeStr));

      // 1. Sign EIP-712 typed data matching RiskKernelVault.sol
      const signRes = await clientSignTradeApproval(
        network.chainId,
        approval.vaultAddress,
        {
          cycleHash,
          amountIn: approval.tradeAmount,
          minReturn,
          expiry: expirySec,
          nonce: approval.nonce || "1",
        }
      );

      setSignStatus("Saving authorized signature to database...");

      // 2. Submit signature to backend
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId: approval.id,
          action: "APPROVE",
          signature: signRes.signature,
          cycleHash: signRes.cycleHash,
          expiry: expirySec,
          signerAddress: walletAddress || "0xowner",
        }),
      });

      if (res.ok) {
        await fetchApprovals();
      } else {
        const errData = await res.json();
        alert(errData.error || "Failed to submit approval signature");
      }
    } catch (e: unknown) {
      console.error("Signature approval error:", e);
      const err = e as { message?: string };
      alert(`Signature error: ${err.message || "Failed to sign EIP-712 authorization"}`);
    } finally {
      setIsProcessing(false);
      setSignStatus(null);
    }
  };

  const handleReject = async (approvalId: string) => {
    setIsProcessing(true);
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId,
          action: "REJECT",
        }),
      });
      if (res.ok) {
        await fetchApprovals();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const pendingApprovals = approvals.filter((a) => a.status === "PENDING");
  const pastApprovals = approvals.filter((a) => a.status !== "PENDING");

  return (
    <div className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-8 py-10 space-y-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-2">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight flex items-center gap-3">
            <CheckCheck className="w-8 h-8 text-indigo-400 stroke-[2.5]" />
            <span>Human-in-the-Loop Approvals</span>
          </h1>
          <p className="text-sm text-slate-400 mt-2 font-normal">
            Phase 2: Zero-gas EIP-712 typed authorizations for trades exceeding your threshold
          </p>
        </div>

        <div className="p-3.5 rounded-2xl bg-[#0e111a] border border-white/10 flex items-center gap-4 text-xs font-mono self-start sm:self-auto">
          <div>
            <span className="text-slate-400 block">Approval Ceiling:</span>
            <span className="font-bold text-indigo-400 text-sm">
              {selectedVault?.approvalThreshold === "Off"
                ? "Off (Max uint128)"
                : `$${parseFloat(selectedVault?.approvalThreshold || "2500").toLocaleString()} ${selectedVault?.baseAssetSymbol || "USDT"}`}
            </span>
          </div>
        </div>
      </div>

      {signStatus && (
        <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 flex items-center gap-3 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
          <span>{signStatus}</span>
        </div>
      )}

      {/* Safety Invariant Notice */}
      <div className="p-6 rounded-2xl bg-[#0e111a] border border-white/5 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0 border border-indigo-500/20">
          <Lock className="w-5 h-5 stroke-[2.5]" />
        </div>
        <div className="text-sm leading-relaxed">
          <strong className="text-white block mb-1">Zero Gas Signature Protection</strong>
          <span className="text-slate-300 font-normal">
            When an arbitrage trade exceeds your mandate threshold, the autonomous agent cannot execute without your cryptographically signed EIP-712 approval. Your signature costs <strong>0 gas</strong> and is submitted on-chain by the worker.
          </span>
        </div>
      </div>

      {/* Pending Approvals Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>Pending Trade Authorizations</span>
            <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-mono font-bold">
              {pendingApprovals.length}
            </span>
          </h2>
        </div>

        {pendingApprovals.length === 0 ? (
          <div className="openui-card p-12 text-center text-slate-400 space-y-3">
            <ShieldCheck className="w-12 h-12 text-emerald-400 mx-auto stroke-[1.5]" />
            <div className="text-lg font-bold text-white">No Pending Approvals</div>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              All agent trades are currently within your configured automatic position size limits.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingApprovals.map((item) => (
              <div
                key={item.id}
                className="openui-card-elevated p-6 sm:p-8 space-y-6 border-indigo-500/30"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                        Approval Required
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        Expires: {new Date(item.expiry).toLocaleTimeString()}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-white mt-2">{item.summary}</h3>
                  </div>

                  <div className="text-right sm:self-center">
                    <span className="text-xs text-slate-400 font-mono block">Proposed Amount</span>
                    <span className="text-2xl font-extrabold text-white font-mono">
                      ${parseFloat(item.tradeAmount).toLocaleString()} {item.vault?.baseAssetSymbol || "USDT"}
                    </span>
                  </div>
                </div>

                {/* Opportunity Route Details */}
                {item.opportunity && (
                  <div className="p-4 rounded-xl bg-[#0b0d13] border border-white/5 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm font-mono">
                    <div>
                      <span className="text-xs text-slate-400 block mb-1">Route Path:</span>
                      <div className="flex items-center gap-1.5 text-indigo-400 font-bold">
                        {item.opportunity.route.map((t, idx) => (
                          <React.Fragment key={idx}>
                            <span>{t}</span>
                            {idx < item.opportunity!.route.length - 1 && (
                              <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>

                    <div>
                      <span className="text-xs text-slate-400 block mb-1">Estimated Gain:</span>
                      <span className="text-emerald-400 font-bold">
                        +${item.opportunity.estimatedProfit} ({item.opportunity.netProfitBps / 100}%)
                      </span>
                    </div>

                    <div>
                      <span className="text-xs text-slate-400 block mb-1">Guaranteed Floor:</span>
                      <span className="text-slate-300">
                        +${item.opportunity.minProfit} Min Profit
                      </span>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    onClick={() => handleReject(item.id)}
                    disabled={isProcessing}
                    id={`reject-approval-btn-${item.id}`}
                    className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold bg-white/5 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-white/10 hover:border-rose-500/30 transition-all disabled:opacity-40"
                  >
                    <XCircle className="w-4 h-4" />
                    <span>Reject</span>
                  </button>

                  <button
                    onClick={() => handleApprove(item)}
                    disabled={isProcessing}
                    id={`sign-approval-btn-${item.id}`}
                    className="flex items-center gap-2 px-7 py-3 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-40"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Sign EIP-712 (0 Gas)</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Historical Approvals */}
      {pastApprovals.length > 0 && (
        <div className="space-y-4 pt-6">
          <h2 className="text-lg font-bold text-slate-400">Past Approvals History</h2>
          <div className="openui-card divide-y divide-white/5">
            {pastApprovals.map((item) => (
              <div key={item.id} className="p-5 flex items-center justify-between text-sm">
                <div>
                  <div className="font-semibold text-white">{item.summary}</div>
                  <div className="text-xs text-slate-400 font-mono mt-1">
                    Amount: ${parseFloat(item.tradeAmount).toLocaleString()} • Nonce: {item.nonce}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs px-2.5 py-1 rounded-md font-bold font-mono ${
                      item.status === "APPROVED"
                        ? "badge-emerald"
                        : item.status === "REJECTED"
                        ? "badge-rose"
                        : "bg-white/5 text-slate-400"
                    }`}
                  >
                    {item.status}
                  </span>
                  {item.signature && (
                    <span className="text-xs text-slate-400 font-mono">
                      Signed: {formatAddress(item.signature, 6)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
