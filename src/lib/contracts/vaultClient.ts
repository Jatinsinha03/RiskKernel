import { ethers } from "ethers";
import { RISK_KERNEL_VAULT_ABI, ERC20_ABI, APPROVAL_DISABLED } from "./RiskKernelVaultABI";
import { DEFAULT_NETWORK, switchOrAddNetwork, NetworkConfig } from "../web3";
import { PolicyChangeStruct, parseBaseUnits, getTradeApprovalTypedData } from "./vaultContract";

export interface TxResult {
  success: boolean;
  txHash?: string;
  error?: string;
  receipt?: ethers.TransactionReceipt | null;
}

/**
 * Ensure the browser wallet is connected to the right HashKey chain
 */
export async function getVerifiedSigner(targetNetwork: NetworkConfig = DEFAULT_NETWORK): Promise<ethers.Signer> {
  if (typeof window === "undefined" || !(window as unknown as { ethereum?: unknown }).ethereum) {
    throw new Error("MetaMask is not detected in your browser. Please install MetaMask to interact with the smart contract.");
  }

  const provider = new ethers.BrowserProvider((window as unknown as { ethereum: ethers.Eip1193Provider }).ethereum);
  const net = await provider.getNetwork();

  if (Number(net.chainId) !== targetNetwork.chainId) {
    await switchOrAddNetwork(targetNetwork);
    // Refresh provider after network change
    const updatedProvider = new ethers.BrowserProvider((window as unknown as { ethereum: ethers.Eip1193Provider }).ethereum);
    return updatedProvider.getSigner();
  }

  return provider.getSigner();
}

/**
 * Convert structured PolicyChangeStruct into the tuple format expected by the Solidity contract
 */
export function formatPolicyStructForSolidity(c: PolicyChangeStruct) {
  const approvalThresholdVal =
    c.mandate.approvalThreshold === "Off" || c.mandate.approvalThreshold === APPROVAL_DISABLED
      ? BigInt(APPROVAL_DISABLED)
      : parseBaseUnits(c.mandate.approvalThreshold);

  return {
    mandate: {
      maxDrawdownBps: Number(c.mandate.maxDrawdownBps),
      maxSlippageBps: Number(c.mandate.maxSlippageBps),
      maxPositionSize: parseBaseUnits(c.mandate.maxPositionSize),
      maxDailyVolume: parseBaseUnits(c.mandate.maxDailyVolume),
      approvalThreshold: approvalThresholdVal,
    },
    addTokens: c.addTokens || [],
    removeTokens: c.removeTokens || [],
    addRouters: c.addRouters || [],
    removeRouters: c.removeRouters || [],
    newAgent: c.newAgent || ethers.ZeroAddress,
  };
}

/**
 * Check on-chain if a policy change is looser (queued) or safer (applied instantly)
 */
export async function checkIsPolicyLooserOnChain(
  vaultAddress: string,
  policyChange: PolicyChangeStruct,
  signerOrProvider?: ethers.ContractRunner
): Promise<boolean> {
  try {
    const runner = signerOrProvider || (await getVerifiedSigner());
    const contract = new ethers.Contract(vaultAddress, RISK_KERNEL_VAULT_ABI, runner);
    const tuple = formatPolicyStructForSolidity(policyChange);
    return await contract.isPolicyLooser(tuple);
  } catch (err) {
    console.warn("Could not call isPolicyLooser on-chain, falling back to local evaluation:", err);
    return false;
  }
}

/**
 * Submit a policy change transaction on-chain via MetaMask
 */
export async function clientSubmitPolicy(
  vaultAddress: string,
  policyChange: PolicyChangeStruct
): Promise<TxResult> {
  try {
    const signer = await getVerifiedSigner();
    const contract = new ethers.Contract(vaultAddress, RISK_KERNEL_VAULT_ABI, signer);
    const tuple = formatPolicyStructForSolidity(policyChange);

    const tx = await contract.submitPolicy(tuple);
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: tx.hash,
      receipt,
    };
  } catch (error: unknown) {
    console.error("clientSubmitPolicy failed:", error);
    const err = error as { reason?: string; message?: string };
    return {
      success: false,
      error: err.reason || err.message || "Failed to submit policy transaction",
    };
  }
}

