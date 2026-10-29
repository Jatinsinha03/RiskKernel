import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding Risk Kernel database...");

  const demoUserAddress = "0x71c5970c0c169222c0ad19a7719602c89280a8f4".toLowerCase();
  const demoVaultAddress = "0x82f4219460183e8fa573e04e908658826507c570".toLowerCase();
  const agentAddress = "0x3333333333333333333333333333333333333333".toLowerCase();

  // 1. User
  const user = await prisma.user.upsert({
    where: { address: demoUserAddress },
    update: {},
    create: {
      address: demoUserAddress,
      nonce: "seed-nonce-xyz-12345",
    },
  });

  const mainnetVaultAddress = "0x96569fFcb348670f39568AAda596e8f2775310Fd".toLowerCase();

  // 2. Mainnet Vault
  const mainnetVault = await prisma.vault.upsert({
    where: { address: mainnetVaultAddress },
    update: {
      baseAsset: "0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029",
      maxDrawdownBps: 300,
      maxSlippageBps: 100,
      maxPositionSize: "10",
      maxDailyVolume: "30",
      approvalThreshold: "Off",
      allowedTokens: ["0xB210D2120d57b758EE163cFfb43e73728c471Cf1"],
      allowedPools: ["0x56d15cF00b5D853D6eE4CbB1463E6DAD2899fBf5"],
    },
    create: {
      address: mainnetVaultAddress,
      ownerAddress: demoUserAddress,
      baseAsset: "0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029",
      baseAssetSymbol: "USDT",
      baseAssetDecimals: 6,
      createdBlock: 1,
      status: "ACTIVE",
      balance: "0",
      peakValue: "0",
      maxDrawdownBps: 300, // 3%
      maxPositionSize: "10", // 10,000,000 base units = 10 USDT
      maxDailyVolume: "30", // 30,000,000 base units = 30 USDT
      dailyVolumeUsed: "0",
      maxSlippageBps: 100, // 1.0%
      approvalThreshold: "Off", // Max uint128
      agentAddress,
      allowedTokens: ["0xB210D2120d57b758EE163cFfb43e73728c471Cf1"],
      allowedPools: ["0x56d15cF00b5D853D6eE4CbB1463E6DAD2899fBf5"],
      allowedModules: [],
    },
  });

  // 3. Demo Vault Fallback
  const vault = await prisma.vault.upsert({
    where: { address: demoVaultAddress },
    update: {},
    create: {
      address: demoVaultAddress,
      ownerAddress: demoUserAddress,
      baseAsset: "0x55d398326f99059fF775485246999027B3197955",
      baseAssetSymbol: "USDT",
      baseAssetDecimals: 6,
      createdBlock: 1254300,
      status: "ACTIVE",
      balance: "10250.00",
      peakValue: "10250.00",
      maxDrawdownBps: 500, // 5%
      maxPositionSize: "1000",
      maxDailyVolume: "5000",
      dailyVolumeUsed: "1850",
      maxSlippageBps: 50, // 0.5%
      approvalThreshold: "2500",
      agentAddress,
      allowedTokens: ["USDT", "HSK", "WETH"],
      allowedPools: ["0xPoolHSKUSDT", "0xPoolWETHUSDT"],
      allowedModules: ["0xBasicSwapModuleTestnet"],
    },
  });

  // 3. Activity Events
  await prisma.activityEvent.deleteMany({ where: { vaultAddress: demoVaultAddress } });
  
  await prisma.activityEvent.createMany({
    data: [
      {
        vaultAddress: demoVaultAddress,
        eventType: "VAULT_CREATED",
        txHash: "0x3f5b72e19a48bb208fa75e631df6812d46eef833198f86cb321a63df9972c81a",
        blockNumber: 1254300,
        timestamp: new Date(Date.now() - 86400000 * 2),
        details: {
          creator: demoUserAddress,
          baseAsset: "USDT",
          initialPolicy: "5% Max Drawdown, 1000 USDT position cap",
        },
      },
      {
        vaultAddress: demoVaultAddress,
        eventType: "DEPOSIT",
        txHash: "0x892a019ef79227f290d291ba458129ca08191cb82910fa8319ba908129ca0819",
        blockNumber: 1254350,
        timestamp: new Date(Date.now() - 86400000 * 2 + 3600000),
        details: {
          amount: "10000.00",
          symbol: "USDT",
          newBalance: "10000.00",
        },
      },
      {
        vaultAddress: demoVaultAddress,
        eventType: "AGENT_GRANTED",
        txHash: "0x123a019ef79227f290d291ba458129ca08191cb82910fa8319ba908129ca0819",
        blockNumber: 1254400,
        timestamp: new Date(Date.now() - 86400000 * 1.5),
        details: {
          agent: agentAddress,
          status: "Authorized for execution within limits",
        },
      },
      {
        vaultAddress: demoVaultAddress,
        eventType: "TRADE_EXECUTED",
        txHash: "0x777a019ef79227f290d291ba458129ca08191cb82910fa8319ba908129ca0819",
        blockNumber: 1255100,
        timestamp: new Date(Date.now() - 86400000 * 1),
        details: {
          route: ["USDT", "HSK", "USDT"],
          tradeAmount: "850.00 USDT",
          returnAmount: "868.50 USDT",
          netProfit: "+18.50 USDT (+2.17%)",
          executor: "BasicSwapModule",
        },
      },
      {
        vaultAddress: demoVaultAddress,
        eventType: "TRADE_EXECUTED",
        txHash: "0x999a019ef79227f290d291ba458129ca08191cb82910fa8319ba908129ca0819",
        blockNumber: 1256200,
        timestamp: new Date(Date.now() - 3600000 * 4),
        details: {
          route: ["USDT", "WETH", "USDT"],
          tradeAmount: "1000.00 USDT",
          returnAmount: "1023.20 USDT",
          netProfit: "+23.20 USDT (+2.32%)",
          executor: "BasicSwapModule",
        },
      },
    ],
  });

  // 4. Sample Opportunities
  await prisma.opportunity.deleteMany({ where: { vaultAddress: demoVaultAddress } });

  const opp1 = await prisma.opportunity.create({
    data: {
      vaultAddress: demoVaultAddress,
      route: ["USDT", "HSK", "USDT"],
      tradeAmount: "950.00",
      estimatedProfit: "14.25",
      netProfitBps: 150, // 1.5%
      minProfit: "8.00",
      gasEstimate: "0.0018 HSK",
      status: "COMPLETED",
      reason: "Cycle executed successfully on HSKSwap pools",
    },
  });

  const opp2 = await prisma.opportunity.create({
    data: {
      vaultAddress: demoVaultAddress,
      route: ["USDT", "WETH", "HSK", "USDT"],
      tradeAmount: "3200.00", // Exceeds 2,500 USDT threshold -> triggers approval!
      estimatedProfit: "68.80",
      netProfitBps: 215, // 2.15%
      minProfit: "45.00",
      gasEstimate: "0.0035 HSK",
      status: "PENDING",
      reason: "Triangular spread detected across HSKSwap V2 and V3 pools",
    },
  });

  // 5. Human-in-the-loop Approval Request
  await prisma.approvalRequest.deleteMany({ where: { vaultAddress: demoVaultAddress } });

  await prisma.approvalRequest.create({
    data: {
      vaultAddress: demoVaultAddress,
      opportunityId: opp2.id,
      tradeAmount: "3200.00",
      summary: "High-value triangular arbitrage (USDT → WETH → HSK → USDT). Trade size (3,200 USDT) exceeds your 2,500 USDT autonomy threshold.",
      expiry: new Date(Date.now() + 3600000 * 12), // 12 hours from now
      status: "PENDING",
      nonce: "rk-auth-nonce-7890",
    },
  });

  // 6. Indexer Cursor
  await prisma.indexerCursor.upsert({
    where: { chainId: 133 },
    update: { lastProcessedBlock: 1256500 },
    create: { chainId: 133, lastProcessedBlock: 1256500 },
  });

  console.log("Database seeded successfully with demo vault:", vault.address);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
