import prisma from "@/lib/prisma";
import { ChainService } from "./chain";
import { AgentConfig } from "./config";
import { ethers } from "ethers";

export interface ActiveVaultContext {
  address: string;
  owner: string;
  agent: string;
  baseAsset: string;
  balanceRaw: bigint;
  balanceFormatted: string;
  maxDrawdownBps: number;
  maxPositionSizeRaw: bigint;
  maxDailyVolumeRaw: bigint;
  approvalThresholdRaw: bigint;
  volumeRemainingTodayRaw: bigint;
  allowedTokens: string[];
  allowedRouters: string[];
  isApprovalOff: boolean;
  paused: boolean;
  frozen: boolean;
}

export class RegistryService {
  constructor(private chain: ChainService, private config: AgentConfig) {}

  /**
   * Loads all active vaults eligible for automated agent trading
   */
  public async getEligibleVaults(): Promise<ActiveVaultContext[]> {
    const dbVaults = await prisma.vault.findMany({
      where: {
        enabled: true,
        status: "ACTIVE",
      },
    });

    const eligible: ActiveVaultContext[] = [];

    for (const v of dbVaults) {
      try {
        const vaultContract = this.chain.getVaultContract(v.address);

        // Fetch on-chain parameters
        const [
          owner,
          agent,
          baseAsset,
          paused,
          frozen,
          bal,
          mandateRaw,
          volRemaining,
        ] = await Promise.all([
          vaultContract.owner().catch(() => ethers.ZeroAddress),
          vaultContract.agent().catch(() => ethers.ZeroAddress),
          vaultContract.baseAsset().catch(() => ethers.ZeroAddress),
          vaultContract.paused().catch(() => true),
          vaultContract.frozen().catch(() => true),
          vaultContract.balance().catch(() => BigInt(0)),
          vaultContract.mandate().catch(() => null),
          vaultContract.volumeRemainingToday().catch(() => BigInt(0)),
        ]);

        // Invariant checks
        if (paused || frozen) continue;
        if (baseAsset.toLowerCase() !== this.config.baseAssetAddress.toLowerCase()) continue;
        if (bal === BigInt(0)) continue;
        if (volRemaining === BigInt(0)) continue;
        if (!mandateRaw) continue;

        // If an agent key is configured, verify that this agent address is granted
        if (this.config.agentAddress) {
          const normAgent = agent.toLowerCase();
          const normExpected = this.config.agentAddress.toLowerCase();
          // Allow if agent matches OR if agent is vault owner
          if (normAgent !== normExpected && normAgent !== owner.toLowerCase()) {
            continue;
          }
        }

        const maxDrawdownBps = Number(mandateRaw[0]);
        const maxPositionSizeRaw = BigInt(mandateRaw[2].toString());
        const maxDailyVolumeRaw = BigInt(mandateRaw[3].toString());
        const approvalThresholdRaw = BigInt(mandateRaw[4].toString());

        const isApprovalOff =
          approvalThresholdRaw.toString() === "340282366920938463463374607431768211455";

        const allowedTokens = (v.allowedTokens || []).map((t) => t.toLowerCase());
        // Base asset is always implicitly allowed
        if (!allowedTokens.includes(this.config.baseAssetAddress.toLowerCase())) {
          allowedTokens.push(this.config.baseAssetAddress.toLowerCase());
        }

        const allowedRouters = (v.allowedPools || [this.config.routerAddress]).map((r) => r.toLowerCase());

        eligible.push({
          address: v.address.toLowerCase(),
          owner: owner.toLowerCase(),
          agent: agent.toLowerCase(),
          baseAsset: baseAsset.toLowerCase(),
          balanceRaw: bal,
          balanceFormatted: ethers.formatUnits(bal, 6),
          maxDrawdownBps,
          maxPositionSizeRaw,
          maxDailyVolumeRaw,
          approvalThresholdRaw,
          volumeRemainingTodayRaw: volRemaining,
          allowedTokens,
          allowedRouters,
          isApprovalOff,
          paused,
          frozen,
        });
      } catch (err) {
        console.warn(`Could not verify on-chain state for vault ${v.address}:`, err);
      }
    }

    return eligible;
  }
}
