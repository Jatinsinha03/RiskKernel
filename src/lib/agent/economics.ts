import { ethers } from "ethers";
import { ChainService } from "./chain";
import { AgentConfig } from "./config";

export interface EconomicAssessment {
  passed: boolean;
  reason?: string;
  grossProfitUsdt: number;
  gasCostUsdt: number;
  netProfitUsdt: number;
  netProfitBps: number;
  onChainMinProfitRaw: bigint;
  minReturnRaw: bigint;
}

export class EconomicsService {
  private cachedHskUsdtPrice: number = 0.088; // fallback
  private lastPriceFetch: number = 0;

  constructor(private chain: ChainService, private config: AgentConfig) {}

  /**
   * Fetches the current live spot price of HSK in USDT
   */
  public async getHskUsdtPrice(): Promise<number> {
    const now = Date.now();
    if (now - this.lastPriceFetch < 30000 && this.cachedHskUsdtPrice > 0) {
      return this.cachedHskUsdtPrice;
    }

    try {
      // WHSK/USDT 0.3% pool: 0x4ff515761864e7838B0AdB8b5b2B8B7A068905dC
      const poolContract = this.chain.getPoolContract("0x4ff515761864e7838b0adb8b5b2b8b7a068905dc");
      const slot0 = await poolContract.slot0();
      const sqrtPriceX96 = BigInt(slot0.sqrtPriceX96.toString());

      // token0 = WHSK (18 decimals), token1 = USDT (6 decimals)
      const ratio = Number(sqrtPriceX96) / Math.pow(2, 96);
      const rawPrice = ratio * ratio;
      const price = rawPrice * Math.pow(10, 18 - 6);

      if (price > 0 && !isNaN(price)) {
        this.cachedHskUsdtPrice = price;
        this.lastPriceFetch = now;
        return price;
      }
    } catch (err) {
      console.warn("Could not fetch live HSK/USDT pool price, using cached:", err);
    }

    return this.cachedHskUsdtPrice;
  }

  /**
   * Evaluates the candidate against gas costs and profitability thresholds
   */
  public async assessEconomics(
    amountIn: bigint,
    grossProfitRaw: bigint,
    estimatedGasUnits: bigint
  ): Promise<EconomicAssessment> {
    const feeData = await this.chain.provider.getFeeData().catch(() => null);
    const gasPrice = feeData?.gasPrice || ethers.parseUnits("500", "gwei");

    const maxGasPrice = ethers.parseUnits(this.config.maxGasPriceGwei.toString(), "gwei");
    if (gasPrice > maxGasPrice) {
      return {
        passed: false,
        reason: `Gas price ${ethers.formatUnits(gasPrice, "gwei")} Gwei exceeds ceiling ${this.config.maxGasPriceGwei} Gwei`,
        grossProfitUsdt: 0,
        gasCostUsdt: 0,
        netProfitUsdt: 0,
        netProfitBps: 0,
        onChainMinProfitRaw: BigInt(0),
        minReturnRaw: amountIn,
      };
    }

    const hskPrice = await this.getHskUsdtPrice();

    // Gas in HSK = gasUnits * gasPrice
    const totalGasCostHskRaw = estimatedGasUnits * gasPrice;
    const totalGasCostHsk = Number(ethers.formatEther(totalGasCostHskRaw));
    const gasCostUsdt = totalGasCostHsk * hskPrice;

    const grossProfitUsdt = Number(ethers.formatUnits(grossProfitRaw, 6));
    const netProfitUsdt = grossProfitUsdt - gasCostUsdt;

    const amountInUsdt = Number(ethers.formatUnits(amountIn, 6));
    const netProfitBps = amountInUsdt > 0 ? Math.round((netProfitUsdt / amountInUsdt) * 10000) : 0;

    // 1. Gas safety multiplier check
    const requiredGrossProfit = gasCostUsdt * this.config.gasSafetyMultiplier;
    if (grossProfitUsdt < requiredGrossProfit) {
      return {
        passed: false,
        reason: `Gross profit ($${grossProfitUsdt.toFixed(4)}) is below required gas threshold ($${requiredGrossProfit.toFixed(4)})`,
        grossProfitUsdt,
        gasCostUsdt,
        netProfitUsdt,
        netProfitBps,
        onChainMinProfitRaw: BigInt(0),
        minReturnRaw: amountIn,
      };
    }

    // 2. Minimum net profit threshold
    if (netProfitUsdt < this.config.minNetProfitUsdt) {
      return {
        passed: false,
        reason: `Net profit ($${netProfitUsdt.toFixed(4)}) is below minimum ($${this.config.minNetProfitUsdt.toFixed(4)})`,
        grossProfitUsdt,
        gasCostUsdt,
        netProfitUsdt,
        netProfitBps,
        onChainMinProfitRaw: BigInt(0),
        minReturnRaw: amountIn,
      };
    }

    // 3. Compute on-chain minimum profit after haircut (e.g. 70%)
    const haircutFactor = BigInt(Math.round(this.config.profitHaircutPct * 1000));
    const onChainMinProfitRaw = (grossProfitRaw * haircutFactor) / BigInt(1000);

    // Invariant: minProfit must be strictly > 0 for executeArbitrage
    const finalMinProfitRaw = onChainMinProfitRaw > BigInt(0) ? onChainMinProfitRaw : BigInt(1);
    const minReturnRaw = amountIn + finalMinProfitRaw;

    return {
      passed: true,
      grossProfitUsdt,
      gasCostUsdt,
      netProfitUsdt,
      netProfitBps,
      onChainMinProfitRaw: finalMinProfitRaw,
      minReturnRaw,
    };
  }
}
