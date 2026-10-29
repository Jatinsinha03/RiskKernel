"use client";

import React, { useState, useEffect, useRef } from "react";
import { useVault } from "@/context/VaultContext";
import { PolicyDiffCard } from "@/components/PolicyDiffCard";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { PolicyEvaluation } from "@/lib/policy";
import { clientSubmitPolicy } from "@/lib/contracts/vaultClient";
import { PolicyChangeStruct, APPROVAL_DISABLED } from "@/lib/contracts/vaultContract";
import { getExplorerTxUrl } from "@/lib/web3";
import { 
  Bot, 
  User, 
  Send, 
  Sparkles, 
  ShieldCheck, 
  ArrowRight, 
  AlertCircle,
  ExternalLink,
  CheckCircle2,
  RefreshCw
} from "lucide-react";

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  diffData?: {
    evaluation: PolicyEvaluation;
    proposedPolicy: Record<string, unknown>;
  } | null;
  txHash?: string;
  createdAt?: string;
}

const SUGGESTIONS = [
  "Be more conservative",
  "What is my loss floor?",
  "Tighten drawdown to 3%",
  "Withdraw everything",
  "Loosen position cap to 20 USDT",
];

export default function ChatPage() {
  const { selectedVault, walletAddress, refreshVault, network } = useVault();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: `Hello! I am your **Risk Kernel AI Copilot** on HashKey Chain.
I have read-only access to your on-chain mandate and live balance. By smart contract design, I cannot move funds directly.

You can ask me to evaluate market conditions, explain your circuit breaker, or draft a policy update by saying **"Be more conservative"** or **"Tighten drawdown"**.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmittingDiff, setIsSubmittingDiff] = useState(false);
  const [diffTxStatus, setDiffTxStatus] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    async function loadHistory() {
      if (!selectedVault?.address && !walletAddress) return;
      try {
        const query = new URLSearchParams();
        if (selectedVault?.address) query.set("vaultAddress", selectedVault.address);
        if (walletAddress) query.set("userAddress", walletAddress);
        const res = await fetch(`/api/chat?${query.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (data.messages && data.messages.length > 0) {
            setMessages(data.messages);
          }
        }
      } catch (err) {
        console.warn("Could not load chat history:", err);
      }
    }
    loadHistory();
  }, [selectedVault?.address, walletAddress]);

  const handleSend = async (messageText?: string) => {
    const textToSend = messageText || input;
    if (!textToSend.trim() || isLoading) return;

    setInput("");
    const userMsg: Message = { role: "user", content: textToSend };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSend,
          vaultAddress: selectedVault?.address,
          userAddress: walletAddress,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: data.id,
            role: "assistant",
            content: data.content,
            diffData: data.diffData,
            createdAt: data.createdAt,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Sorry, I encountered an issue accessing vault state. Please try again.",
          },
        ]);
      }
    } catch (e) {
      console.error(e);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Network error communicating with copilot endpoint.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmDiff = async (diffData: {
    evaluation: PolicyEvaluation;
    proposedPolicy: Record<string, unknown>;
  }) => {
    if (!selectedVault) return;
    setIsSubmittingDiff(true);
    setDiffTxStatus("Confirming policy change in MetaMask...");

    try {
      const proposed = diffData.proposedPolicy;

      // Construct Solidity struct
      const thresholdVal = proposed.approvalThreshold === "Off"
        ? APPROVAL_DISABLED
        : String(proposed.approvalThreshold || selectedVault.approvalThreshold);

      const policyStruct: PolicyChangeStruct = {
        mandate: {
          maxDrawdownBps: Number(proposed.maxDrawdownBps || selectedVault.maxDrawdownBps),
          maxSlippageBps: Number(proposed.maxSlippageBps || selectedVault.maxSlippageBps),
          maxPositionSize: String(proposed.maxPositionSize || selectedVault.maxPositionSize),
          maxDailyVolume: String(proposed.maxDailyVolume || selectedVault.maxDailyVolume),
          approvalThreshold: thresholdVal,
        },
        addTokens: [],
        removeTokens: [],
        addRouters: [],
        removeRouters: [],
        newAgent: (proposed.agentAddress as string) || "0x0000000000000000000000000000000000000000",
      };

      // 1. Submit transaction via MetaMask to HashKey Chain contract
      const txRes = await clientSubmitPolicy(selectedVault.address, policyStruct);
      if (!txRes.success || !txRes.txHash) {
        throw new Error(txRes.error || "MetaMask transaction failed or was rejected");
      }

      setDiffTxStatus("Synchronizing with backend database...");

      // 2. Sync to backend API
      const res = await fetch(`/api/vaults/${selectedVault.address}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SUBMIT_POLICY",
          txHash: txRes.txHash,
          proposedPolicy: diffData.proposedPolicy,
        }),
      });

      const data = await res.json();
      await refreshVault();

      const isInstant = diffData.evaluation.isSaferOverall;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: isInstant
            ? `✅ **Mandate successfully updated!** The safer rules have been applied immediately on HashKey Chain.\n\nTransaction: \`${txRes.txHash}\``
            : `⏳ **Mandate update queued in timelock!** Because the policy contains riskier changes, it has been placed behind the contract timelock delay. You can review or cancel it from the dashboard or Policy Card.\n\nTransaction: \`${txRes.txHash}\``,
          txHash: txRes.txHash,
        },
      ]);
    } catch (e: unknown) {
      console.error(e);
      const err = e as { message?: string };
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `❌ **Transaction failed:** ${err.message || "Failed to submit policy transaction to HashKey Chain."}`,
        },
      ]);
    } finally {
      setIsSubmittingDiff(false);
      setDiffTxStatus(null);
    }
  };

  return (
    <div className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-8 py-10 flex flex-col h-[calc(100vh-80px)]">
      {/* Header */}
      <div className="flex items-center justify-between pb-6 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
            <Sparkles className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-white flex items-center gap-2.5">
              <span>Risk Kernel AI Copilot</span>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full badge-brand">
                Gemini Powered
              </span>
            </h1>
            <p className="text-sm text-slate-400 mt-0.5 font-normal">
              Deterministic tool calling • Read-only analysis &amp; MetaMask signed diff proposals
            </p>
          </div>
        </div>

        {selectedVault && (
          <div className="text-right hidden sm:block">
            <div className="text-xs text-slate-400 font-mono">Vault {selectedVault.baseAssetSymbol}</div>
            <div className="text-base font-bold text-emerald-400 font-mono">
              ${parseFloat(selectedVault.balance).toLocaleString()}
            </div>
          </div>
        )}
      </div>

      {/* Chat Messages Log */}
      <div className="flex-1 overflow-y-auto py-8 space-y-6 pr-2">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center shrink-0 mt-1">
                <Bot className="w-5 h-5 stroke-[2.5]" />
              </div>
            )}

            <div
              className={`max-w-[85%] rounded-3xl p-5 text-sm sm:text-base leading-relaxed space-y-4 ${
                msg.role === "user"
                  ? "bg-indigo-600 text-white font-medium shadow-lg shadow-indigo-600/20"
                  : "openui-card text-slate-200 border-white/10"
              }`}
            >
              {msg.role === "assistant" ? (
                <MarkdownRenderer content={msg.content} />
              ) : (
                <div className="whitespace-pre-wrap">{msg.content}</div>
              )}

              {msg.txHash && (
                <div className="pt-2">
                  <a
                    href={getExplorerTxUrl(msg.txHash, network)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-xs font-bold text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 px-3.5 py-2 rounded-xl border border-indigo-500/20"
                  >
                    <span>View on HashKey Explorer</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}

              {/* Render PolicyDiffCard if response generated one */}
              {msg.diffData?.evaluation && !msg.txHash && (
                <div className="pt-3">
                  <PolicyDiffCard
                    evaluation={msg.diffData.evaluation}
                    onConfirm={() => handleConfirmDiff(msg.diffData!)}
                    isSubmitting={isSubmittingDiff}
                  />
                  {diffTxStatus && (
                    <div className="mt-3 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center gap-2 text-xs text-indigo-300">
                      <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                      <span>{diffTxStatus}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {msg.role === "user" && (
              <div className="w-10 h-10 rounded-2xl bg-[#141721] text-slate-300 border border-white/10 flex items-center justify-center shrink-0 mt-1">
                <User className="w-5 h-5" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-4 items-center text-sm text-slate-400">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center shrink-0 animate-pulse">
              <Bot className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div className="p-4 rounded-2xl openui-card text-slate-300 flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-indigo-400 animate-spin" />
              <span>Analyzing mandate parameters on HashKey Chain...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Quick Prompts */}
      <div className="pt-2 pb-4 shrink-0 flex items-center gap-2 overflow-x-auto">
        <span className="text-xs text-slate-400 font-bold uppercase tracking-wider shrink-0 mr-1">Suggestions:</span>
        {SUGGESTIONS.map((s, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(s)}
            id={`suggestion-btn-${idx}`}
            className="text-xs px-4 py-2 rounded-xl bg-[#141721] hover:bg-[#1c2130] text-slate-300 hover:text-white border border-white/10 whitespace-nowrap transition-colors font-medium"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Input Box */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="flex items-center gap-3 shrink-0 pt-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask copilot to tighten drawdown, inspect floor, or propose signed policy diff..."
          id="chat-input"
          className="flex-1 bg-[#131722] border border-white/10 rounded-2xl px-5 py-4 text-base text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-medium"
        />
        <button
          type="submit"
          id="chat-submit-btn"
          disabled={!input.trim() || isLoading}
          className="px-6 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold transition-all shadow-lg shadow-indigo-600/25 flex items-center justify-center shrink-0"
        >
          <Send className="w-5 h-5" />
        </button>
      </form>
    </div>
  );
}
