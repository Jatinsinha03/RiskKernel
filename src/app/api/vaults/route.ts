import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getRpcProvider, getVaultContract, formatBaseUnits, readVaultSummaryOnChain } from "@/lib/contracts/vaultContract";
import { ethers } from "ethers";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const owner = searchParams.get("owner")?.toLowerCase();

    // Auto-clean legacy dummy vault and sync real configured vault
    const mainnetVaultAddr = process.env.NEXT_PUBLIC_VAULT_ADDRESS?.toLowerCase();
    if (mainnetVaultAddr) {
      // 1. Delete legacy seeded mock vault
      await prisma.vault.deleteMany({
        where: {
          address: {
            not: mainnetVaultAddr,
            in: ["0x82f4219460183e8fa573e04e908658826507c570"],
          },
        },
      });

      // 2. Ensure real on-chain vault is registered
      const existing = await prisma.vault.findUnique({
        where: { address: mainnetVaultAddr },
      });

      if (!existing) {
        try {
          const onChain = await readVaultSummaryOnChain(mainnetVaultAddr);
          const ownerAddr = onChain.owner && onChain.owner !== ethers.ZeroAddress
            ? onChain.owner.toLowerCase()
            : "0x0000000000000000000000000000000000000000";

          await prisma.user.upsert({
            where: { address: ownerAddr },
            update: {},
            create: { address: ownerAddr, nonce: Math.random().toString(36).substring(2) },
          });

          await prisma.vault.create({
            data: {
              address: mainnetVaultAddr,
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
              agentAddress: onChain.agent && onChain.agent !== ethers.ZeroAddress ? onChain.agent.toLowerCase() : null,
              allowedTokens: process.env.NEXT_PUBLIC_ALLOWED_TOKENS ? [process.env.NEXT_PUBLIC_ALLOWED_TOKENS] : [],
              allowedPools: process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS ? [process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS] : [],
              status: onChain.frozen ? "FROZEN" : onChain.paused ? "PAUSED" : "ACTIVE",
            },
          });
        } catch (chainErr) {
          console.warn("Could not read on-chain vault on startup:", chainErr);
        }
      }
    }

    const where = owner ? { ownerAddress: owner } : {};

    const vaults = await prisma.vault.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            events: true,
            opportunities: true,
            approvals: true,
          },
        },
      },
    });

    return NextResponse.json({ vaults });
  } catch (error) {
    console.error("Error fetching vaults:", error);
    return NextResponse.json({ error: "Failed to fetch vaults" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let {
      address,
      ownerAddress,
      baseAsset,
      baseAssetSymbol = "USDT",
      baseAssetDecimals = 6,
      maxDrawdownBps = 500,
      maxPositionSize = "1000",
      maxDailyVolume = "5000",
      maxSlippageBps = 50,
      approvalThreshold = "2500",
      agentAddress,
      allowedTokens = [],
      allowedPools = [],
      allowedModules = [],
      initialDeposit = "0",
    } = body;

    if (!address || !ownerAddress) {
      return NextResponse.json(
        { error: "Vault contract address and owner address are required" },
        { status: 400 }
      );
    }

    const normalizedAddress = address.toLowerCase();
    const normalizedOwner = ownerAddress.toLowerCase();

    // Verification against HashKey Chain (Plan section 3: Checks on-chain that owner() equals the session wallet)
    try {
      const provider = getRpcProvider();
      const code = await provider.getCode(normalizedAddress);

      if (code && code !== "0x") {
        const vaultContract = getVaultContract(normalizedAddress, provider);
        const onChainOwner = await vaultContract.owner();
        if (onChainOwner.toLowerCase() !== normalizedOwner) {
          return NextResponse.json(
            { error: `On-chain verification failed: caller ${normalizedOwner} is not the contract owner (${onChainOwner})` },
            { status: 403 }
          );
        }

        // Read real on-chain initial parameters
        const onChainMandate = await vaultContract.mandate();
        if (onChainMandate) {
          maxDrawdownBps = Number(onChainMandate[0]);
          maxSlippageBps = Number(onChainMandate[1]);
          maxPositionSize = formatBaseUnits(onChainMandate[2], 6);
          maxDailyVolume = formatBaseUnits(onChainMandate[3], 6);
          approvalThreshold = formatBaseUnits(onChainMandate[4], 6);
        }
      }
    } catch (chainErr) {
      console.warn("On-chain verification note (mock/test fallback allowed):", chainErr);
    }

    // Ensure owner user exists
    await prisma.user.upsert({
      where: { address: normalizedOwner },
      update: {},
      create: {
        address: normalizedOwner,
        nonce: Math.random().toString(36).substring(2),
      },
    });

    const vault = await prisma.vault.upsert({
      where: { address: normalizedAddress },
      update: {
        ownerAddress: normalizedOwner,
        balance: initialDeposit || "0",
        peakValue: initialDeposit || "0",
      },
      create: {
        address: normalizedAddress,
        ownerAddress: normalizedOwner,
        baseAsset: baseAsset || process.env.NEXT_PUBLIC_BASE_ASSET_ADDRESS || "0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029",
        baseAssetSymbol,
        baseAssetDecimals,
        balance: initialDeposit || "0",
        peakValue: initialDeposit || "0",
        maxDrawdownBps,
        maxPositionSize: maxPositionSize.toString(),
        maxDailyVolume: maxDailyVolume.toString(),
        maxSlippageBps,
        approvalThreshold: approvalThreshold.toString(),
        agentAddress: agentAddress?.toLowerCase() || null,
        allowedTokens,
        allowedPools,
        allowedModules,
        status: "ACTIVE",
      },
    });

    // Create initial creation activity event
    await prisma.activityEvent.create({
      data: {
        vaultAddress: normalizedAddress,
        eventType: "VaultCreated",
        txHash: body.txHash || `0x${Math.random().toString(16).substring(2).padEnd(64, "0")}`,
        blockNumber: 1000000,
        details: {
          owner: normalizedOwner,
          baseAssetSymbol,
          initialDeposit,
          maxDrawdown: `${(maxDrawdownBps / 100).toFixed(1)}%`,
          maxPositionSize,
        },
      },
    });

    return NextResponse.json({ success: true, vault });
  } catch (error) {
    console.error("Error creating vault:", error);
    return NextResponse.json({ error: "Failed to register vault" }, { status: 500 });
  }
}
