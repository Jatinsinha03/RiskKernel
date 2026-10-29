import { ethers } from "ethers";
import { ActiveVaultContext } from "./registry";
import { AgentConfig } from "./config";

export class SizerService {
  constructor(private config: AgentConfig) {}

  /**
   * Computes the list of candidate trade sizes to simulate
   */
  public getCandidateSizes(vault: ActiveVaultContext): bigint[] {
    const maxTradeConfigRaw = ethers.parseUnits(this.config.maxTradeUsdt.toString(), 6);

    // Bounded by maxPositionSize, balance, daily volume remaining, and config cap
    let maxSize = vault.maxPositionSizeRaw;
    if (vault.balanceRaw < maxSize) maxSize = vault.balanceRaw;
    if (vault.volumeRemainingTodayRaw < maxSize) maxSize = vault.volumeRemainingTodayRaw;
    if (maxTradeConfigRaw < maxSize) maxSize = maxTradeConfigRaw;

    const minAllowed = ethers.parseUnits("0.1", 6); // 0.1 USDT min
    if (maxSize < minAllowed) {
      return [];
    }

    const sizes: bigint[] = [];
    const seen = new Set<string>();

    for (const fraction of this.config.sizeFractions) {
      const size = (maxSize * BigInt(Math.round(fraction * 1000))) / BigInt(1000);
      if (size >= minAllowed) {
        const key = size.toString();
        if (!seen.has(key)) {
          seen.add(key);
          sizes.push(size);
        }
      }
    }

    return sizes;
  }
}
