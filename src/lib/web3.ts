import { ethers } from "ethers";

export interface NetworkConfig {
  chainId: number;
  chainIdHex: string;
  chainName: string;
  rpcUrl: string;
  explorerUrl: string;
  currencySymbol: string;
  currencyDecimals: number;
}

export const HASHKEY_TESTNET: NetworkConfig = {
  chainId: 133,
  chainIdHex: "0x85",
  chainName: "HashKey Chain Testnet",
  rpcUrl: "https://testnet.hsk.xyz",
  explorerUrl: "https://testnet-explorer.hsk.xyz",
  currencySymbol: "HSK",
  currencyDecimals: 18,
};

export const HASHKEY_MAINNET: NetworkConfig = {
  chainId: 177,
  chainIdHex: "0xb1",
  chainName: "HashKey Chain Mainnet",
  rpcUrl: "https://mainnet.hsk.xyz",
  explorerUrl: "https://hashkey.blockscout.com",
  currencySymbol: "HSK",
  currencyDecimals: 18,
};

export const DEFAULT_NETWORK =
  process.env.NEXT_PUBLIC_CHAIN_ID === "177" ? HASHKEY_MAINNET : HASHKEY_TESTNET;

export async function switchOrAddNetwork(network: NetworkConfig = DEFAULT_NETWORK) {
  if (typeof window === "undefined" || !(window as unknown as { ethereum?: unknown }).ethereum) {
    throw new Error("MetaMask or Web3 wallet is not detected in your browser.");
  }

  const ethereum = (window as unknown as { ethereum: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: network.chainIdHex }],
    });
  } catch (switchError: unknown) {
    const err = switchError as { code?: number };
    // 4902 means the chain has not been added to MetaMask yet
    if (err.code === 4902) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: network.chainIdHex,
            chainName: network.chainName,
            nativeCurrency: {
              name: "HashKey Token",
              symbol: network.currencySymbol,
              decimals: network.currencyDecimals,
            },
            rpcUrls: [network.rpcUrl],
            blockExplorerUrls: [network.explorerUrl],
          },
        ],
      });
    } else {
      throw switchError;
    }
  }
}

export function formatAddress(address: string, chars = 4): string {
  if (!address) return "";
  return `${address.substring(0, chars + 2)}...${address.substring(address.length - chars)}`;
}

export function getExplorerTxUrl(txHash: string, network = DEFAULT_NETWORK): string {
  return `${network.explorerUrl}/tx/${txHash}`;
}

export function getExplorerAddressUrl(address: string, network = DEFAULT_NETWORK): string {
  return `${network.explorerUrl}/address/${address}`;
}

// EIP-712 Typed Data for Large Trade Approvals (Phase 2)
export const APPROVAL_DOMAIN = {
  name: "RiskKernelVault",
  version: "1",
  chainId: DEFAULT_NETWORK.chainId,
};

export const APPROVAL_TYPES = {
  TradeApproval: [
    { name: "vault", type: "address" },
    { name: "opportunityId", type: "string" },
    { name: "tradeAmount", type: "uint256" },
    { name: "minProfit", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "nonce", type: "string" },
  ],
};