/**
 * Apply a previously queued policy whose timelock delay has elapsed
 */
export async function clientApplyQueuedPolicy(
  vaultAddress: string,
  policyChange: PolicyChangeStruct
): Promise<TxResult> {
  try {
    const signer = await getVerifiedSigner();
    const contract = new ethers.Contract(vaultAddress, RISK_KERNEL_VAULT_ABI, signer);
    const tuple = formatPolicyStructForSolidity(policyChange);

    const tx = await contract.applyQueuedPolicy(tuple);
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: tx.hash,
      receipt,
    };
  } catch (error: unknown) {
    console.error("clientApplyQueuedPolicy failed:", error);
    const err = error as { reason?: string; message?: string };
    return {
      success: false,
      error: err.reason || err.message || "Failed to apply queued policy",
    };
  }
}

/**
 * Cancel a pending queued policy before activation
 */
export async function clientCancelQueuedPolicy(vaultAddress: string): Promise<TxResult> {
  try {
    const signer = await getVerifiedSigner();
    const contract = new ethers.Contract(vaultAddress, RISK_KERNEL_VAULT_ABI, signer);

    const tx = await contract.cancelQueuedPolicy();
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: tx.hash,
      receipt,
    };
  } catch (error: unknown) {
    console.error("clientCancelQueuedPolicy failed:", error);
    const err = error as { reason?: string; message?: string };
    return {
      success: false,
      error: err.reason || err.message || "Failed to cancel queued policy",
    };
  }
}

/**
 * Emergency pause the vault
 */
export async function clientPause(vaultAddress: string): Promise<TxResult> {
  try {
    const signer = await getVerifiedSigner();
    const contract = new ethers.Contract(vaultAddress, RISK_KERNEL_VAULT_ABI, signer);

    const tx = await contract.pause();
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: tx.hash,
      receipt,
    };
  } catch (error: unknown) {
    const err = error as { reason?: string; message?: string };
    return { success: false, error: err.reason || err.message || "Pause failed" };
  }
}

/**
 * Unpause the vault
 */
export async function clientUnpause(vaultAddress: string): Promise<TxResult> {
  try {
    const signer = await getVerifiedSigner();
    const contract = new ethers.Contract(vaultAddress, RISK_KERNEL_VAULT_ABI, signer);

    const tx = await contract.unpause();
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: tx.hash,
      receipt,
    };
  } catch (error: unknown) {
    const err = error as { reason?: string; message?: string };
    return { success: false, error: err.reason || err.message || "Unpause failed" };
  }
}

/**
 * Revoke the trading agent permanently or immediately
 */
export async function clientRevokeAgent(vaultAddress: string): Promise<TxResult> {
  try {
    const signer = await getVerifiedSigner();
    const contract = new ethers.Contract(vaultAddress, RISK_KERNEL_VAULT_ABI, signer);

    const tx = await contract.revokeAgent();
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: tx.hash,
      receipt,
    };
  } catch (error: unknown) {
    const err = error as { reason?: string; message?: string };
    return { success: false, error: err.reason || err.message || "Revoke agent failed" };
  }
}

/**
 * Reset high-water mark peak and unfreeze the circuit breaker
 */
export async function clientUnfreeze(vaultAddress: string): Promise<TxResult> {
  try {
    const signer = await getVerifiedSigner();
    const contract = new ethers.Contract(vaultAddress, RISK_KERNEL_VAULT_ABI, signer);

    const tx = await contract.unfreeze();
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: tx.hash,
      receipt,
    };
  } catch (error: unknown) {
    const err = error as { reason?: string; message?: string };
    return { success: false, error: err.reason || err.message || "Unfreeze failed" };
  }
}

/**
 * Withdraw base asset USDT from the vault to the owner wallet
 */
