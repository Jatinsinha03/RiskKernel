import { ethers } from "ethers";
import { RISK_KERNEL_VAULT_ABI, ERC20_ABI, APPROVAL_DISABLED } from "./RiskKernelVaultABI";
import { DEFAULT_NETWORK } from "../web3";

export { APPROVAL_DISABLED };

export interface VaultMandate {
  maxDrawdownBps: number;
  maxSlippageBps: number;
  maxPositionSize: string;
  maxDailyVolume: string;
  approvalThreshold: string;
}

export interface PolicyChangeStruct {
  mandate: VaultMandate;
  addTokens: string[];
  removeTokens: string[];
  addRouters: string[];
  removeRouters: string[];
  newAgent: string;
}

export interface OnChainVaultSummary {
  vaultAddress: string;
  owner: string;
  baseAsset: string;
  baseAssetSymbol: string;
  baseAssetDecimals: number;
  agent: string;
  paused: boolean;
  frozen: boolean;
  highWaterMark: string;
  balance: string;
  lossFloor: string;
  currentDrawdownBps: number;
  volumeRemainingToday: string;
  policyDelay: number;
  allowLossTolerantCycles: boolean;
  pendingPolicyHash: string;
  pendingPolicyEta: number;
  mandate: VaultMandate;
  isApprovalOff: boolean;
  // Human readable display values (6 decimals for USDT)
  balanceFormatted: string;
  peakFormatted: string;
  lossFloorFormatted: string;
  maxDrawdownPct: string;
  maxPositionFormatted: string;
  maxDailyVolumeFormatted: string;
  approvalThresholdFormatted: string;
  volumeRemainingFormatted: string;
}

export function getRpcProvider(): ethers.JsonRpcProvider {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || DEFAULT_NETWORK.rpcUrl;
  return new ethers.JsonRpcProvider(rpcUrl);
}

export function getVaultContract(
  vaultAddress: string,
  runner?: ethers.ContractRunner
): ethers.Contract {
  const providerOrSigner = runner || getRpcProvider();
  return new ethers.Contract(vaultAddress, RISK_KERNEL_VAULT_ABI, providerOrSigner);
}

export function getERC20Contract(
  tokenAddress: string,
  runner?: ethers.ContractRunner
): ethers.Contract {
  const providerOrSigner = runner || getRpcProvider();
  return new ethers.Contract(tokenAddress, ERC20_ABI, providerOrSigner);
}

/**
 * Format base asset amount (USDT uses 6 decimals)
 */
export function formatBaseUnits(amountWei: bigint | string, decimals = 6): string {
  try {
    const str = typeof amountWei === "bigint" ? amountWei.toString() : amountWei;
    if (str === APPROVAL_DISABLED) {
      return "Off";
    }
    return ethers.formatUnits(str, decimals);
  } catch {
    return "0.00";
  }
}

/**
 * Parse human readable display amount to base asset units (USDT 6 decimals)
 */
export function parseBaseUnits(amountStr: string, decimals = 6): bigint {
  try {
    const clean = amountStr.replace(/,/g, "").trim();
    if (!clean || isNaN(Number(clean))) return BigInt(0);
    return ethers.parseUnits(clean, decimals);
  } catch {
    return BigInt(0);
  }
}

/**
 * Read all on-chain view functions for a RiskKernelVault directly via RPC
 */
