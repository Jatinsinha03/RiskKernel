import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const normalizedAddress = address.toLowerCase();

    const events = await prisma.activityEvent.findMany({
      where: { vaultAddress: normalizedAddress },
      orderBy: { timestamp: "desc" },
      take: 50,
    });

    return NextResponse.json({ events });
  } catch (error) {
    console.error("Error fetching activity events:", error);
    return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const normalizedAddress = address.toLowerCase();
    const body = await req.json();

    const { eventType, txHash, blockNumber = 0, details = {} } = body;

    const event = await prisma.activityEvent.create({
      data: {
        vaultAddress: normalizedAddress,
        eventType,
        txHash: txHash || `0x${Math.random().toString(16).substring(2).padEnd(64, "0")}`,
        blockNumber,
        details,
      },
    });

    return NextResponse.json({ success: true, event });
  } catch (error) {
    console.error("Error creating activity event:", error);
    return NextResponse.json({ error: "Failed to record activity" }, { status: 500 });
  }
}
