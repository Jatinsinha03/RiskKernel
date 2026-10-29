import prisma from "@/lib/prisma";
import { ethers } from "ethers";
import { ChainService, StepStruct, ApprovalStruct } from "./chain";
import { ActiveVaultContext } from "./registry";
import { AgentConfig } from "./config";

export interface ExecutionResult {
  success: boolean;
  txHash?: string;
  attemptId: string;
  returnedAmount?: bigint;
  actualProfit?: bigint;
  error?: string;
}

export class ExecutorService {
  private currentNonce: number | null = null;

  constructor(
    private chain: ChainService,
    private config: AgentConfig
  ) {}

  /**
   * Refreshes the latest confirmed nonce for the agent wallet
   */
  public async getNextNonce(): Promise<number> {
    if (!this.chain.signer || !this.config.agentAddress) {
      return 0;
    }

    if (this.currentNonce === null) {
      this.currentNonce = await this.chain.provider.getTransactionCount(
        this.config.agentAddress,
        "pending"
      );
    } else {
      this.currentNonce++;
    }

    return this.currentNonce;
  }

  /**
   * Resets local nonce cache on error
   */
  public resetNonce(): void {
    this.currentNonce = null;
  }

  /**
   * Broadcasts executeArbitrage transaction to HashKey Chain
   */
  public async executeArbitrageTrade(
    vault: ActiveVaultContext,
    opportunityId: string,
    steps: StepStruct[],
    amountIn: bigint,
    minProfit: bigint,
    approval?: ApprovalStruct
  ): Promise<ExecutionResult> {
    if (this.config.simulateOnly || !this.chain.signer) {
      return {
        success: true,
        attemptId: "simulated",
        actualProfit: minProfit,
      };
    }

    const nonce = await this.getNextNonce();
    const minReturn = amountIn + minProfit;

    // 1. Idempotency: Create Attempt row BEFORE sending transaction
    const attempt = await prisma.attempt.create({
      data: {
        opportunityId,
        vaultAddress: vault.address,
        nonce,
        amountIn: (Number(amountIn) / 1e6).toFixed(2),
        minReturn: (Number(minReturn) / 1e6).toFixed(2),
        status: "prepared",
      },
    });

    const vaultContract = this.chain.getVaultContract(vault.address);
    const deadline = Math.floor(Date.now() / 1000) + 60; // 60s deadline

    const dummyApproval: ApprovalStruct = approval || {
      expiry: 0,
      nonce: 0,
      signature: "0x",
    };

    try {
      const feeData = await this.chain.provider.getFeeData();
      const gasPrice = feeData.gasPrice || ethers.parseUnits("500", "gwei");

      // Broadcast transaction
      const tx = await vaultContract.executeArbitrage(
        steps,
        amountIn,
        minProfit,
        deadline,
        dummyApproval,
        {
          nonce,
          gasLimit: 450000,
          gasPrice,
        }
      );

      // Update attempt with txHash
      await prisma.attempt.update({
        where: { id: attempt.id },
        data: {
          txHash: tx.hash,
          gasPriceGwei: ethers.formatUnits(gasPrice, "gwei"),
          status: "sent",
        },
      });

      await prisma.opportunity.update({
        where: { id: opportunityId },
        data: { status: "sent" },
      });

      // Wait for confirmation with timeout
      const receipt = await tx.wait(1, 45000); // 45 second wait

      if (receipt && receipt.status === 1) {
        // Parse TradeExecuted event
        let actualProfit = minProfit;
        let returnedAmount = minReturn;

        for (const log of receipt.logs) {
          try {
            const parsed = this.chain.vaultInterface.parseLog(log);
            if (parsed && parsed.name === "TradeExecuted") {
              returnedAmount = BigInt(parsed.args.returned.toString());
              actualProfit = BigInt(parsed.args.pnl.toString());
              break;
            }
          } catch {
            // Not a vault log
          }
        }

        await prisma.attempt.update({
          where: { id: attempt.id },
          data: {
            status: "confirmed",
            gasUsed: receipt.gasUsed.toString(),
          },
        });

        await prisma.opportunity.update({
          where: { id: opportunityId },
          data: { status: "confirmed" },
        });

        return {
          success: true,
          txHash: tx.hash,
          attemptId: attempt.id,
          returnedAmount,
          actualProfit,
        };
      } else {
        throw new Error("Transaction reverted on-chain");
      }
    } catch (err: unknown) {
      this.resetNonce();
      const errorMsg = (err as Error).message || "Transaction execution failed";

      await prisma.attempt.update({
        where: { id: attempt.id },
        data: {
          status: "reverted",
          error: errorMsg,
        },
      });

      await prisma.opportunity.update({
        where: { id: opportunityId },
        data: {
          status: "reverted",
          reason: errorMsg,
        },
      });

      return {
        success: false,
        attemptId: attempt.id,
        error: errorMsg,
      };
    }
  }
}
