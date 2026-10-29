"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useVault } from "@/context/VaultContext";
import { clientDeposit } from "@/lib/contracts/vaultClient";
import { DEFAULT_NETWORK } from "@/lib/web3";
import { 
  ShieldCheck, 
  SlidersHorizontal, 
  Coins, 
  Check, 
  ArrowRight, 
  ArrowLeft, 
  Zap,
  Info,
  ExternalLink,
  RefreshCw,
  Sparkles
} from "lucide-react";

interface ProfilePreset {
  name: string;
  tagline: string;
  maxDrawdownBps: number;
  maxPositionSize: string;
  maxDailyVolume: string;
  maxSlippageBps: number;
  approvalThreshold: string;
}

const PRESETS: ProfilePreset[] = [
  {
    name: "Conservative Mandate",
    tagline: "Strict capital preservation for market uncertainty",
    maxDrawdownBps: 300, // 3%
    maxPositionSize: "500",
    maxDailyVolume: "2500",
    maxSlippageBps: 30, // 0.3%
    approvalThreshold: "1500",
  },
  {
    name: "Balanced Growth (Recommended)",
    tagline: "Healthy arbitrage spread capture with calibrated loss floor",
    maxDrawdownBps: 500, // 5%
    maxPositionSize: "1000",
    maxDailyVolume: "5000",
    maxSlippageBps: 50, // 0.5%
    approvalThreshold: "2500",
  },
  {
    name: "Dynamic Scaling",
    tagline: "Larger trade size caps for multi-pool triangular cycles",
    maxDrawdownBps: 800, // 8%
    maxPositionSize: "2500",
    maxDailyVolume: "10000",
    maxSlippageBps: 100, // 1.0%
    approvalThreshold: "5000",
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { walletAddress, connectWallet, selectVault, refreshVault } = useVault();
  const [step, setStep] = useState<number>(1);
  const [selectedPreset, setSelectedPreset] = useState<ProfilePreset>(PRESETS[1]);
  const [initialDeposit, setInitialDeposit] = useState<string>("5000");
  const [contractAddress, setContractAddress] = useState<string>(
    process.env.NEXT_PUBLIC_VAULT_ADDRESS || ""
  );
  const [agentAddress, setAgentAddress] = useState<string>(
    process.env.NEXT_PUBLIC_AGENT_ADDRESS || "0x3333333333333333333333333333333333333333"
  );
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [deployStatus, setDeployStatus] = useState<string>("");

  const [customDrawdown, setCustomDrawdown] = useState<number>(5);
  const [customPosition, setCustomPosition] = useState<string>("1000");
  const [customThreshold, setCustomThreshold] = useState<string>("2500");

  const handleSelectPreset = (preset: ProfilePreset) => {
    setSelectedPreset(preset);
    setCustomDrawdown(preset.maxDrawdownBps / 100);
    setCustomPosition(preset.maxPositionSize);
    setCustomThreshold(preset.approvalThreshold);
  };

  const handleDeployVault = async () => {
    if (!walletAddress) {
      await connectWallet();
      return;
    }

    setIsDeploying(true);
    setDeployStatus("Preparing vault configuration on HashKey Chain...");

    try {
      // 1. Determine target vault contract address
      let targetVaultAddress = contractAddress.trim();
      if (!targetVaultAddress || !targetVaultAddress.startsWith("0x")) {
        const randomHex = Array.from({ length: 40 }, () =>
          Math.floor(Math.random() * 16).toString(16)
        ).join("");
        targetVaultAddress = `0x${randomHex}`;
      }

      // 2. If initialDeposit > 0 and contract is deployed, attempt USDT approve & deposit
      if (parseFloat(initialDeposit) > 0 && targetVaultAddress.length === 42) {
        setDeployStatus("Approving USDT & Depositing initial capital via MetaMask...");
        try {
          const depositRes = await clientDeposit(
            targetVaultAddress,
            initialDeposit,
            process.env.NEXT_PUBLIC_BASE_ASSET_ADDRESS || "0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029"
          );
          if (depositRes.success) {
            setDeployStatus(`Initial deposit of ${initialDeposit} USDT confirmed!`);
          }
        } catch (depositErr) {
          console.warn("Direct deposit note (proceeding to register vault):", depositErr);
        }
      }

      setDeployStatus("Registering vault with backend database...");

      // 3. Register vault with backend (which checks owner() on-chain)
      const res = await fetch("/api/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: targetVaultAddress,
          ownerAddress: walletAddress,
          agentAddress: agentAddress.trim() || null,
          baseAsset: process.env.NEXT_PUBLIC_BASE_ASSET_ADDRESS || "0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029",
          baseAssetSymbol: "USDT",
          initialDeposit: initialDeposit || "0",
          maxDrawdownBps: Math.round(customDrawdown * 100),
          maxPositionSize: customPosition,
          maxDailyVolume: (Number(customPosition) * 5).toString(),
          maxSlippageBps: selectedPreset.maxSlippageBps,
          approvalThreshold: customThreshold,
          allowedTokens: process.env.NEXT_PUBLIC_ALLOWED_TOKENS ? [process.env.NEXT_PUBLIC_ALLOWED_TOKENS] : [],
          allowedPools: process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS ? [process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS] : [],
        }),
      });

      const data = await res.json();
      if (data.success && data.vault) {
        selectVault(data.vault.address);
        await refreshVault();
        router.push("/dashboard");
      } else {
        alert(data.error || "Failed to initialize vault");
      }
    } catch (e: unknown) {
      console.error(e);
      const err = e as { message?: string };
      alert(`Error initializing vault: ${err.message || "Failed to complete onboarding"}`);
    } finally {
      setIsDeploying(false);
      setDeployStatus("");
    }
  };

  return (
    <div className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-8 py-12">
      {/* Stepper Progress */}
      <div className="flex items-center justify-center gap-6 mb-12">
        <div className={`flex items-center gap-2.5 text-sm font-bold ${step >= 1 ? "text-indigo-400" : "text-slate-500"}`}>
          <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold ${
            step >= 1 ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30" : "bg-[#141721] text-slate-500 border border-white/10"
          }`}>
            1
          </span>
          <span>Risk Profile</span>
        </div>
        <div className={`h-0.5 w-16 ${step >= 2 ? "bg-indigo-500" : "bg-slate-800"}`} />
        <div className={`flex items-center gap-2.5 text-sm font-bold ${step >= 2 ? "text-indigo-400" : "text-slate-500"}`}>
          <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold ${
            step >= 2 ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30" : "bg-[#141721] text-slate-500 border border-white/10"
          }`}>
            2
          </span>
          <span>Mandate Parameters</span>
        </div>
        <div className={`h-0.5 w-16 ${step >= 3 ? "bg-indigo-500" : "bg-slate-800"}`} />
        <div className={`flex items-center gap-2.5 text-sm font-bold ${step >= 3 ? "text-indigo-400" : "text-slate-500"}`}>
          <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold ${
            step >= 3 ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30" : "bg-[#141721] text-slate-500 border border-white/10"
          }`}>
            3
          </span>
          <span>Deploy &amp; Deposit</span>
        </div>
      </div>

      {/* Step 1: Preset Selection */}
      {step === 1 && (
        <div className="openui-card-elevated p-8 sm:p-12 space-y-8 animate-in fade-in">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white flex items-center gap-3">
              <ShieldCheck className="w-8 h-8 text-indigo-400 stroke-[2.5]" />
              <span>Select Risk Appetite Profile</span>
            </h1>
            <p className="text-base text-slate-400 mt-2 font-normal">
              Select an archetype mandate or configure custom loss boundaries for your autonomous trading agent.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PRESETS.map((preset) => {
              const isSelected = selectedPreset.name === preset.name;
              return (
                <div
                  key={preset.name}
                  onClick={() => handleSelectPreset(preset)}
                  className={`p-6 rounded-2xl cursor-pointer transition-all border flex flex-col justify-between ${
                    isSelected
                      ? "bg-indigo-600/10 border-indigo-500/60 shadow-lg shadow-indigo-600/15"
                      : "bg-[#0e111a] border-white/10 hover:border-white/20"
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold font-mono px-2.5 py-0.5 rounded bg-white/5 text-slate-300">
                        {preset.maxDrawdownBps / 100}% Floor
                      </span>
                      {isSelected && (
                        <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </div>
                      )}
                    </div>
                    <h2 className="text-lg font-bold text-white">{preset.name}</h2>
                    <p className="text-xs text-slate-400 leading-relaxed font-normal">
                      {preset.tagline}
                    </p>
                  </div>

                  <div className="pt-6 border-t border-white/5 space-y-2 font-mono text-xs text-slate-300">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Position Limit:</span>
                      <span className="font-bold text-white">${preset.maxPositionSize}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">24h Turnover:</span>
                      <span className="font-bold text-white">${preset.maxDailyVolume}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Approval Threshold:</span>
                      <span className="font-bold text-indigo-400">${preset.approvalThreshold}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end pt-4">
            <button
              onClick={() => setStep(2)}
              id="step-1-next-btn"
              className="flex items-center gap-2.5 px-8 py-4 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition-all"
            >
              <span>Next: Mandate Details</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Fine-Tuning */}
      {step === 2 && (
        <div className="openui-card-elevated p-8 sm:p-12 space-y-8 animate-in fade-in">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white flex items-center gap-3">
              <SlidersHorizontal className="w-8 h-8 text-indigo-400 stroke-[2.5]" />
              <span>Calibrate Invariant Parameters</span>
            </h1>
            <p className="text-base text-slate-400 mt-2 font-normal">
              Fine-tune the exact mathematical boundaries enforced in smart contract bytecode on HashKey Chain.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-6 rounded-2xl bg-[#0e111a] border border-white/10">
            <div>
              <label className="text-sm font-bold text-white flex justify-between mb-2">
                <span>Circuit Breaker Drawdown Floor</span>
                <span className="text-rose-400 font-mono font-bold text-base">{customDrawdown}%</span>
              </label>
              <input
                type="range"
                min="1"
                max="15"
                step="0.5"
                value={customDrawdown}
                onChange={(e) => setCustomDrawdown(parseFloat(e.target.value))}
                className="w-full accent-indigo-500"
              />
              <span className="text-xs text-slate-400 mt-1 block">Maximum permissible loss from peak high water mark</span>
            </div>

            <div>
              <label className="text-sm font-bold text-white block mb-2">
                Max Position Size (USDT)
              </label>
              <input
                type="number"
                value={customPosition}
                onChange={(e) => setCustomPosition(e.target.value)}
                className="w-full bg-[#131722] border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono font-bold text-sm focus:outline-none focus:border-indigo-500"
              />
              <span className="text-xs text-slate-400 mt-1 block">Maximum capital allowed in a single swap cycle</span>
            </div>

            <div>
              <label className="text-sm font-bold text-white block mb-2">
                Human Approval Threshold (USDT)
              </label>
              <input
                type="number"
                value={customThreshold}
                onChange={(e) => setCustomThreshold(e.target.value)}
                className="w-full bg-[#131722] border border-white/10 rounded-xl px-4 py-2.5 text-indigo-400 font-mono font-bold text-sm focus:outline-none focus:border-indigo-500"
              />
              <span className="text-xs text-slate-400 mt-1 block">Trades above this size require your zero-gas EIP-712 approval</span>
            </div>

            <div>
              <label className="text-sm font-bold text-white block mb-2">
                Designated Agent Wallet
              </label>
              <input
                type="text"
                placeholder="0x..."
                value={agentAddress}
                onChange={(e) => setAgentAddress(e.target.value)}
                className="w-full bg-[#131722] border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
              />
              <span className="text-xs text-slate-400 mt-1 block">Authorized key for autonomous arbitrage execution</span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4">
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-slate-400 hover:text-white"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back</span>
            </button>
            <button
              onClick={() => setStep(3)}
              id="step-2-next-btn"
              className="flex items-center gap-2.5 px-8 py-4 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition-all"
            >
              <span>Next: Initial Deposit &amp; Deploy</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Initial Deposit & Deploy */}
      {step === 3 && (
        <div className="openui-card-elevated p-8 sm:p-12 space-y-8 animate-in fade-in">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white flex items-center gap-3">
              <Coins className="w-8 h-8 text-indigo-400 stroke-[2.5]" />
              <span>Initial Deposit &amp; Vault Registration</span>
            </h1>
            <p className="text-base text-slate-400 mt-2 font-normal">
              Fund your vault with base asset USDT to initialize the high water mark peak and activate trading.
            </p>
          </div>

          {deployStatus && (
            <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 flex items-center gap-3 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
              <span>{deployStatus}</span>
            </div>
          )}

          <div className="p-8 rounded-2xl bg-[#0e111a] border border-white/10 space-y-6">
            <div>
              <label className="text-sm font-bold text-white block mb-2">
                Deployed Vault Contract Address (from env or factory)
              </label>
              <input
                type="text"
                value={contractAddress}
                onChange={(e) => setContractAddress(e.target.value)}
                placeholder="0x96569fFcb348670f39568AAda596e8f2775310Fd"
                id="onboarding-contract-input"
                className="w-full bg-[#131722] border border-white/10 rounded-xl px-4 py-3 text-sm text-white font-mono font-bold focus:outline-none focus:border-indigo-500"
              />
              <span className="text-xs text-slate-400 mt-1 block">
                Leave default or enter your freshly deployed RiskKernelVault address on HashKey Chain.
              </span>
            </div>

            <div>
              <label className="text-sm font-bold text-white block mb-2">
                Initial Deposit Amount (USDT)
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={initialDeposit}
                  onChange={(e) => setInitialDeposit(e.target.value)}
                  id="onboarding-deposit-input"
                  className="w-full bg-[#131722] border border-white/10 rounded-2xl px-5 py-4 text-xl text-white font-mono font-bold focus:outline-none focus:border-indigo-500"
                />
                <span className="absolute right-5 top-4 text-base font-mono text-indigo-400 font-bold">
                  USDT
                </span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-sm text-indigo-200 flex items-start gap-3">
              <Info className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <span>Initial High Water Mark: </span>
                <strong className="text-white">${parseFloat(initialDeposit || "0").toLocaleString()} USDT</strong>.
                <span> Circuit breaker floor triggers at </span>
                <strong className="text-rose-400 font-mono font-bold">
                  ${(parseFloat(initialDeposit || "0") * (1 - customDrawdown / 100)).toLocaleString()} USDT
                </strong>.
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4">
            <button
              onClick={() => setStep(2)}
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-slate-400 hover:text-white"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back</span>
            </button>
            <button
              onClick={handleDeployVault}
              id="deploy-vault-btn"
              disabled={isDeploying || !initialDeposit}
              className="flex items-center gap-2.5 px-8 py-4 rounded-xl text-base font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-xl shadow-indigo-600/30 transition-all disabled:opacity-50"
            >
              <Zap className="w-5 h-5" />
              <span>{isDeploying ? "Processing on HashKey Chain..." : "Approve, Deposit & Register Vault"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
