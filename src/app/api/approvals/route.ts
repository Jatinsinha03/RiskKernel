import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const vaultAddress = searchParams.get("vaultAddress")?.toLowerCase();

    const where: Record<string, unknown> = {};
    if (vaultAddress) where.vaultAddress = vaultAddress;

    const approvals = await prisma.approvalRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        opportunity: true,
        vault: {
          select: {
            address: true,
            baseAssetSymbol: true,
            approvalThreshold: true,
          },
        },
      },
    });

    return NextResponse.json({ approvals });
  } catch (error) {
    console.error("Error fetching approvals:", error);
    return NextResponse.json({ error: "Failed to fetch approvals" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { approvalId, action, signature, signerAddress } = body;

    if (!approvalId || !action) {
      return NextResponse.json({ error: "approvalId and action required" }, { status: 400 });
    }

    const currentApproval = await prisma.approvalRequest.findUnique({
      where: { id: approvalId },
    });

    if (!currentApproval) {
      return NextResponse.json({ error: "Approval request not found" }, { status: 404 });
    }

    if (action === "APPROVE") {
      if (!signature) {
        return NextResponse.json({ error: "EIP-712 signature required for approval" }, { status: 400 });
      }

      const updated = await prisma.approvalRequest.update({
        where: { id: approvalId },
        data: {
          status: "APPROVED",
          signature,
          signerAddress: signerAddress?.toLowerCase(),
        },
      });

      // Update linked opportunity to SENT
      if (currentApproval.opportunityId) {
        await prisma.opportunity.update({
          where: { id: currentApproval.opportunityId },
          data: { status: "SENT" },
        });
      }

      // Record activity event
      await prisma.activityEvent.create({
        data: {
          vaultAddress: currentApproval.vaultAddress,
          eventType: "APPROVAL_SIGNED",
          txHash: `0x${Math.random().toString(16).substring(2).padEnd(64, "0")}`,
          blockNumber: 1000450,
          details: {
            tradeAmount: currentApproval.tradeAmount,
            signerAddress,
            summary: currentApproval.summary,
          },
        },
      });

      return NextResponse.json({ success: true, approval: updated });
    }

    if (action === "REJECT") {
      const updated = await prisma.approvalRequest.update({
        where: { id: approvalId },
        data: {
          status: "REJECTED",
        },
      });

      if (currentApproval.opportunityId) {
        await prisma.opportunity.update({
          where: { id: currentApproval.opportunityId },
          data: { status: "CANCELLED", reason: "Rejected by owner in human-in-the-loop review" },
        });
      }

      return NextResponse.json({ success: true, approval: updated });
    }

    return NextResponse.json({ error: "Unsupported approval action" }, { status: 400 });
  } catch (error) {
    console.error("Error processing approval:", error);
    return NextResponse.json({ error: "Failed to process approval" }, { status: 500 });
  }
}
