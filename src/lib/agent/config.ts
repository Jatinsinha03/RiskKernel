import { ethers } from "ethers";

export interface AgentConfig {
  chainId: number;
  rpcUrl: string;
  agentPrivateKey?: string;
  agentAddress?: string;
  baseAssetAddress: string;
  routerAddress: string;
  v3FactoryAddress: string;
  pollIntervalMs: number;
  sizeFractions: number[];
  minNetProfitUsdt: number;
  gasSafetyMultiplier: number;
  profitHaircutPct: number;
  maxGasPriceGwei: number;
  maxTradeUsdt: number;
  minAgentHsk: number;
  simulateOnly: boolean;
  aiMode: "select" | "explain_only";
  geminiApiKey?: string;
  geminiModel: string;
  killSwitchDefault: boolean;
}

export function loadAgentConfig(): AgentConfig {
  const chainId = Number(process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || "177");
  const rpcUrl = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.hsk.xyz";
  
  const baseAssetAddress = (
    process.env.BASE_ASSET ||
    process.env.NEXT_PUBLIC_BASE_ASSET_ADDRESS ||
    "0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029"
  ).toLowerCase();

  const routerAddress = (
    process.env.ROUTER ||
    process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS ||
    "0x56d15cF00b5D853D6eE4CbB1463E6DAD2899fBf5"
  ).toLowerCase();

  const v3FactoryAddress = (
    process.env.V3_FACTORY_ADDRESS ||
    process.env.V3_FACTORY ||
    "0x972cA9D1662F5e029cD18327D29026532E84c742"
  ).toLowerCase();

  const rawKey = process.env.AGENT_PRIVATE_KEY?.trim();
  let agentPrivateKey: string | undefined = undefined;
  let agentAddress: string | undefined = undefined;

  if (rawKey && rawKey.length >= 64) {
    try {
      const keyWithPrefix = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
      const wallet = new ethers.Wallet(keyWithPrefix);
      agentPrivateKey = keyWithPrefix;
      agentAddress = wallet.address.toLowerCase();
    } catch {
      console.warn("Invalid AGENT_PRIVATE_KEY provided, falling back to SIMULATE_ONLY mode.");
    }
  }

  const simulateOnly =
    process.env.SIMULATE_ONLY === "true" ||
    process.env.SIMULATE_ONLY === "1" ||
    !agentPrivateKey;

  const pollIntervalMs = Math.max(1000, Number(process.env.POLL_INTERVAL_MS || "4000"));
  const minNetProfitUsdt = Math.max(0.0001, Number(process.env.MIN_NET_PROFIT_USDT || "0.005"));
  const gasSafetyMultiplier = Math.max(1.0, Number(process.env.GAS_SAFETY_MULTIPLIER || "1.2"));
  const profitHaircutPct = Math.min(0.95, Math.max(0.1, Number(process.env.PROFIT_HAIRCUT_PCT || "0.70")));
  const maxGasPriceGwei = Number(process.env.MAX_GAS_PRICE_GWEI || "1000");
  const maxTradeUsdt = Math.max(0.1, Number(process.env.MAX_TRADE_USDT || "10.0"));
  const minAgentHsk = Number(process.env.MIN_AGENT_HSK || "0.01");

  const aiMode: "select" | "explain_only" =
    process.env.AI_MODE === "explain_only" ? "explain_only" : "select";

  const geminiApiKey = process.env.GEMINI_API_KEY || undefined;
  const geminiModel = process.env.GEMINI_MODEL || "gemini-1.5-flash";

  const killSwitchDefault = process.env.KILL_SWITCH_DEFAULT === "true";

  return {
    chainId,
    rpcUrl,
    agentPrivateKey,
    agentAddress,
    baseAssetAddress,
    routerAddress,
    v3FactoryAddress,
    pollIntervalMs,
    sizeFractions: [1.0, 0.5, 0.25, 0.1],
    minNetProfitUsdt,
    gasSafetyMultiplier,
    profitHaircutPct,
    maxGasPriceGwei,
    maxTradeUsdt,
    minAgentHsk,
    simulateOnly,
    aiMode,
    geminiApiKey,
    geminiModel,
    killSwitchDefault,
  };
}
