import { StepStruct } from "./chain";
import { ActiveVaultContext } from "./registry";
import { AgentConfig } from "./config";

export interface CandidateCycle {
  id: string;
  name: string;
  steps: StepStruct[];
  tokens: string[];
  totalFeeBps: number;
  theoreticalEdgeBps: number;
}

interface PoolRecord {
  address: string;
  token0: string;
  token1: string;
  feeTier: number;
  liquidity: string;
  price0: string | null;
  price1: string | null;
}

export class ScannerService {
  constructor(private config: AgentConfig) {}

  /**
   * Generates candidate trading cycles permitted by the target vault
   */
  public generateCandidates(
    vault: ActiveVaultContext,
    pools: PoolRecord[]
  ): CandidateCycle[] {
    const base = this.config.baseAssetAddress.toLowerCase();
    const router = this.config.routerAddress.toLowerCase();

    // Verify router is allowed
    if (!vault.allowedRouters.includes(router)) {
      return [];
    }

    // Filter pools containing only tokens allowed by the vault
    const validPools = pools.filter((p) => {
      const t0 = p.token0.toLowerCase();
      const t1 = p.token1.toLowerCase();
      const hasLiq = BigInt(p.liquidity || "0") > BigInt(0);
      return hasLiq && vault.allowedTokens.includes(t0) && vault.allowedTokens.includes(t1);
    });

    const candidates: CandidateCycle[] = [];

    // 1. Two-step cycles between same pair with different fee tiers (e.g. USDT -> WHSK [3000] -> USDT [500])
    for (let i = 0; i < validPools.length; i++) {
      for (let j = 0; j < validPools.length; j++) {
        if (i === j) continue;
        const p1 = validPools[i];
        const p2 = validPools[j];

        // Check if both pools trade between the base asset and another token X
        const other1 = p1.token0 === base ? p1.token1 : p1.token1 === base ? p1.token0 : null;
        const other2 = p2.token0 === base ? p2.token1 : p2.token1 === base ? p2.token0 : null;

        if (other1 && other2 && other1 === other2) {
          const totalFeeBps = Math.round((p1.feeTier + p2.feeTier) / 100);
          
          const steps: StepStruct[] = [
            {
              router,
              kind: 1, // V3 with deadline
              tokenIn: base,
              tokenOut: other1,
              fee: p1.feeTier,
            },
            {
              router,
              kind: 1,
              tokenIn: other1,
              tokenOut: base,
              fee: p2.feeTier,
            },
          ];

          candidates.push({
            id: `2step-${p1.feeTier}-${p2.feeTier}-${other1.slice(0, 6)}`,
            name: `USDT ➔ ${other1.slice(0, 6)} (${p1.feeTier / 10000}%) ➔ USDT (${p2.feeTier / 10000}%)`,
            steps,
            tokens: [base, other1, base],
            totalFeeBps,
            theoreticalEdgeBps: 20, // prefilter baseline
          });
        }
      }
    }

    // 2. Three-step triangular cycles: USDT -> Token A -> Token B -> USDT
    // Look for pool1 (USDT / A), pool2 (A / B), pool3 (B / USDT)
    const basePools = validPools.filter((p) => p.token0 === base || p.token1 === base);

    for (const pIn of basePools) {
      const tokenA = pIn.token0 === base ? pIn.token1 : pIn.token0;

      for (const pMid of validPools) {
        if (pMid.address === pIn.address) continue;
        const hasA = pMid.token0 === tokenA || pMid.token1 === tokenA;
        if (!hasA) continue;

        const tokenB = pMid.token0 === tokenA ? pMid.token1 : pMid.token0;
        if (tokenB === base) continue;

        // Find closing pool between tokenB and base
        const pOut = basePools.find(
          (p) =>
            p.address !== pMid.address &&
            (p.token0 === tokenB || p.token1 === tokenB)
        );

        if (pOut) {
          const totalFeeBps = Math.round((pIn.feeTier + pMid.feeTier + pOut.feeTier) / 100);

          const steps: StepStruct[] = [
            {
              router,
              kind: 1,
              tokenIn: base,
              tokenOut: tokenA,
              fee: pIn.feeTier,
            },
            {
              router,
              kind: 1,
              tokenIn: tokenA,
              tokenOut: tokenB,
              fee: pMid.feeTier,
            },
            {
              router,
              kind: 1,
              tokenIn: tokenB,
              tokenOut: base,
              fee: pOut.feeTier,
            },
          ];

          candidates.push({
            id: `3step-${tokenA.slice(0, 6)}-${tokenB.slice(0, 6)}`,
            name: `USDT ➔ ${tokenA.slice(0, 6)} ➔ ${tokenB.slice(0, 6)} ➔ USDT`,
            steps,
            tokens: [base, tokenA, tokenB, base],
            totalFeeBps,
            theoreticalEdgeBps: 30,
          });
        }
      }
    }

    return candidates;
  }
}
