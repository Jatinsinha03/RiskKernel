import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { evaluatePolicyChange } from "@/lib/policy";
import { readVaultSummaryOnChain } from "@/lib/contracts/vaultContract";

interface ChatPayload {
  message: string;
  vaultAddress?: string;
  userAddress?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { message, vaultAddress, userAddress }: ChatPayload = await req.json();

    if (!message || !message.trim()) {
      return NextResponse.json({ error: "Message cannot be empty" }, { status: 400 });
    }

    const normalizedVault = (vaultAddress || process.env.NEXT_PUBLIC_VAULT_ADDRESS)?.toLowerCase();
    const normalizedUser = userAddress?.toLowerCase() || "0x0000000000000000000000000000000000000000";

    // Ensure user exists in database to avoid foreign key constraint violations
    await prisma.user.upsert({
      where: { address: normalizedUser },
      update: {},
      create: {
        address: normalizedUser,
        nonce: Math.random().toString(36).substring(2),
      },
    });

    // Save user message to database
    await prisma.chatMessage.create({
      data: {
        userAddress: normalizedUser,
        vaultAddress: normalizedVault || null,
        role: "user",
        content: message.trim(),
      },
    });

    // Fetch vault data if provided or configured
    let vaultData = null;
    let metrics = null;
    if (normalizedVault) {
      vaultData = await prisma.vault.findUnique({
        where: { address: normalizedVault },
        include: {
          events: { orderBy: { timestamp: "desc" }, take: 5 },
        },
      });

      // Auto-recover from on-chain if missing in database
      if (!vaultData) {
        try {
          const onChain = await readVaultSummaryOnChain(normalizedVault);
          const ownerAddr = onChain.owner && onChain.owner !== "0x0000000000000000000000000000000000000000"
            ? onChain.owner.toLowerCase()
            : normalizedUser;

          await prisma.user.upsert({
            where: { address: ownerAddr },
            update: {},
            create: { address: ownerAddr, nonce: Math.random().toString(36).substring(2) },
          });

          vaultData = await prisma.vault.create({
            data: {
              address: normalizedVault,
              ownerAddress: ownerAddr,
              baseAsset: onChain.baseAsset || process.env.NEXT_PUBLIC_BASE_ASSET_ADDRESS || "0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029",
              baseAssetSymbol: onChain.baseAssetSymbol || "USDT",
              baseAssetDecimals: onChain.baseAssetDecimals || 6,
              balance: onChain.balanceFormatted,
              peakValue: onChain.peakFormatted,
              maxDrawdownBps: onChain.mandate.maxDrawdownBps,
              maxPositionSize: onChain.maxPositionFormatted,
              maxDailyVolume: onChain.maxDailyVolumeFormatted,
              maxSlippageBps: onChain.mandate.maxSlippageBps,
              approvalThreshold: onChain.approvalThresholdFormatted,
              agentAddress: onChain.agent && onChain.agent !== "0x0000000000000000000000000000000000000000" ? onChain.agent.toLowerCase() : null,
              allowedTokens: process.env.NEXT_PUBLIC_ALLOWED_TOKENS ? [process.env.NEXT_PUBLIC_ALLOWED_TOKENS] : [],
              allowedPools: process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS ? [process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS] : [],
              status: onChain.frozen ? "FROZEN" : onChain.paused ? "PAUSED" : "ACTIVE",
            },
            include: { events: true },
          });
        } catch (chainErr) {
          console.warn("Could not sync vault from chain for chat:", chainErr);
        }
      }

      if (vaultData) {
        const bal = parseFloat(vaultData.balance) || 0;
        const peak = Math.max(parseFloat(vaultData.peakValue) || 0, bal);
        const dd = peak > 0 ? Math.max(0, peak - bal) : 0;
        const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
        const maxDdPct = vaultData.maxDrawdownBps / 100;
        const floor = peak > 0 ? peak * (1 - maxDdPct / 100) : 0;

        metrics = {
          currentBalance: `${bal.toFixed(2)} ${vaultData.baseAssetSymbol}`,
          peakValue: `${peak.toFixed(2)} ${vaultData.baseAssetSymbol}`,
          drawdownPct: `${ddPct.toFixed(2)}%`,
          maxDrawdownPct: `${maxDdPct.toFixed(1)}%`,
          lossFloor: `${floor.toFixed(2)} ${vaultData.baseAssetSymbol}`,
          status: vaultData.status,
          approvalThreshold: vaultData.approvalThreshold === "Off" ? "Off" : `${vaultData.approvalThreshold} ${vaultData.baseAssetSymbol}`,
          maxPositionSize: `${vaultData.maxPositionSize} ${vaultData.baseAssetSymbol}`,
          maxDailyVolume: `${vaultData.maxDailyVolume} ${vaultData.baseAssetSymbol}`,
        };
      }
    }

