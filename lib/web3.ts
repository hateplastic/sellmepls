import {
  createPublicClient,
  http,
  fallback,
  parseAbi,
  defineChain,
} from "viem";
import { createConfig, injected } from "@wagmi/core";
import { Connection } from "@solana/web3.js";
import { TESTNET, RPC_DEFAULTS, type EvmNetwork } from "./network";
import { mainnet, sepolia, bsc as bnb, bscTestnet } from "viem/chains";
const base = defineChain({
  id: (TESTNET ? 84532 : 8453) as number,
  name: TESTNET ? "Base Sepolia" : "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_DEFAULTS.base] } },
  blockExplorers: {
    default: {
      name: "Basescan",
      url: TESTNET ? "https://sepolia.basescan.org" : "https://basescan.org",
    },
  },
});
const arbitrum = defineChain({
  id: (TESTNET ? 421614 : 42161) as number,
  name: TESTNET ? "Arbitrum Sepolia" : "Arbitrum One",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_DEFAULTS.arbitrum] } },
  blockExplorers: {
    default: {
      name: "Arbiscan",
      url: TESTNET ? "https://sepolia.arbiscan.io" : "https://arbiscan.io",
    },
  },
});
export const chains = {
  base,
  arbitrum,
  ethereum: TESTNET ? sepolia : mainnet,
  bsc: TESTNET ? bscTestnet : bnb,
};
export const SOLANA_GENESIS = TESTNET
  ? "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
  : "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const routerAbi = parseAbi([
  "struct Quote { bytes32 orderId; address buyer; address seller; address token; uint256 amount; uint256 fee; address affiliate; uint256 affiliateAmount; uint256 deadline; }",
  "function pay(Quote q, bytes signature) payable",
  "function platform() view returns (address)",
  "function quoteSigner() view returns (address)",
  "function paid(bytes32) view returns (bool)",
  "function allowedToken(address) view returns (bool)",
  "event Paid(bytes32 indexed orderId, address indexed buyer, address indexed seller, address token, uint256 amount, uint256 fee, address affiliate, uint256 affiliateAmount)",
]);
export function getWagmiConfig() {
  return createConfig({
    chains: [base, arbitrum, chains.ethereum, chains.bsc],
    connectors: [injected()],
    ssr: true,
    transports: {
      [chains.ethereum.id]: http(RPC_DEFAULTS.ethereum),
      [chains.bsc.id]: evmTransport("bsc"),
      [base.id]: http(
        process.env.NEXT_PUBLIC_BASE_RPC_URL || RPC_DEFAULTS.base,
      ),
      [arbitrum.id]: http(
        process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL || RPC_DEFAULTS.arbitrum,
      ),
    },
  });
}
export function evmClient(network: EvmNetwork, rpcUrl?: string) {
  return createPublicClient({
    chain: chains[network],
    transport: evmTransport(network, rpcUrl),
  });
}
export function evmTransport(network: EvmNetwork, rpcUrl?: string) {
  const primary =
    rpcUrl ||
    (network === "base"
      ? process.env.NEXT_PUBLIC_BASE_RPC_URL
      : network === "arbitrum"
        ? process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL
        : undefined) ||
    RPC_DEFAULTS[network];
  const urls = [
    ...new Set([
      primary,
      ...(network === "bsc" && !TESTNET
        ? [
            "https://bsc-dataseed.bnbchain.org",
            "https://bsc-dataseed-public.bnbchain.org",
          ]
        : []),
    ]),
  ];
  return urls.length === 1
    ? http(primary, { timeout: 15000, retryCount: 2 })
    : fallback(
        urls.map((url) => http(url, { timeout: 15000, retryCount: 0 })),
        { retryCount: 1 },
      );
}
export class SolanaRpcHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Solana RPC HTTP ${status}`);
    this.name = "SolanaRpcHttpError";
  }
}
export function solanaConnection(rpcUrl?: string) {
  return new Connection(rpcUrl || RPC_DEFAULTS.solana, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: async (input, init) => {
      const response = await fetch(input, {
        ...init,
        signal: AbortSignal.timeout(15_000),
      });
      // Never propagate a provider response body or a URL containing its API key.
      if (!response.ok) throw new SolanaRpcHttpError(response.status);
      return response;
    },
  });
}
