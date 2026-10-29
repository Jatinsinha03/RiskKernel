import { ethers } from "ethers";
import { RISK_KERNEL_VAULT_ABI, ERC20_ABI } from "../contracts/RiskKernelVaultABI";
import { AgentConfig } from "./config";

export interface StepStruct {
  router: string;
  kind: number; // 0 = V2, 1 = V3 with deadline, 2 = V3 Router02
  tokenIn: string;
  tokenOut: string;
  fee: number; // e.g. 3000 = 0.3%
}

export interface ApprovalStruct {
  expiry: number | bigint;
  nonce: number | bigint | string;
  signature: string;
}

export const V3_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
  "function feeAmountTickSpacing(uint24 fee) external view returns (int24)",
];

export const V3_POOL_ABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function fee() external view returns (uint24)",
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() external view returns (uint128)",
];

export class ChainService {
  public provider: ethers.JsonRpcProvider;
  public signer: ethers.Wallet | null = null;
  public vaultInterface: ethers.Interface;

  constructor(public config: AgentConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    if (config.agentPrivateKey) {
      this.signer = new ethers.Wallet(config.agentPrivateKey, this.provider);
    }
    this.vaultInterface = new ethers.Interface(RISK_KERNEL_VAULT_ABI);
  }

  public getVaultContract(vaultAddress: string): ethers.Contract {
    const runner = this.signer || this.provider;
    return new ethers.Contract(vaultAddress, RISK_KERNEL_VAULT_ABI, runner);
  }

  public getFactoryContract(): ethers.Contract {
    return new ethers.Contract(this.config.v3FactoryAddress, V3_FACTORY_ABI, this.provider);
  }

  public getPoolContract(poolAddress: string): ethers.Contract {
    return new ethers.Contract(poolAddress, V3_POOL_ABI, this.provider);
  }

  public getErc20Contract(tokenAddress: string): ethers.Contract {
    return new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
  }

  /**
   * Decodes revert error bytes using RiskKernelVault custom errors
   */
  public decodeRevertError(errorData: string): { errorName: string; args: Record<string, unknown> } | null {
    try {
      if (!errorData || errorData === "0x") return null;
      const parsed = this.vaultInterface.parseError(errorData);
      if (!parsed) return null;
      
      const args: Record<string, unknown> = {};
      parsed.fragment.inputs.forEach((input, index) => {
        const val = parsed.args[index];
        args[input.name] = typeof val === "bigint" ? val.toString() : val;
      });

      return {
        errorName: parsed.name,
        args,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get agent native balance in HSK
   */
  public async getAgentHskBalance(): Promise<string> {
    if (!this.config.agentAddress) return "0.0";
    try {
      const bal = await this.provider.getBalance(this.config.agentAddress);
      return ethers.formatEther(bal);
    } catch {
      return "0.0";
    }
  }
}
