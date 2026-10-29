import prisma from "@/lib/prisma";
import { ethers } from "ethers";
import { ChainService, StepStruct, ApprovalStruct } from "./chain";
import { SimulatorService } from "./simulator";
import { ActiveVaultContext } from "./registry";

export class ApprovalService {
  constructor(
    private chain: ChainService,
    private simulator: SimulatorService
  ) {}

  /**
   * Hashes the cycle steps using the on-chain vault method or matching local encoding
   */
  public async hashCycle(vaultAddress: string, steps: StepStruct[]): Promise<string> {
    try {
      const contract = this.chain.getVaultContract(vaultAddress);
      return await contract.hashCycle(steps);
    } catch {
      // Local fallback using abi.encode(steps)
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const encoded = abiCoder.encode(
        [
          "tuple(address router, uint8 kind, address tokenIn, address tokenOut, uint24 fee)[]",
        ],
        [steps]
      );
      return ethers.keccak256(encoded);
    }
  }

  /**
   * Creates an ApprovalRequest in the database and links to Opportunity
   */
  public async requestApproval(
    vault: ActiveVaultContext,
    opportunityId: string,
    steps: StepStruct[],
    amountIn: bigint,
    minReturn: bigint,
    estimatedProfitUsdt: number
  ): Promise<string | null> {
    // Check if there is already an active pending request for this vault
    const existing = await prisma.approvalRequest.findFirst({
      where: {
        vaultAddress: vault.address,
        status: "pending",
        expiry: { gt: new Date() },
      },
    });

    if (existing) {
      return null; // One active pending request per vault at a time
    }

    const cycleHash = await this.hashCycle(vault.address, steps);
    const nonce = Math.floor(Math.random() * 1000000000).toString();
    const expiry = new Date(Date.now() + 180 * 1000); // 3 minutes expiry

    const tradeAmountUsdt = (Number(amountIn) / 1e6).toFixed(2);
    const minReturnUsdt = (Number(minReturn) / 1e6).toFixed(2);

    const summary = `Approve ${tradeAmountUsdt} USDT arbitrage cycle on HashKey Chain (est. profit: $${estimatedProfitUsdt.toFixed(4)} USDT, min return: ${minReturnUsdt} USDT)`;

    const req = await prisma.approvalRequest.create({
      data: {
        vaultAddress: vault.address,
        opportunityId,
        tradeAmount: tradeAmountUsdt,
        minReturn: minReturnUsdt,
        summary,
        cycleHash,
        nonce,
        expiry,
        status: "pending",
      },
    });

    await prisma.opportunity.update({
      where: { id: opportunityId },
      data: { status: "awaiting_approval" },
    });

    return req.id;
  }

  /**
   * Retrieves and verifies any approved requests ready to be executed
   */
  public async getApprovedRequestForVault(
    vault: ActiveVaultContext,
    steps: StepStruct[],
    amountIn: bigint,
    minReturn: bigint
  ): Promise<{ approval: ApprovalStruct; approvalId: string } | null> {
    const cycleHash = await this.hashCycle(vault.address, steps);

    const approved = await prisma.approvalRequest.findFirst({
      where: {
        vaultAddress: vault.address,
        status: "APPROVED", // from UI signature
        cycleHash,
        expiry: { gt: new Date(Date.now() + 20000) }, // at least 20s remaining before expiry
        signature: { not: null },
      },
    });

    if (!approved || !approved.signature) {
      return null;
    }

    const expirySec = Math.floor(new Date(approved.expiry).getTime() / 1000);

    const approvalStruct: ApprovalStruct = {
      expiry: expirySec,
      nonce: BigInt(approved.nonce),
      signature: approved.signature,
    };

    // Re-simulate on-chain with signature before broadcasting
    const sim = await this.simulator.simulateCycle(
      vault,
      steps,
      amountIn,
      approvalStruct
    );

    if (!sim.success) {
      console.warn(`Approved trade re-simulation failed (${sim.revertReason}), marking approval failed.`);
      await prisma.approvalRequest.update({
        where: { id: approved.id },
        data: { status: "failed" },
      });
      return null;
    }

    return { approval: approvalStruct, approvalId: approved.id };
  }

  /**
   * Mark approval as consumed
   */
  public async markApprovalUsed(approvalId: string): Promise<void> {
    await prisma.approvalRequest.update({
      where: { id: approvalId },
      data: { status: "used" },
    });
  }
}
