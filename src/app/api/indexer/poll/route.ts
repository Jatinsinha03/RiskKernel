import { NextRequest, NextResponse } from "next/server";
import { pollVaultEvents, pollAllVaults } from "@/lib/indexer";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { vaultAddress } = body;

    if (vaultAddress) {
      const result = await pollVaultEvents(vaultAddress);
      return NextResponse.json({ success: true, result });
    }

    const results = await pollAllVaults();
    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("Indexer polling error:", error);
    return NextResponse.json({ error: "Failed to poll events" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const vaultAddress = searchParams.get("vaultAddress");

    if (vaultAddress) {
      const result = await pollVaultEvents(vaultAddress);
      return NextResponse.json({ success: true, result });
    }

    const results = await pollAllVaults();
    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("Indexer polling GET error:", error);
    return NextResponse.json({ error: "Failed to poll events" }, { status: 500 });
  }
}
