import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const vaultAddress = searchParams.get("vaultAddress")?.toLowerCase();

    const where = vaultAddress ? { vaultAddress } : {};

    const opportunities = await prisma.opportunity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        approvals: true,
      },
    });

    return NextResponse.json({ opportunities });
  } catch (error) {
    console.error("Error fetching opportunities:", error);
    return NextResponse.json({ error: "Failed to fetch opportunities" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      vaultAddress,
      route,
      tradeAmount,
      estimatedProfit,
      netProfitBps = 15,
      minProfit,
      gasEstimate = "0.002 HSK",
      status = "PENDING",
      reason,
    } = body;

    const opp = await prisma.opportunity.create({
      data: {
        vaultAddress: vaultAddress.toLowerCase(),
        route: route || ["USDT", "HSK", "USDT"],
        tradeAmount: tradeAmount.toString(),
        estimatedProfit: estimatedProfit.toString(),
        netProfitBps,
        minProfit: minProfit.toString(),
        gasEstimate,
        status,
        reason,
      },
    });

    return NextResponse.json({ success: true, opportunity: opp });
  } catch (error) {
    console.error("Error creating opportunity:", error);
    return NextResponse.json({ error: "Failed to record opportunity" }, { status: 500 });
  }
}
