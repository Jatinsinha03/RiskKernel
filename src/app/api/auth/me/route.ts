import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";


export async function GET(req: NextRequest) {
  try {
    const sessionUser = req.cookies.get("rk_session_user")?.value;
    const queryAddress = req.nextUrl.searchParams.get("address")?.toLowerCase();

    const address = sessionUser || queryAddress;

    if (!address) {
      return NextResponse.json({ authenticated: false, user: null });
    }

    const user = await prisma.user.findUnique({
      where: { address },
      include: {
        vaults: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ authenticated: false, user: null });
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        address: user.address,
        vaults: user.vaults,
      },
    });
  } catch (error) {
    console.error("Auth me check error:", error);
    return NextResponse.json({ authenticated: false, error: "Failed to fetch session" }, { status: 500 });
  }
}
