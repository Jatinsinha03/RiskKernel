import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { evaluatePolicyChange } from "@/lib/policy";
import { readVaultSummaryOnChain } from "@/lib/contracts/vaultContract";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const normalizedAddress = address.toLowerCase();

    let vault = await prisma.vault.findUnique({
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

    if (!vault) {
      try {
        const onChain = await readVaultSummaryOnChain(normalizedAddress);
        const ownerAddr = onChain.owner && onChain.owner !== "0x0000000000000000000000000000000000000000"
          ? onChain.owner.toLowerCase()
          : "0x0000000000000000000000000000000000000000";

        await prisma.user.upsert({
          where: { address: ownerAddr },
          update: {},
          create: { address: ownerAddr, nonce: Math.random().toString(36).substring(2) },
        });

        vault = await prisma.vault.create({
          data: {
            address: normalizedAddress,
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
          include: {
            events: true,
            opportunities: true,
            approvals: true,
          },
        });
      } catch (chainErr) {
        console.warn("Could not auto-create vault from chain:", chainErr);
      }
    }

    if (!vault) {
      return NextResponse.json({ error: "Vault not found" }, { status: 404 });
    }

    // Live on-chain read overlay
    try {
      const onChain = await readVaultSummaryOnChain(normalizedAddress);
      if (onChain) {
        vault.balance = onChain.balanceFormatted;
        vault.peakValue = onChain.peakFormatted;
        vault.status = onChain.frozen ? "FROZEN" : onChain.paused ? "PAUSED" : "ACTIVE";
        vault.maxDrawdownBps = onChain.mandate.maxDrawdownBps;
        vault.maxPositionSize = onChain.maxPositionFormatted;
        vault.maxDailyVolume = onChain.maxDailyVolumeFormatted;
        vault.maxSlippageBps = onChain.mandate.maxSlippageBps;
        vault.approvalThreshold = onChain.approvalThresholdFormatted;
        if (onChain.agent && onChain.agent !== "0x0000000000000000000000000000000000000000") {
          vault.agentAddress = onChain.agent.toLowerCase();
        }
      }
    } catch {
      // Fallback cleanly to DB cache
    }

    // Risk calculations
    const currentBalance = parseFloat(vault.balance) || 0;
    const peak = Math.max(parseFloat(vault.peakValue) || 0, currentBalance);
    const drawdownAmount = peak > 0 ? Math.max(0, peak - currentBalance) : 0;
    const drawdownPct = peak > 0 ? (drawdownAmount / peak) * 100 : 0;
    const maxDrawdownPct = vault.maxDrawdownBps / 100;
    const lossFloor = peak > 0 ? peak * (1 - maxDrawdownPct / 100) : 0;
    const distanceToFloor = peak > 0 ? Math.max(0, currentBalance - lossFloor) : 0;
    const distanceToFloorPct = peak > 0 ? (distanceToFloor / peak) * 100 : 100;
    const riskRatio = maxDrawdownPct > 0 ? (drawdownPct / maxDrawdownPct) * 100 : 0;

    return NextResponse.json({
      vault,
      metrics: {
        currentBalance,
        peak,
        drawdownAmount,
        drawdownPct: parseFloat(drawdownPct.toFixed(2)),
        maxDrawdownPct,
        lossFloor: parseFloat(lossFloor.toFixed(2)),
        distanceToFloor: parseFloat(distanceToFloor.toFixed(2)),
        distanceToFloorPct: parseFloat(distanceToFloorPct.toFixed(2)),
        riskRatio: Math.min(100, parseFloat(riskRatio.toFixed(1))),
        isBreakerTripped: vault.status === "FROZEN" || (peak > 0 && drawdownPct >= maxDrawdownPct),
      },
    });
  } catch (error) {
    console.error("Error fetching vault:", error);
    return NextResponse.json({ error: "Failed to fetch vault details" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const normalizedAddress = address.toLowerCase();
    const body = await req.json();

    const currentVault = await prisma.vault.findUnique({
      where: { address: normalizedAddress },
    });

    if (!currentVault) {
      return NextResponse.json({ error: "Vault not found" }, { status: 404 });
    }

    const { action } = body;

    // 1. Direct status toggle (Pause / Resume / Unfreeze)
    if (action === "SET_STATUS") {
      const { status, txHash } = body;
      const updated = await prisma.vault.update({
        where: { address: normalizedAddress },
        data: {
          status,
          ...(status === "ACTIVE" && currentVault.status === "FROZEN"
            ? { peakValue: currentVault.balance } // unfreeze resets peak to current balance per spec
            : {}),
        },
      });

      await prisma.activityEvent.create({
        data: {
          vaultAddress: normalizedAddress,
          eventType: status === "FROZEN" ? "CIRCUIT_BREAKER_TRIPPED" : status === "PAUSED" ? "PAUSED" : "UNPAUSED",
          txHash: txHash || `0x${Math.random().toString(16).substring(2).padEnd(64, "0")}`,
          blockNumber: 1000100,
          details: {
            previousStatus: currentVault.status,
            newStatus: status,
            balance: updated.balance,
          },
        },
      });

      return NextResponse.json({ success: true, vault: updated });
    }

    // 2. Deposit Funds
    if (action === "DEPOSIT") {
      const depositAmount = parseFloat(body.amount) || 0;
      const newBal = (parseFloat(currentVault.balance) + depositAmount).toString();
      const newPeak = (parseFloat(currentVault.peakValue) + depositAmount).toString();

      const updated = await prisma.vault.update({
        where: { address: normalizedAddress },
        data: {
          balance: newBal,
          peakValue: newPeak, // Spec 5.2: deposit raises peak value by same amount
        },
      });

      await prisma.activityEvent.create({
        data: {
          vaultAddress: normalizedAddress,
          eventType: "DEPOSIT",
          txHash: body.txHash || `0x${Math.random().toString(16).substring(2).padEnd(64, "0")}`,
          blockNumber: 1000200,
          details: {
            amount: depositAmount.toString(),
            symbol: currentVault.baseAssetSymbol,
            newBalance: newBal,
          },
        },
      });

      return NextResponse.json({ success: true, vault: updated });
    }

    // 3. Withdraw Funds (Always allowed even if frozen, lowers peak proportionally)
    if (action === "WITHDRAW") {
      const withdrawAmount = parseFloat(body.amount) || 0;
      const currentBal = parseFloat(currentVault.balance);
      const newBal = Math.max(0, currentBal - withdrawAmount).toString();

      // Spec: withdraw lowers peak value proportionally so withdrawing is never mistaken for a loss
      const ratio = currentBal > 0 ? (currentBal - withdrawAmount) / currentBal : 0;
      const newPeak = (parseFloat(currentVault.peakValue) * Math.max(0, ratio)).toString();

      const updated = await prisma.vault.update({
        where: { address: normalizedAddress },
        data: {
          balance: newBal,
          peakValue: newPeak,
        },
      });

      await prisma.activityEvent.create({
        data: {
          vaultAddress: normalizedAddress,
          eventType: "WITHDRAW",
          txHash: body.txHash || `0x${Math.random().toString(16).substring(2).padEnd(64, "0")}`,
          blockNumber: 1000210,
          details: {
            amount: withdrawAmount.toString(),
            symbol: currentVault.baseAssetSymbol,
            newBalance: newBal,
          },
        },
      });

      return NextResponse.json({ success: true, vault: updated });
    }

    // 4. Policy Change Proposal / Confirmation
    if (action === "SUBMIT_POLICY") {
      const proposed = body.proposedPolicy;
      const evaluation = evaluatePolicyChange(
        {
          maxDrawdownBps: currentVault.maxDrawdownBps,
          maxPositionSize: currentVault.maxPositionSize,
          maxDailyVolume: currentVault.maxDailyVolume,
          maxSlippageBps: currentVault.maxSlippageBps,
          approvalThreshold: currentVault.approvalThreshold,
          agentAddress: currentVault.agentAddress,
          allowedTokens: currentVault.allowedTokens,
          allowedPools: currentVault.allowedPools,
          allowedModules: currentVault.allowedModules,
        },
        proposed
      );

      if (evaluation.diffs.length === 0) {
        return NextResponse.json({ success: true, message: "No change", vault: currentVault });
      }

      // If all changes are safer -> applies immediately!
      if (evaluation.isAllSafer) {
        const updated = await prisma.vault.update({
          where: { address: normalizedAddress },
          data: {
            ...(proposed.maxDrawdownBps !== undefined ? { maxDrawdownBps: proposed.maxDrawdownBps } : {}),
            ...(proposed.maxPositionSize !== undefined ? { maxPositionSize: proposed.maxPositionSize.toString() } : {}),
            ...(proposed.maxDailyVolume !== undefined ? { maxDailyVolume: proposed.maxDailyVolume.toString() } : {}),
            ...(proposed.maxSlippageBps !== undefined ? { maxSlippageBps: proposed.maxSlippageBps } : {}),
            ...(proposed.approvalThreshold !== undefined ? { approvalThreshold: proposed.approvalThreshold.toString() } : {}),
            ...(proposed.agentAddress !== undefined ? { agentAddress: proposed.agentAddress } : {}),
            ...(proposed.allowedTokens ? { allowedTokens: proposed.allowedTokens } : {}),
            ...(proposed.allowedPools ? { allowedPools: proposed.allowedPools } : {}),
            ...(proposed.allowedModules ? { allowedModules: proposed.allowedModules } : {}),
            pendingPolicy: Prisma.DbNull, // clear any queued
          },
        });

        await prisma.activityEvent.create({
          data: {
            vaultAddress: normalizedAddress,
            eventType: "POLICY_UPDATE",
            txHash: body.txHash || `0x${Math.random().toString(16).substring(2).padEnd(64, "0")}`,
            blockNumber: 1000300,
            details: JSON.parse(JSON.stringify({
              diffs: evaluation.diffs,
              executionMode: "INSTANT_SAFER",
            })) as Prisma.InputJsonValue,
          },
        });

        return NextResponse.json({
          success: true,
          mode: "INSTANT",
          evaluation,
          vault: updated,
        });
      } else {
        // Any riskier -> queued behind timelock delay! (e.g. 5 minutes on testnet for demo)
        const delaySeconds = 300; // 5 min demo delay
        const unlockTimestamp = new Date(Date.now() + delaySeconds * 1000).toISOString();

        const pendingData = {
          proposedAt: new Date().toISOString(),
          unlockAt: unlockTimestamp,
          delaySeconds,
          diffs: evaluation.diffs,
          proposed,
        };

        const updated = await prisma.vault.update({
          where: { address: normalizedAddress },
          data: {
            pendingPolicy: JSON.parse(JSON.stringify(pendingData)) as Prisma.InputJsonValue,
          },
        });

        await prisma.activityEvent.create({
          data: {
            vaultAddress: normalizedAddress,
            eventType: "POLICY_QUEUED",
            txHash: body.txHash || `0x${Math.random().toString(16).substring(2).padEnd(64, "0")}`,
            blockNumber: 1000310,
            details: JSON.parse(JSON.stringify({
              diffs: evaluation.diffs,
              unlockAt: unlockTimestamp,
              executionMode: "QUEUED_TIMELOCK",
            })) as Prisma.InputJsonValue,
          },
        });

        return NextResponse.json({
          success: true,
          mode: "QUEUED_TIMELOCK",
          evaluation,
          vault: updated,
        });
      }
    }

    // 5. Cancel Queued Policy Change
    if (action === "CANCEL_PENDING_POLICY") {
      const updated = await prisma.vault.update({
        where: { address: normalizedAddress },
        data: { pendingPolicy: Prisma.DbNull },
      });

      await prisma.activityEvent.create({
        data: {
          vaultAddress: normalizedAddress,
          eventType: "POLICY_CANCELLED",
          txHash: body.txHash || `0x${Math.random().toString(16).substring(2).padEnd(64, "0")}`,
          blockNumber: 1000320,
          details: { cancelledBy: "owner" },
        },
      });

      return NextResponse.json({ success: true, vault: updated });
    }

    // 6. Apply Queued Policy Change (After timelock delay)
    if (action === "APPLY_PENDING_POLICY") {
      const pending = currentVault.pendingPolicy as {
        unlockAt?: string;
        proposed?: Record<string, unknown>;
        diffs?: unknown[];
      } | null;

      if (!pending || !pending.proposed) {
        return NextResponse.json({ error: "No pending policy change queued" }, { status: 400 });
      }

      if (pending.unlockAt && new Date(pending.unlockAt) > new Date()) {
        return NextResponse.json(
          { error: "Timelock delay has not elapsed yet" },
          { status: 400 }
        );
      }

      const p = pending.proposed;
      const updated = await prisma.vault.update({
        where: { address: normalizedAddress },
        data: {
          ...(p.maxDrawdownBps !== undefined ? { maxDrawdownBps: Number(p.maxDrawdownBps) } : {}),
          ...(p.maxPositionSize !== undefined ? { maxPositionSize: String(p.maxPositionSize) } : {}),
          ...(p.maxDailyVolume !== undefined ? { maxDailyVolume: String(p.maxDailyVolume) } : {}),
          ...(p.maxSlippageBps !== undefined ? { maxSlippageBps: Number(p.maxSlippageBps) } : {}),
          ...(p.approvalThreshold !== undefined ? { approvalThreshold: String(p.approvalThreshold) } : {}),
          ...(p.agentAddress !== undefined ? { agentAddress: String(p.agentAddress) } : {}),
          ...(Array.isArray(p.allowedTokens) ? { allowedTokens: p.allowedTokens as string[] } : {}),
          ...(Array.isArray(p.allowedPools) ? { allowedPools: p.allowedPools as string[] } : {}),
          ...(Array.isArray(p.allowedModules) ? { allowedModules: p.allowedModules as string[] } : {}),
          pendingPolicy: Prisma.DbNull,
        },
      });

      await prisma.activityEvent.create({
        data: {
          vaultAddress: normalizedAddress,
          eventType: "POLICY_UPDATE",
          txHash: body.txHash || `0x${Math.random().toString(16).substring(2).padEnd(64, "0")}`,
          blockNumber: 1000330,
          details: JSON.parse(JSON.stringify({
            diffs: pending.diffs || [],
            executionMode: "TIMELOCK_EXPIRED_APPLIED",
          })) as Prisma.InputJsonValue,
        },
      });

      return NextResponse.json({ success: true, vault: updated });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    console.error("Error updating vault:", error);
    return NextResponse.json({ error: "Failed to update vault" }, { status: 500 });
  }
}
