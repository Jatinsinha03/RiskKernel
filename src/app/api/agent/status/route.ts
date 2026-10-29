import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { StateService } from "@/lib/agent/state";

export async function GET() {
  try {
    const heartbeat = await prisma.workerHeartbeat.findUnique({
      where: { workerId: "primary" },
    });

    const killFlag = await prisma.workerFlag.findUnique({
      where: { key: "GLOBAL_KILL_SWITCH" },
    });

    const isKillActive = killFlag?.value === "true";

    // Determine alive status: if last loop was within 30 seconds
    const isAlive = heartbeat?.lastLoopAt
      ? Date.now() - new Date(heartbeat.lastLoopAt).getTime() < 30000
      : false;

    return NextResponse.json({
      alive: isAlive,
      status: isKillActive ? "halted" : isAlive ? heartbeat?.status || "running" : "offline",
      killSwitchActive: isKillActive,
      lastLoopAt: heartbeat?.lastLoopAt || null,
      lastBlock: heartbeat?.lastBlock || 0,
      agentHskBalance: heartbeat?.agentHskBalance || "0.0",
      activeVaultsCount: heartbeat?.activeVaultsCount || 0,
      candidatesCount: heartbeat?.candidatesCount || 0,
      simulationsCount: heartbeat?.simulationsCount || 0,
      sendsCount: heartbeat?.sendsCount || 0,
      lastError: heartbeat?.lastError || null,
    });
  } catch (err) {
    console.error("Error fetching agent status:", err);
    return NextResponse.json({ error: "Failed to fetch agent worker status" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    const state = new StateService();

    if (action === "KILL") {
      await state.setKillSwitch(true);
      return NextResponse.json({ success: true, killSwitchActive: true });
    }

    if (action === "RESUME") {
      await state.setKillSwitch(false);
      return NextResponse.json({ success: true, killSwitchActive: false });
    }

    return NextResponse.json({ error: "Invalid action. Supported: KILL, RESUME" }, { status: 400 });
  } catch (err) {
    console.error("Error setting agent kill switch:", err);
    return NextResponse.json({ error: "Failed to update kill switch" }, { status: 500 });
  }
}
