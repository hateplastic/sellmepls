export const TESTNET = process.env.NEXT_PUBLIC_CHAIN_ENV !== "mainnet";
export const CHAIN_ENV = TESTNET ? "testnet" : "mainnet";
export const EVM_NETWORKS = ["base", "arbitrum", "ethereum", "bsc"] as const;
export type EvmNetwork = (typeof EVM_NETWORKS)[number];
export type Network = EvmNetwork | "solana" | "tron";
export type WalletFamily = "ethereum" | "solana" | "tron";
export type PaymentAvailability = Record<Network, boolean>;
// Paused networks remain supported for verifying and delivering past orders.
export function isNetworkOffered(network: Network): boolean {
  return network !== "ethereum" && network !== "tron";
}
export function isEvmNetwork(network: string): network is EvmNetwork {
  return (EVM_NETWORKS as readonly string[]).includes(network);
}
export function walletFamily(network: Network): WalletFamily {
  return isEvmNetwork(network) ? "ethereum" : network;
}
export const NETWORK_LABELS: Record<Network, string> = {
  base: "Base",
  arbitrum: "Arbitrum",
  ethereum: "Ethereum",
  bsc: "BNB Smart Chain",
  solana: "Solana",
  tron: "TRON",
};
export const RPC_DEFAULTS = {
  ethereum: TESTNET
    ? "https://ethereum-sepolia-rpc.publicnode.com"
    : "https://ethereum-rpc.publicnode.com",
  bsc: TESTNET
    ? "https://bsc-testnet-rpc.publicnode.com"
    : "https://bsc-dataseed.bnbchain.org",
  tron: TESTNET ? "https://nile.trongrid.io" : "https://api.trongrid.io",
  base: TESTNET ? "https://sepolia.base.org" : "https://mainnet.base.org",
  arbitrum: TESTNET
    ? "https://sepolia-rollup.arbitrum.io/rpc"
    : "https://arb1.arbitrum.io/rpc",
  solana: TESTNET
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet-beta.solana.com",
};