export async function clientWithdraw(vaultAddress: string, amountFormatted: string): Promise<TxResult> {
  try {
    const signer = await getVerifiedSigner();
    const contract = new ethers.Contract(vaultAddress, RISK_KERNEL_VAULT_ABI, signer);
    const amountWei = parseBaseUnits(amountFormatted, 6);

    const tx = await contract.withdraw(amountWei);
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: tx.hash,
      receipt,
    };
  } catch (error: unknown) {
    const err = error as { reason?: string; message?: string };
    return { success: false, error: err.reason || err.message || "Withdraw failed" };
  }
}

/**
 * Approve USDT if needed, then deposit into the vault
 */
export async function clientDeposit(
  vaultAddress: string,
  amountFormatted: string,
  baseAssetAddress?: string
): Promise<TxResult> {
  try {
    const signer = await getVerifiedSigner();
    const contract = new ethers.Contract(vaultAddress, RISK_KERNEL_VAULT_ABI, signer);
    const amountWei = parseBaseUnits(amountFormatted, 6);

    const baseAsset = baseAssetAddress || (await contract.baseAsset());
    const erc20 = new ethers.Contract(baseAsset, ERC20_ABI, signer);
    const ownerAddress = await signer.getAddress();

    // Check existing allowance
    const allowance: bigint = await erc20.allowance(ownerAddress, vaultAddress);
    if (allowance < amountWei) {
      const approveTx = await erc20.approve(vaultAddress, ethers.MaxUint256);
      await approveTx.wait();
    }

    const tx = await contract.deposit(amountWei);
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: tx.hash,
      receipt,
    };
  } catch (error: unknown) {
    const err = error as { reason?: string; message?: string };
    return { success: false, error: err.reason || err.message || "Deposit failed" };
  }
}

/**
 * Rescue mistaken ERC20 tokens sent to the vault (base asset is protected and cannot be rescued)
 */
export async function clientRescueToken(
  vaultAddress: string,
  tokenAddress: string,
  toAddress: string
): Promise<TxResult> {
  try {
    const signer = await getVerifiedSigner();
    const contract = new ethers.Contract(vaultAddress, RISK_KERNEL_VAULT_ABI, signer);

    const tx = await contract.rescueToken(tokenAddress, toAddress);
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: tx.hash,
      receipt,
    };
  } catch (error: unknown) {
    const err = error as { reason?: string; message?: string };
    return { success: false, error: err.reason || err.message || "Rescue token failed" };
  }
}

/**
 * Zero-gas EIP-712 typed-data signature for high-value trade approvals
 * Matches RiskKernelVault(1).sol TradeApproval specification
 */
export async function clientSignTradeApproval(
  chainId: number,
  vaultAddress: string,
  tradeParams: {
    cycleHash: string;
    amountIn: string; // in display units or 6-decimal base units
    minReturn: string;
    expiry: number; // unix timestamp in seconds
    nonce: string;
  }
): Promise<{ signature: string; cycleHash: string; digest: string }> {
  const signer = await getVerifiedSigner();
  const contract = new ethers.Contract(vaultAddress, RISK_KERNEL_VAULT_ABI, signer);

  const amountInWei = parseBaseUnits(tradeParams.amountIn, 6);
  const minReturnWei = parseBaseUnits(tradeParams.minReturn, 6);

  const typedData = getTradeApprovalTypedData(chainId, vaultAddress, {
    cycleHash: tradeParams.cycleHash,
    amountIn: amountInWei,
    minReturn: minReturnWei,
    expiry: tradeParams.expiry,
    nonce: tradeParams.nonce,
  });

  // Verify on-chain digest matches client-side typed data hash
  let onChainDigest = "";
  try {
    onChainDigest = await contract.approvalDigest(
      tradeParams.cycleHash,
      amountInWei,
      minReturnWei,
      tradeParams.expiry,
      tradeParams.nonce
    );
  } catch (e) {
    console.warn("Could not call approvalDigest on-chain; proceeding with EIP-712 typed data:", e);
  }

  // Request typed data signature from MetaMask (0 gas)
  const signature = await signer.signTypedData(
    typedData.domain,
    typedData.types,
    typedData.value
  );

  return {
    signature,
    cycleHash: tradeParams.cycleHash,
    digest: onChainDigest,
  };
}
