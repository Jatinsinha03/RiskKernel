import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { readVaultSummaryOnChain } from "@/lib/contracts/vaultContract";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const normalizedAddress = address.toLowerCase();

    // 1. Read live on-chain view functions from HashKey Chain RPC
    let onChainData = null;
    try {
      onChainData = await readVaultSummaryOnChain(normalizedAddress);
    } catch (rpcErr) {
      console.warn("On-chain read failed or contract not deployed yet at address:", rpcErr);
    }

    // 2. Fetch database record if available
    const dbVault = await prisma.vault.findUnique({
      where: { address: normalizedAddress },
      include: {
        events: {
          orderBy: { timestamp: "desc" },
          take: 15,
        },
        opportunities: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
        approvals: {
          where: { status: "PENDING" },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    // If on-chain read succeeded, sync live values to DB cache
    if (onChainData && dbVault) {
      try {
        await prisma.vault.update({
          where: { address: normalizedAddress },
          data: {
            balance: onChainData.balanceFormatted,
            peakValue: onChainData.peakFormatted,
            status: onChainData.frozen ? "FROZEN" : onChainData.paused ? "PAUSED" : "ACTIVE",
            maxDrawdownBps: onChainData.mandate.maxDrawdownBps,
            maxPositionSize: onChainData.maxPositionFormatted,
            maxDailyVolume: onChainData.maxDailyVolumeFormatted,
            maxSlippageBps: onChainData.mandate.maxSlippageBps,
            approvalThreshold: onChainData.approvalThresholdFormatted,
            agentAddress: onChainData.agent !== "0x0000000000000000000000000000000000000000" ? onChainData.agent.toLowerCase() : null,
          },
        });
      } catch (dbSyncErr) {
        console.warn("Failed to update db cache from on-chain read:", dbSyncErr);
      }
    }

    // Construct response
    const currentBalance = onChainData
      ? parseFloat(onChainData.balanceFormatted)
      : dbVault
      ? parseFloat(dbVault.balance)
      : 0;

    const peakRaw = onChainData
      ? parseFloat(onChainData.peakFormatted)
      : dbVault
      ? parseFloat(dbVault.peakValue)
      : currentBalance;
    const peak = Math.max(peakRaw || 0, currentBalance);

    const maxDrawdownPct = onChainData
      ? onChainData.mandate.maxDrawdownBps / 100
      : dbVault
      ? dbVault.maxDrawdownBps / 100
      : 5;

    const drawdownAmount = peak > 0 ? Math.max(0, peak - currentBalance) : 0;
    const drawdownPct = peak > 0 ? (drawdownAmount / peak) * 100 : 0;
    const lossFloor = peak > 0 ? peak * (1 - maxDrawdownPct / 100) : 0;
    const distanceToFloor = peak > 0 ? Math.max(0, currentBalance - lossFloor) : 0;
    const distanceToFloorPct = peak > 0 ? (distanceToFloor / peak) * 100 : 100;
    const isBreakerTripped = (onChainData?.frozen ?? false) || (dbVault?.status === "FROZEN") || (peak > 0 && drawdownPct >= maxDrawdownPct);

    return NextResponse.json({
      onChain: onChainData,
      db: dbVault,
      metrics: {
        currentBalance,
        peak,
        drawdownAmount,
        drawdownPct: parseFloat(drawdownPct.toFixed(2)),
        maxDrawdownPct,
        lossFloor: parseFloat(lossFloor.toFixed(2)),
        distanceToFloor: parseFloat(distanceToFloor.toFixed(2)),
        distanceToFloorPct: parseFloat(distanceToFloorPct.toFixed(2)),
        isBreakerTripped,
        isPaused: onChainData?.paused ?? (dbVault?.status === "PAUSED"),
        isFrozen: onChainData?.frozen ?? (dbVault?.status === "FROZEN"),
        pendingPolicyHash: onChainData?.pendingPolicyHash || "0x0000000000000000000000000000000000000000000000000000000000000000",
        pendingPolicyEta: onChainData?.pendingPolicyEta || 0,
      },
    });
  } catch (error) {
    console.error("Error fetching vault summary:", error);
    return NextResponse.json(
      { error: "Failed to read vault summary" },
      { status: 500 }
    );
  }
}
