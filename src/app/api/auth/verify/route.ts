import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ethers } from "ethers";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const { address, signature } = await req.json();

    if (!address || !signature) {
      return NextResponse.json({ error: "Missing address or signature" }, { status: 400 });
    }

    const normalizedAddress = address.toLowerCase();

    const user = await prisma.user.findUnique({
      where: { address: normalizedAddress },
    });

    if (!user) {
      return NextResponse.json({ error: "Sign-in challenge expired or not found. Please request a new nonce." }, { status: 404 });
    }

    const message = `Welcome to Risk Kernel.\n\nSign this message to authenticate your wallet with HashKey Chain:\nNonce: ${user.nonce}`;

    // Verify cryptographic signature
    const recoveredAddress = ethers.verifyMessage(message, signature).toLowerCase();

    if (recoveredAddress !== normalizedAddress) {
      return NextResponse.json({ error: "Invalid signature verification failed" }, { status: 401 });
    }

    // Invalidate nonce to prevent replay attacks
    const updatedUser = await prisma.user.update({
      where: { address: normalizedAddress },
      data: {
        nonce: crypto.randomBytes(16).toString("hex"),
      },
      include: {
        vaults: true,
      },
    });

    // Create session cookie
    const response = NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id,
        address: updatedUser.address,
        vaults: updatedUser.vaults,
      },
    });

    response.cookies.set("rk_session_user", normalizedAddress, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Signature verification error:", error);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
