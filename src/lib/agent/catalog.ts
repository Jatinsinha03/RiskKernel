import prisma from "@/lib/prisma";
import { ChainService } from "./chain";
import { AgentConfig } from "./config";
import { ethers } from "ethers";

export interface DiscoveredPool {
  address: string;
  token0: string;
  token1: string;
  feeTier: number;
  liquidity: bigint;
  sqrtPriceX96: bigint;
  tick: number;
  price0: string; // Token1 per Token0
  price1: string; // Token0 per Token1
}

export class CatalogService {
  private lastDiscoveryAt: number = 0;
  private readonly DISCOVERY_INTERVAL_MS = 180000; // 3 minutes

  constructor(private chain: ChainService, private config: AgentConfig) {}

  /**
   * Initializes default tokens (USDT, WHSK) and runs pool discovery
   */
  /**
   * Initializes default tokens (USDT, WHSK) and dynamically registers any configured tokens from env & vaults
   */
  public async ensureCatalog(): Promise<void> {
    const defaultTokens = [
      {
        address: this.config.baseAssetAddress.toLowerCase(),
        symbol: "USDT",
        decimals: 6,
      },
      {
        address: "0xb210d2120d57b758ee163cffb43e73728c471cf1", // WHSK
        symbol: "WHSK",
        decimals: 18,
      },
    ];

    for (const t of defaultTokens) {
      await prisma.token.upsert({
        where: { address: t.address },
        update: { enabled: true },
        create: {
          address: t.address,
          symbol: t.symbol,
          decimals: t.decimals,
          enabled: true,
        },
      });
    }

    // Collect all configured allowed tokens from .env
    const envTokens = (process.env.NEXT_PUBLIC_ALLOWED_TOKENS || "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => ethers.isAddress(t));

    // Collect all tokens whitelisted across vaults in the database
    const vaults = await prisma.vault.findMany({ select: { allowedTokens: true } });
    const vaultTokens = vaults.flatMap((v) => v.allowedTokens).map((t) => t.toLowerCase());

    const allTokensToEnsure = Array.from(
      new Set([...defaultTokens.map((d) => d.address), ...envTokens, ...vaultTokens])
    );

    for (const addr of allTokensToEnsure) {
      const existing = await prisma.token.findUnique({ where: { address: addr } });
      if (!existing) {
        await this.registerToken(addr);
      }
    }

    const now = Date.now();
    if (now - this.lastDiscoveryAt > this.DISCOVERY_INTERVAL_MS) {
      await this.discoverPools();
      this.lastDiscoveryAt = now;
    }
  }

  /**
   * Registers a new ERC-20 token on-chain by address, reads symbol & decimals, and discovers pools
   */
  public async registerToken(
    tokenAddress: string
  ): Promise<{ address: string; symbol: string; decimals: number } | null> {
    const normalized = tokenAddress.toLowerCase().trim();
    if (!ethers.isAddress(normalized)) {
      throw new Error(`Invalid EVM token address: ${tokenAddress}`);
    }

    try {
      const erc20 = this.chain.getErc20Contract(normalized);
      const [symbol, decimals, name] = await Promise.all([
        erc20.symbol().catch(() => "UNKNOWN"),
        erc20.decimals().catch(() => 18),
        erc20.name().catch(() => null),
      ]);

      const record = await prisma.token.upsert({
        where: { address: normalized },
        update: {
          symbol: String(symbol),
          decimals: Number(decimals),
          name: name ? String(name) : undefined,
          enabled: true,
        },
        create: {
          address: normalized,
          symbol: String(symbol),
          decimals: Number(decimals),
          name: name ? String(name) : undefined,
          enabled: true,
        },
      });

      console.log(`[Catalog] Registered token ${record.symbol} (${record.address}) with ${record.decimals} decimals`);
      await this.discoverPools();

      return {
        address: record.address,
        symbol: record.symbol,
        decimals: record.decimals,
      };
    } catch (err) {
      console.error(`Could not register token ${tokenAddress}:`, err);
      return null;
    }
  }

  /**
   * Discovers Uniswap V3 pools from the factory across fee tiers
   */
  public async discoverPools(): Promise<DiscoveredPool[]> {
    const tokens = await prisma.token.findMany({ where: { enabled: true } });
    const factory = this.chain.getFactoryContract();
    const feeTiers = [100, 500, 3000, 10000];

    const discovered: DiscoveredPool[] = [];

    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const tokenA = tokens[i];
        const tokenB = tokens[j];

        for (const fee of feeTiers) {
          try {
            const poolAddress = await factory.getPool(tokenA.address, tokenB.address, fee);
            if (!poolAddress || poolAddress === ethers.ZeroAddress) continue;

            const poolContract = this.chain.getPoolContract(poolAddress);
            const [slot0, liquidity] = await Promise.all([
              poolContract.slot0().catch(() => null),
              poolContract.liquidity().catch(() => BigInt(0)),
            ]);

            if (!slot0) continue;

            const sqrtPriceX96 = BigInt(slot0.sqrtPriceX96.toString());
            const tick = Number(slot0.tick);
            const liq = BigInt(liquidity.toString());

            // Order tokens canonically
            const [token0, token1] =
              tokenA.address.toLowerCase() < tokenB.address.toLowerCase()
                ? [tokenA, tokenB]
                : [tokenB, tokenA];

            // Approximate price calculation: (sqrtPrice / 2^96)^2 * 10^(decimals0 - decimals1)
            const ratio = Number(sqrtPriceX96) / Math.pow(2, 96);
            const rawPrice = ratio * ratio;
            const decimalFactor = Math.pow(10, token0.decimals - token1.decimals);
            const price0 = (rawPrice * decimalFactor).toString();
            const price1 = (1 / (rawPrice * decimalFactor || 1)).toString();

            await prisma.pool.upsert({
              where: { address: poolAddress.toLowerCase() },
              update: {
                liquidity: liq.toString(),
                price0,
                price1,
                lastSeen: new Date(),
                enabled: liq > BigInt(0),
              },
              create: {
                address: poolAddress.toLowerCase(),
                token0: token0.address.toLowerCase(),
                token1: token1.address.toLowerCase(),
                feeTier: fee,
                liquidity: liq.toString(),
                price0,
                price1,
                enabled: liq > BigInt(0),
              },
            });

            discovered.push({
              address: poolAddress.toLowerCase(),
              token0: token0.address.toLowerCase(),
              token1: token1.address.toLowerCase(),
              feeTier: fee,
              liquidity: liq,
              sqrtPriceX96,
              tick,
              price0,
              price1,
            });
          } catch (poolErr) {
            console.warn(`Could not query pool for ${tokenA.symbol}/${tokenB.symbol} fee ${fee}:`, poolErr);
          }
        }
      }
    }

    return discovered;
  }

  /**
   * Fetches active pools from database
   */
  public async getActivePools(): Promise<Array<{
    address: string;
    token0: string;
    token1: string;
    feeTier: number;
    liquidity: string;
    price0: string | null;
    price1: string | null;
  }>> {
    return prisma.pool.findMany({
      where: { enabled: true },
    });
  }
}
