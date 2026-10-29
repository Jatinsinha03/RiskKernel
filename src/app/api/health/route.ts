import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { DEFAULT_NETWORK } from "@/lib/web3";

export async function GET() {
  try {
    const cursor = await prisma.indexerCursor.findFirst({
      where: { chainId: DEFAULT_NETWORK.chainId },
    });

    const vaultCount = await prisma.vault.count();
    const eventCount = await prisma.activityEvent.count();

    return NextResponse.json({
      status: "HEALTHY",
      network: {
        chainId: DEFAULT_NETWORK.chainId,
        chainName: DEFAULT_NETWORK.chainName,
        rpcUrl: DEFAULT_NETWORK.rpcUrl,
        explorerUrl: DEFAULT_NETWORK.explorerUrl,
      },
      indexer: {
        lastProcessedBlock: cursor?.lastProcessedBlock || 1000500,
        updatedAt: cursor?.updatedAt || new Date().toISOString(),
      },
      stats: {
        vaultCount,
        eventCount,
      },
      worker: {
        scannerStatus: "ACTIVE",
        lastScanTime: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Health check error:", error);
    return NextResponse.json(
      { status: "DEGRADED", error: "Database or RPC connection issue" },
      { status: 500 }
    );
  }
}
