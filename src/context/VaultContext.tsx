"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { DEFAULT_NETWORK, switchOrAddNetwork, NetworkConfig } from "@/lib/web3";

export interface VaultData {
  id: string;
  address: string;
  ownerAddress: string;
  baseAsset: string;
  baseAssetSymbol: string;
  baseAssetDecimals: number;
  status: "ACTIVE" | "PAUSED" | "FROZEN";
  balance: string;
  peakValue: string;
  maxDrawdownBps: number;
  maxPositionSize: string;
  maxDailyVolume: string;
  dailyVolumeUsed: string;
  maxSlippageBps: number;
  approvalThreshold: string;
  agentAddress?: string | null;
  allowedTokens: string[];
  allowedPools: string[];
  allowedModules: string[];
  pendingPolicy?: {
    proposedAt: string;
    unlockAt: string;
    delaySeconds: number;
    diffs: Array<{
      field: string;
      label: string;
      oldValue: unknown;
      newValue: unknown;
      isSafer: boolean;
      reason: string;
    }>;
    proposed: Record<string, unknown>;
  } | null;
  events?: Array<{
    id: string;
    eventType: string;
    txHash: string;
    blockNumber: number;
    timestamp: string;
    details: Record<string, unknown>;
  }>;
}

export interface VaultMetrics {
  currentBalance: number;
  peak: number;
  drawdownAmount: number;
  drawdownPct: number;
  maxDrawdownPct: number;
  lossFloor: number;
  distanceToFloor: number;
  distanceToFloorPct: number;
  riskRatio: number;
  isBreakerTripped: boolean;
}

interface VaultContextType {
  walletAddress: string | null;
  isConnected: boolean;
  isAuthenticating: boolean;
  vaults: VaultData[];
  selectedVault: VaultData | null;
  metrics: VaultMetrics | null;
  isLoadingVault: boolean;
  network: NetworkConfig;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  selectVault: (address: string) => void;
  refreshVault: () => Promise<void>;
  switchNetwork: () => Promise<void>;
}

const VaultContext = createContext<VaultContextType | undefined>(undefined);

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [vaults, setVaults] = useState<VaultData[]>([]);
  const envVaultAddress = process.env.NEXT_PUBLIC_VAULT_ADDRESS?.toLowerCase() || null;
  const [selectedVaultAddress, setSelectedVaultAddress] = useState<string | null>(envVaultAddress);
  const [selectedVault, setSelectedVault] = useState<VaultData | null>(null);
  const [metrics, setMetrics] = useState<VaultMetrics | null>(null);
  const [isLoadingVault, setIsLoadingVault] = useState(false);
  const [network] = useState<NetworkConfig>(DEFAULT_NETWORK);

  // Fetch all vaults
  const fetchVaults = useCallback(async () => {
    try {
      const res = await fetch("/api/vaults");
      const data = await res.json();
      if (data.vaults && data.vaults.length > 0) {
        setVaults(data.vaults);
        const target = envVaultAddress
          ? data.vaults.find((v: VaultData) => v.address.toLowerCase() === envVaultAddress)
          : null;
        setSelectedVaultAddress((prev) => target ? target.address : (prev || data.vaults[0].address));
      }
    } catch (e) {
      console.error("Failed to fetch vaults:", e);
    }
  }, [envVaultAddress]);

  // Fetch details of active vault
  const refreshVault = useCallback(async () => {
    if (!selectedVaultAddress) return;
    setIsLoadingVault(true);
    try {
      const res = await fetch(`/api/vaults/${selectedVaultAddress}`);
      const data = await res.json();
      if (data.vault) {
        setSelectedVault(data.vault);
        setMetrics(data.metrics);
      }
    } catch (e) {
      console.error("Failed to load selected vault:", e);
    } finally {
      setIsLoadingVault(false);
    }
  }, [selectedVaultAddress]);

  // Check existing session
  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        if (data.authenticated && data.user) {
          setWalletAddress(data.user.address);
        }
      } catch (e) {
        console.error("Session check failed:", e);
      }
    };
    checkSession();
    fetchVaults();
  }, [fetchVaults]);

  useEffect(() => {
    if (selectedVaultAddress) {
      refreshVault();
    }
  }, [selectedVaultAddress, refreshVault]);

  // Helper to extract active or MetaMask provider in multi-wallet browser environments
  const getInjectedEthereum = (): ethers.Eip1193Provider | null => {
    if (typeof window === "undefined") return null;
    const raw = (window as unknown as { ethereum?: unknown }).ethereum;
    if (!raw) return null;
    const eth = raw as { providers?: (ethers.Eip1193Provider & { isMetaMask?: boolean })[] };
    if (Array.isArray(eth.providers) && eth.providers.length > 0) {
      const metaMask = eth.providers.find((p) => p.isMetaMask);
      return metaMask || eth.providers[0];
    }
    return raw as ethers.Eip1193Provider;
  };

  // Connect and authenticate with MetaMask
  const connectWallet = async () => {
    const ethereum = getInjectedEthereum();
    if (!ethereum) {
      alert("Please install MetaMask to use Risk Kernel on HashKey Chain.");
      return;
    }

    try {
      setIsAuthenticating(true);
      const accounts = (await ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];

      if (!accounts || accounts.length === 0) return;

      const userAddress = accounts[0].toLowerCase();

      // Ensure HashKey Chain
      try {
        await switchOrAddNetwork(network);
      } catch (netErr) {
        console.warn("Network switch warning:", netErr);
      }

      // 1. Get nonce challenge
      const nonceRes = await fetch(`/api/auth/nonce?address=${userAddress}`);
      const nonceData = await nonceRes.json();
      if (!nonceData.message) {
        throw new Error("Failed to receive authentication challenge");
      }

      // 2. Sign challenge in MetaMask
      const provider = new ethers.BrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(nonceData.message);

      // 3. Verify on server
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: userAddress, signature }),
      });

      const verifyData = await verifyRes.json();
      if (verifyData.success) {
        setWalletAddress(userAddress);
        await fetchVaults();
      } else {
        alert("Signature verification failed.");
      }
    } catch (err: unknown) {
      console.warn("Wallet connection status:", err);
      const errObj = err as { code?: number; message?: string };
      if (errObj.code === 4001) {
        // User rejected request in wallet popup
        return;
      }
      if (errObj.message?.includes("onMessage")) {
        alert("Wallet extension communication timed out or conflicting extension detected. Please unlock or refresh your wallet extension.");
      } else if (errObj.message) {
        alert("Wallet: " + errObj.message);
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const disconnectWallet = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setWalletAddress(null);
  };

  const selectVault = (address: string) => {
    setSelectedVaultAddress(address);
  };

  const switchNetworkHandler = async () => {
    await switchOrAddNetwork(network);
  };

  return (
    <VaultContext.Provider
      value={{
        walletAddress,
        isConnected: !!walletAddress,
        isAuthenticating,
        vaults,
        selectedVault,
        metrics,
        isLoadingVault,
        network,
        connectWallet,
        disconnectWallet,
        selectVault,
        refreshVault,
        switchNetwork: switchNetworkHandler,
      }}
    >
      {children}
    </VaultContext.Provider>
  );
}

export function useVault() {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error("useVault must be used within a VaultProvider");
  }
  return context;
}
