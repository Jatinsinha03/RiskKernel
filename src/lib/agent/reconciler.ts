import prisma from "@/lib/prisma";
import { ChainService } from "./chain";

export class ReconcilerService {
  constructor(private chain: ChainService) {}

  /**
   * Reconciles any incomplete attempts left from unexpected worker restarts or crashes
   */
  public async reconcilePendingAttempts(): Promise<void> {
    const pendingAttempts = await prisma.attempt.findMany({
      where: {
        status: { in: ["prepared", "sent"] },
      },
    });

    if (pendingAttempts.length === 0) return;

    console.log(`[Reconciler] Found ${pendingAttempts.length} pending attempts from prior sessions.`);

    for (const attempt of pendingAttempts) {
      try {
        if (!attempt.txHash) {
          // Prepared but never sent before crash: mark dropped
          await prisma.attempt.update({
            where: { id: attempt.id },
            data: { status: "dropped", error: "Worker crashed before transaction broadcast" },
          });
          continue;
        }

        // Check receipt on-chain
        const receipt = await this.chain.provider.getTransactionReceipt(attempt.txHash);
        if (receipt) {
          const finalStatus = receipt.status === 1 ? "confirmed" : "reverted";
          await prisma.attempt.update({
            where: { id: attempt.id },
            data: {
              status: finalStatus,
              gasUsed: receipt.gasUsed.toString(),
            },
          });

          if (attempt.opportunityId) {
            await prisma.opportunity.update({
              where: { id: attempt.opportunityId },
              data: { status: finalStatus },
            });
          }
        } else {
          // If transaction is older than 5 minutes and not found, mark dropped
          const ageMs = Date.now() - new Date(attempt.createdAt).getTime();
          if (ageMs > 300000) {
            await prisma.attempt.update({
              where: { id: attempt.id },
              data: { status: "dropped", error: "Transaction timed out unmined" },
            });
          }
        }
      } catch (err) {
        console.warn(`[Reconciler] Could not reconcile attempt ${attempt.id}:`, err);
      }
    }
  }
}