    const lower = message.toLowerCase();
    let replyText = "";
    let proposedDiff = null;

    // Detect if Gemini API Key is configured
    const apiKey = process.env.GEMINI_API_KEY;

    if (apiKey) {
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      text: `You are the Risk Kernel AI Copilot for HashKey Chain.
Vault Address: ${normalizedVault || "None"}
Vault Metrics: ${JSON.stringify(metrics || {})}
Vault Mandate: ${JSON.stringify(vaultData ? {
  maxDrawdownFloor: `${(vaultData.maxDrawdownBps / 100).toFixed(1)}%`,
  maxPositionSize: `${vaultData.maxPositionSize} USDT`,
  maxDailyVolume: `${vaultData.maxDailyVolume} USDT`,
  approvalThreshold: vaultData.approvalThreshold,
  agent: vaultData.agentAddress || "None",
} : {})}
Rules:
1. Always base all figures strictly on the context provided above.
2. If the user asks about withdrawing, remind them that you maintain 0 direct custody and they can execute withdrawals anytime via the Dashboard with MetaMask.
3. Keep answers concise, factual, and security-focused.
User Message: "${message}"`,
                    },
                  ],
                },
              ],
            }),
          }
        );

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const candidate = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidate) {
            replyText = candidate.trim();
          }
        }
      } catch (e) {
        console.warn("Gemini API call failed, falling back to local analysis:", e);
      }
    }

    // Deterministic policy diff proposer
    if (
      !replyText ||
      lower.includes("conservative") ||
      lower.includes("tighten") ||
      lower.includes("drawdown") ||
      lower.includes("loosen") ||
      lower.includes("threshold") ||
      lower.includes("withdraw everything") ||
      lower.includes("status") ||
      lower.includes("balance")
    ) {
      if (lower.includes("withdraw everything") || lower.includes("withdraw all")) {
        replyText = `As an AI copilot, I **cannot move funds or withdraw money** directly. You maintain sole custody of your assets. To withdraw your full balance, click the **Emergency Withdraw** button on the dashboard to sign the withdrawal transaction via MetaMask.`;
      } else if (lower.includes("conservative") || lower.includes("tighten") || lower.includes("safer")) {
        if (vaultData) {
          const currentPos = parseFloat(vaultData.maxPositionSize) || 10;
          const newDrawdown = Math.max(100, Math.round(vaultData.maxDrawdownBps * 0.6)); // e.g. 300 bps (3%) -> 180 bps (1.8%)
          const newPos = Math.max(1, Math.round(currentPos * 0.5)); // e.g. 10 USDT -> 5 USDT
          const newThreshold = vaultData.approvalThreshold === "Off" ? "Off" : Math.max(1, Math.round(parseFloat(vaultData.approvalThreshold) * 0.6)).toString();

          const evaluation = evaluatePolicyChange(
            {
              maxDrawdownBps: vaultData.maxDrawdownBps,
              maxPositionSize: vaultData.maxPositionSize,
              maxDailyVolume: vaultData.maxDailyVolume,
              maxSlippageBps: vaultData.maxSlippageBps,
              approvalThreshold: vaultData.approvalThreshold,
              agentAddress: vaultData.agentAddress,
            },
            {
              maxDrawdownBps: newDrawdown,
              maxPositionSize: newPos.toString(),
              approvalThreshold: newThreshold,
            }
          );

          proposedDiff = {
            evaluation,
            proposedPolicy: {
              maxDrawdownBps: newDrawdown,
              maxPositionSize: newPos.toString(),
              maxDailyVolume: vaultData.maxDailyVolume,
              maxSlippageBps: vaultData.maxSlippageBps,
              approvalThreshold: newThreshold,
              agentAddress: vaultData.agentAddress,
            },
          };

          replyText = `I have drafted a more conservative mandate for your vault on HashKey Chain.

Here is the proposed policy diff:
- **Max Drawdown Floor:** ${(vaultData.maxDrawdownBps / 100).toFixed(1)}% → ${(newDrawdown / 100).toFixed(1)}% (Safer)
- **Max Position Size:** ${vaultData.maxPositionSize} USDT → ${newPos} USDT (Safer)
- **Approval Threshold:** ${vaultData.approvalThreshold} → ${newThreshold}

Because all modifications strictly tighten risk boundaries, this policy is classified as **SAFER** and will apply **instantly** once confirmed in MetaMask.`;
        } else {
          replyText = `Please select or connect a vault first so I can retrieve your current mandate and draft the appropriate diff.`;
        }
      } else if (lower.includes("loosen") || lower.includes("riskier") || lower.includes("increase position")) {
        if (vaultData) {
          const currentPos = parseFloat(vaultData.maxPositionSize) || 10;
          const newPos = Math.round(currentPos * 1.5); // e.g. 10 USDT -> 15 USDT
          const evaluation = evaluatePolicyChange(
            {
              maxDrawdownBps: vaultData.maxDrawdownBps,
              maxPositionSize: vaultData.maxPositionSize,
              maxDailyVolume: vaultData.maxDailyVolume,
              maxSlippageBps: vaultData.maxSlippageBps,
              approvalThreshold: vaultData.approvalThreshold,
              agentAddress: vaultData.agentAddress,
            },
            {
              maxPositionSize: newPos.toString(),
            }
          );

          proposedDiff = {
            evaluation,
            proposedPolicy: {
              maxDrawdownBps: vaultData.maxDrawdownBps,
              maxPositionSize: newPos.toString(),
              maxDailyVolume: vaultData.maxDailyVolume,
              maxSlippageBps: vaultData.maxSlippageBps,
              approvalThreshold: vaultData.approvalThreshold,
              agentAddress: vaultData.agentAddress,
            },
          };

          replyText = `You requested loosening your position cap to **${newPos} USDT**.

⚠️ **Riskier Policy Notice:**
Because this increases your single-trade exposure, Risk Kernel invariants require this change to be **QUEUED in a timelock delay**. You will have the opportunity to cancel this queued change anytime before activation.`;
        }
      } else if (lower.includes("status") || lower.includes("balance") || lower.includes("how is")) {
        if (metrics) {
          replyText = `**Current Vault Status on HashKey Chain:**
- **Status:** ${metrics.status}
- **Current Balance:** ${metrics.currentBalance}
- **Peak Portfolio Value:** ${metrics.peakValue}
- **Current Drawdown:** ${metrics.drawdownPct} (Limit: ${metrics.maxDrawdownPct})
- **Circuit Breaker Loss Floor:** ${metrics.lossFloor}
- **Autonomous Agent Position Cap:** ${metrics.maxPositionSize}
- **Daily Volume Limit:** ${metrics.maxDailyVolume}
- **Human Approval Threshold:** ${metrics.approvalThreshold}`;
        } else {
          replyText = `Your wallet has no active vault loaded. You can create a new vault using the Onboarding Wizard on the dashboard.`;
        }
      } else if (!replyText) {
        replyText = `I am your Risk Kernel AI Copilot. You can ask me to:
- Show your current vault balance and loss-floor distance
- **"Be more conservative"** or **"Tighten drawdown"** to generate a signed policy diff
- Ask how the circuit breaker and timelock delays protect your capital
- Check pending approvals requiring your EIP-712 signature`;
      }
    }

    // Save assistant response
    const assistantMessage = await prisma.chatMessage.create({
      data: {
        userAddress: normalizedUser,
        vaultAddress: normalizedVault || null,
        role: "assistant",
        content: replyText,
        diffData: proposedDiff ? JSON.parse(JSON.stringify(proposedDiff)) : null,
      },
    });

    return NextResponse.json({
      role: "assistant",
      content: replyText,
      diffData: proposedDiff,
      id: assistantMessage.id,
      createdAt: assistantMessage.createdAt,
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json({ error: "Failed to process chat message" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const vaultAddress = searchParams.get("vaultAddress")?.toLowerCase();
    const userAddress = searchParams.get("userAddress")?.toLowerCase();

    const where: Record<string, unknown> = {};
    if (vaultAddress) where.vaultAddress = vaultAddress;
    if (userAddress) where.userAddress = userAddress;

    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: 50,
    });

    return NextResponse.json({ messages });
  } catch (error) {
    console.error("Error fetching chat messages:", error);
    return NextResponse.json({ error: "Failed to load chat history" }, { status: 500 });
  }
}
