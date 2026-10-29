import { ethers } from "ethers";
import { ChainService, StepStruct, ApprovalStruct } from "./chain";
import { ActiveVaultContext } from "./registry";

export interface SimulationResult {
  success: boolean;
  amountIn: bigint;
  returnedAmount: bigint;
  grossProfitRaw: bigint;
  requiresApproval: boolean;
  estimatedGasUnits: bigint;
  revertReason?: string;
}

export class SimulatorService {
  constructor(private chain: ChainService) {}

  /**
   * Simulates a candidate cycle against the real vault contract on-chain
   * Uses the huge minProfit trick to extract the exact returned amount without spending gas.
   */
  public async simulateCycle(
    vault: ActiveVaultContext,
    steps: StepStruct[],
    amountIn: bigint,
    approval?: ApprovalStruct
  ): Promise<SimulationResult> {
    const vaultContract = this.chain.getVaultContract(vault.address);
    const deadline = Math.floor(Date.now() / 1000) + 120; // 2 minutes

    const dummyApproval: ApprovalStruct = approval || {
      expiry: 0,
      nonce: 0,
      signature: "0x",
    };

    const requiresApproval = vaultContract.requiresApproval
      ? await vaultContract.requiresApproval(amountIn).catch(() => false)
      : amountIn > vault.approvalThresholdRaw;

    // If above threshold and no signature, we know approval is required
    if (requiresApproval && (!approval || !approval.signature || approval.signature === "0x")) {
      return {
        success: false,
        amountIn,
        returnedAmount: BigInt(0),
        grossProfitRaw: BigInt(0),
        requiresApproval: true,
        estimatedGasUnits: BigInt(350000),
        revertReason: "ApprovalRequired",
      };
    }

    // Call with huge minProfit (e.g. 100,000,000 USDT) so it executes all swaps and reverts with InsufficientReturn(returned, required)
    const hugeMinProfit = ethers.parseUnits("100000000", 6);

    try {
      // Execute static call from agent address
      const fromAddr = this.chain.config.agentAddress || vault.agent || vault.owner;

      await vaultContract.executeArbitrage.staticCall(
        steps,
        amountIn,
        hugeMinProfit,
        deadline,
        dummyApproval,
        { from: fromAddr }
      );

      // Unlikely to succeed with 100m profit, but handle if it did
      return {
        success: true,
        amountIn,
        returnedAmount: amountIn + hugeMinProfit,
        grossProfitRaw: hugeMinProfit,
        requiresApproval: false,
        estimatedGasUnits: BigInt(350000),
      };
    } catch (err: unknown) {
      const errObj = err as { data?: string; error?: { data?: string }; info?: { error?: { data?: string } } };
      const rawData =
        errObj.data ||
        errObj.error?.data ||
        errObj.info?.error?.data ||
        "";

      const decoded = this.chain.decodeRevertError(rawData);

      if (decoded && decoded.errorName === "InsufficientReturn") {
        const returned = BigInt(decoded.args.returned as string || "0");
        const profit = returned > amountIn ? returned - amountIn : BigInt(0);

        return {
          success: returned > amountIn,
          amountIn,
          returnedAmount: returned,
          grossProfitRaw: profit,
          requiresApproval: false,
          estimatedGasUnits: BigInt(320000), // Standard 2-3 step V3 multi-swap gas estimate
        };
      }

      if (decoded && decoded.errorName === "ApprovalRequired") {
        return {
          success: false,
          amountIn,
          returnedAmount: BigInt(0),
          grossProfitRaw: BigInt(0),
          requiresApproval: true,
          estimatedGasUnits: BigInt(350000),
          revertReason: "ApprovalRequired",
        };
      }

      const reason = decoded?.errorName || (err as Error).message || "SimulationFailed";
      return {
        success: false,
        amountIn,
        returnedAmount: BigInt(0),
        grossProfitRaw: BigInt(0),
        requiresApproval: false,
        estimatedGasUnits: BigInt(0),
        revertReason: reason,
      };
    }
  }
}