export async function readVaultSummaryOnChain(
  vaultAddress: string,
  provider?: ethers.ContractRunner
): Promise<OnChainVaultSummary> {
  const contract = getVaultContract(vaultAddress, provider);

  // Execute on-chain views
  const [
    owner,
    baseAssetAddr,
    agent,
    paused,
    frozen,
    hwm,
    bal,
    floor,
    drawdownBps,
    volRem,
    pDelay,
    allowLossTolerant,
    pendingHash,
    pendingEta,
    rawMandate,
  ] = await Promise.all([
    contract.owner().catch(() => ethers.ZeroAddress),
    contract.baseAsset().catch(() => ethers.ZeroAddress),
    contract.agent().catch(() => ethers.ZeroAddress),
    contract.paused().catch(() => false),
    contract.frozen().catch(() => false),
    contract.highWaterMark().catch(() => BigInt(0)),
    contract.balance().catch(() => BigInt(0)),
    contract.lossFloor().catch(() => BigInt(0)),
    contract.currentDrawdownBps().catch(() => BigInt(0)),
    contract.volumeRemainingToday().catch(() => BigInt(0)),
    contract.policyDelay().catch(() => 120),
    contract.allowLossTolerantCycles().catch(() => true),
    contract.pendingPolicyHash().catch(() => ethers.ZeroHash),
    contract.pendingPolicyEta().catch(() => BigInt(0)),
    contract.mandate().catch(() => [BigInt(500), BigInt(50), BigInt(1000000000), BigInt(5000000000), BigInt(2500000000)]),
  ]);

  const mandate: VaultMandate = {
    maxDrawdownBps: Number(rawMandate[0]),
    maxSlippageBps: Number(rawMandate[1]),
    maxPositionSize: rawMandate[2].toString(),
    maxDailyVolume: rawMandate[3].toString(),
    approvalThreshold: rawMandate[4].toString(),
  };

  const isApprovalOff = mandate.approvalThreshold === APPROVAL_DISABLED;

  // Assume 6 decimals for USDT on HashKey Chain
  const decimals = 6;
  const symbol = "USDT";

  return {
    vaultAddress,
    owner,
    baseAsset: baseAssetAddr,
    baseAssetSymbol: symbol,
    baseAssetDecimals: decimals,
    agent,
    paused,
    frozen,
    highWaterMark: hwm.toString(),
    balance: bal.toString(),
    lossFloor: floor.toString(),
    currentDrawdownBps: Number(drawdownBps),
    volumeRemainingToday: volRem.toString(),
    policyDelay: Number(pDelay),
    allowLossTolerantCycles: Boolean(allowLossTolerant),
    pendingPolicyHash: pendingHash,
    pendingPolicyEta: Number(pendingEta),
    mandate,
    isApprovalOff,
    // Formatted strings
    balanceFormatted: formatBaseUnits(bal, decimals),
    peakFormatted: formatBaseUnits(hwm, decimals),
    lossFloorFormatted: formatBaseUnits(floor, decimals),
    maxDrawdownPct: (mandate.maxDrawdownBps / 100).toFixed(1),
    maxPositionFormatted: formatBaseUnits(mandate.maxPositionSize, decimals),
    maxDailyVolumeFormatted: formatBaseUnits(mandate.maxDailyVolume, decimals),
    approvalThresholdFormatted: isApprovalOff ? "Off" : formatBaseUnits(mandate.approvalThreshold, decimals),
    volumeRemainingFormatted: formatBaseUnits(volRem, decimals),
  };
}

/**
 * EIP-712 Typed Data Specification for Trade Approvals matching RiskKernelVault(1).sol
 */
export function getTradeApprovalTypedData(
  chainId: number,
  vaultAddress: string,
  value: {
    cycleHash: string;
    amountIn: bigint | string;
    minReturn: bigint | string;
    expiry: number | string;
    nonce: bigint | string;
  }
) {
  const domain = {
    name: "RiskKernelVault",
    version: "1",
    chainId: Number(chainId),
    verifyingContract: vaultAddress,
  };

  const types = {
    TradeApproval: [
      { name: "cycleHash", type: "bytes32" },
      { name: "amountIn", type: "uint256" },
      { name: "minReturn", type: "uint256" },
      { name: "expiry", type: "uint64" },
      { name: "nonce", type: "uint256" },
    ],
  };

  return {
    domain,
    types,
    value: {
      cycleHash: value.cycleHash,
      amountIn: BigInt(value.amountIn),
      minReturn: BigInt(value.minReturn),
      expiry: BigInt(value.expiry),
      nonce: BigInt(value.nonce),
    },
  };
}
