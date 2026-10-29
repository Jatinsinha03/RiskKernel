import { ethers } from "ethers";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getRpcProvider, getVaultContract, formatBaseUnits, parseBaseUnits } from "./contracts/vaultContract";
import { RISK_KERNEL_VAULT_ABI } from "./contracts/RiskKernelVaultABI";

export interface IndexerResult {
  vaultAddress: string;
  fromBlock: number;
  toBlock: number;
  eventsProcessed: number;
}

/**
 * Polls on-chain events for a specific vault from HashKey Chain RPC and synchronizes the ActivityEvent table.
 * Specifically captures full PolicyQueued data which is required for applyQueuedPolicy.
 */
export async function pollVaultEvents(
  vaultAddress: string,
  fromBlockOverride?: number
): Promise<IndexerResult> {
  const normalizedAddress = vaultAddress.toLowerCase();
  const provider = getRpcProvider();
  const currentBlock = await provider.getBlockNumber();

  const targetChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "177");

  // 1. Get or initialize cursor
  let cursor = await prisma.indexerCursor.findFirst({
    where: { chainId: targetChainId },
  });

  if (!cursor) {
    cursor = await prisma.indexerCursor.create({
      data: { chainId: targetChainId, lastProcessedBlock: Math.max(0, currentBlock - 500) },
    });
  }

  const fromBlock = fromBlockOverride !== undefined ? fromBlockOverride : cursor.lastProcessedBlock + 1;
  const toBlock = currentBlock;

  if (fromBlock > toBlock) {
    return { vaultAddress: normalizedAddress, fromBlock, toBlock, eventsProcessed: 0 };
  }

  const contract = new ethers.Contract(normalizedAddress, RISK_KERNEL_VAULT_ABI, provider);

  // Query events in block range
  const filter = {
    address: normalizedAddress,
    fromBlock,
    toBlock,
  };

  let logs: ethers.Log[] = [];
  try {
    logs = await provider.getLogs(filter);
  } catch (err) {
    console.warn("Could not fetch logs from RPC, skipping poll cycle:", err);
    return { vaultAddress: normalizedAddress, fromBlock, toBlock, eventsProcessed: 0 };
  }

  const iface = new ethers.Interface(RISK_KERNEL_VAULT_ABI);
  let processedCount = 0;

  for (const log of logs) {
    try {
      const parsed = iface.parseLog(log);
      if (!parsed) continue;

      const eventName = parsed.name;
      const txHash = log.transactionHash;
      const blockNum = log.blockNumber;
      const logIdx = log.index;

      // Check if event already stored
      const existing = await prisma.activityEvent.findFirst({
        where: {
          vaultAddress: normalizedAddress,
          txHash,
          logIndex: logIdx,
        },
      });

      if (existing) continue;

      let eventType = eventName.toUpperCase();
      let details: Record<string, unknown> = {};

      if (eventName === "Deposited") {
        eventType = "DEPOSIT";
        const amount = parsed.args.amount;
        const hwm = parsed.args.highWaterMark;
        details = {
          amount: formatBaseUnits(amount, 6),
          amountRaw: amount.toString(),
          highWaterMark: formatBaseUnits(hwm, 6),
        };
      } else if (eventName === "Withdrawn") {
        eventType = "WITHDRAW";
        const amount = parsed.args.amount;
        details = {
          amount: formatBaseUnits(amount, 6),
          amountRaw: amount.toString(),
        };
      } else if (eventName === "PolicyQueued") {
        eventType = "POLICY_QUEUED";
        const hash = parsed.args.hash;
        const eta = Number(parsed.args.eta);
        const policyStruct = parsed.args.c;

        const mandateRaw = policyStruct.mandate;
        const fullPolicyData = {
          hash,
          eta,
          unlockAt: new Date(eta * 1000).toISOString(),
          mandate: {
            maxDrawdownBps: Number(mandateRaw.maxDrawdownBps),
            maxSlippageBps: Number(mandateRaw.maxSlippageBps),
            maxPositionSize: mandateRaw.maxPositionSize.toString(),
            maxDailyVolume: mandateRaw.maxDailyVolume.toString(),
            approvalThreshold: mandateRaw.approvalThreshold.toString(),
          },
          addTokens: policyStruct.addTokens || [],
          removeTokens: policyStruct.removeTokens || [],
          addRouters: policyStruct.addRouters || [],
          removeRouters: policyStruct.removeRouters || [],
          newAgent: policyStruct.newAgent || ethers.ZeroAddress,
        };

        details = fullPolicyData;

        // Invariant: Save full PolicyQueued data so applyQueuedPolicy can resubmit exact data
        await prisma.vault.update({
          where: { address: normalizedAddress },
          data: {
            pendingPolicy: {
              proposedAt: new Date().toISOString(),
              unlockAt: fullPolicyData.unlockAt,
              delaySeconds: 120,
              proposed: fullPolicyData.mandate,
              fullStruct: fullPolicyData,
              diffs: [
                {
                  field: "mandate",
                  label: "Queued Mandate Update",
                  oldValue: "Active Mandate",
                  newValue: `${fullPolicyData.mandate.maxDrawdownBps / 100}% DD, $${formatBaseUnits(fullPolicyData.mandate.maxPositionSize)} cap`,
                  isSafer: false,
                  reason: "Contains riskier loosening rules placed in timelock",
                },
              ],
            },
          },
        });
      } else if (eventName === "PolicyApplied") {
        eventType = "POLICY_APPLIED";
        const hash = parsed.args.hash;
        const fromQueue = Boolean(parsed.args.fromQueue);
        const policyStruct = parsed.args.c;

        details = {
          hash,
          fromQueue,
          mandate: policyStruct.mandate ? {
            maxDrawdownBps: Number(policyStruct.mandate.maxDrawdownBps),
            maxPositionSize: policyStruct.mandate.maxPositionSize.toString(),
          } : {},
        };

        // Clear pending policy and update active mandate in DB cache
        await prisma.vault.update({
           where: { address: normalizedAddress },
           data: {
             pendingPolicy: Prisma.DbNull,
           },
         });
       } else if (eventName === "PolicyCancelled") {
         eventType = "POLICY_CANCELLED";
         details = { hash: parsed.args.hash };
         await prisma.vault.update({
           where: { address: normalizedAddress },
           data: { pendingPolicy: Prisma.DbNull },
         });
      } else if (eventName === "CircuitBreakerTripped") {
        eventType = "CIRCUIT_BREAKER_TRIPPED";
        details = {
          balance: formatBaseUnits(parsed.args.balance, 6),
          lossFloor: formatBaseUnits(parsed.args.floor, 6),
        };
        await prisma.vault.update({
          where: { address: normalizedAddress },
          data: { status: "FROZEN" },
        });
      } else if (eventName === "TradeExecuted") {
        eventType = "TRADE_EXECUTED";
        details = {
          mode: parsed.args.mode === 0 ? "Cycle" : "Arbitrage",
          amountIn: formatBaseUnits(parsed.args.amountIn, 6),
          amountOut: formatBaseUnits(parsed.args.amountOut, 6),
          profitOrLoss: parsed.args.profitOrLoss?.toString(),
        };
      } else if (eventName === "ApprovalConsumed") {
        eventType = "APPROVAL_CONSUMED";
        details = {
          nonce: parsed.args.nonce.toString(),
          cycleHash: parsed.args.cycleHash,
        };
      } else if (eventName === "PausedSet") {
        const isPaused = Boolean(parsed.args.paused);
        eventType = isPaused ? "PAUSED" : "UNPAUSED";
        details = { isPaused };
        await prisma.vault.update({
          where: { address: normalizedAddress },
          data: { status: isPaused ? "PAUSED" : "ACTIVE" },
        });
      } else if (eventName === "Unfrozen") {
        eventType = "UNFROZEN";
        const newHwm = parsed.args.newHighWaterMark;
        details = { newHighWaterMark: formatBaseUnits(newHwm, 6) };
        await prisma.vault.update({
          where: { address: normalizedAddress },
          data: { status: "ACTIVE", peakValue: formatBaseUnits(newHwm, 6) },
        });
      }

      // Record activity event
      await prisma.activityEvent.create({
        data: {
          vaultAddress: normalizedAddress,
          eventType,
          txHash,
          blockNumber: blockNum,
          logIndex: logIdx,
          details: (details || {}) as Prisma.InputJsonValue,
        },
      });

      processedCount++;
    } catch (parseErr) {
      console.warn("Could not parse log entry:", parseErr);
    }
  }

  // Update cursor
  await prisma.indexerCursor.update({
    where: { id: cursor.id },
    data: { lastProcessedBlock: toBlock },
  });

  return {
    vaultAddress: normalizedAddress,
    fromBlock,
    toBlock,
    eventsProcessed: processedCount,
  };
}

/**
 * Poll all vaults in database
 */
export async function pollAllVaults(): Promise<IndexerResult[]> {
  const vaults = await prisma.vault.findMany({ select: { address: true } });
  const results: IndexerResult[] = [];
  for (const v of vaults) {
    const res = await pollVaultEvents(v.address);
    results.push(res);
  }
  return results;
}
