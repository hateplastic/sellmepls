import { parseUnits, formatUnits, zeroAddress, type Address } from "viem";
import { TESTNET, isNetworkOffered } from "./network";
import type { Category } from "./categories";
export type { Network } from "./network";
import type { Network } from "./network";
export const ASSETS = {
  "ethereum:USDC": {
    network: "ethereum",
    symbol: "USDC",
    decimals: 6,
    address: TESTNET
      ? "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
      : "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    label: "USDC · Ethereum (ERC20)",
  },
  "ethereum:USDT": {
    network: "ethereum",
    symbol: "USDT",
    decimals: 6,
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    label: "USDT · Ethereum (ERC20)",
  },
  "ethereum:ETH": {
    network: "ethereum",
    symbol: "ETH",
    decimals: 18,
    address: zeroAddress,
    label: "ETH · Ethereum",
  },
  "arbitrum:USDT": {
    network: "arbitrum",
    symbol: "USDT",
    decimals: 6,
    address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    label: "USDT0 · Arbitrum",
  },
  "bsc:USDT": {
    network: "bsc",
    symbol: "USDT",
    decimals: 18,
    address: "0x55d398326f99059fF775485246999027B3197955",
    label: "USDT · BNB Chain (Binance-Peg, BEP20)",
  },
  "tron:USDT": {
    network: "tron",
    symbol: "USDT",
    decimals: 6,
    address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    label: "USDT · TRON (TRC20)",
  },
  "base:USDC": {
    network: "base",
    symbol: "USDC",
    decimals: 6,
    address: TESTNET
      ? "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
      : "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    label: "USDC · Base",
  },
  "base:ETH": {
    network: "base",
    symbol: "ETH",
    decimals: 18,
    address: zeroAddress,
    label: "ETH · Base",
  },
  "arbitrum:USDC": {
    network: "arbitrum",
    symbol: "USDC",
    decimals: 6,
    address: TESTNET
      ? "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"
      : "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    label: "USDC · Arbitrum",
  },
  "arbitrum:ETH": {
    network: "arbitrum",
    symbol: "ETH",
    decimals: 18,
    address: zeroAddress,
    label: "ETH · Arbitrum",
  },
  "solana:USDC": {
    network: "solana",
    symbol: "USDC",
    decimals: 6,
    address: TESTNET
      ? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
      : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    label: "USDC · Solana",
  },
  "solana:USDT": {
    network: "solana",
    symbol: "USDT",
    decimals: 6,
    address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    label: "USDT · Solana",
  },
  "solana:SOL": {
    network: "solana",
    symbol: "SOL",
    decimals: 9,
    address: "native",
    label: "SOL · Solana",
  },
} as const;
export type AssetId = keyof typeof ASSETS;
export function isAssetEnabled(id: string): id is AssetId {
  return (
    Object.hasOwn(ASSETS, id) &&
    !(
      TESTNET &&
      [
        "solana:USDT",
        "ethereum:USDT",
        "arbitrum:USDT",
        "bsc:USDT",
        "tron:USDT",
      ].includes(id)
    )
  );
}
export type Price = { asset: AssetId; amount: string };
export function isAssetOffered(id: string): id is AssetId {
  return isAssetEnabled(id) && isNetworkOffered(ASSETS[id].network);
}
export function assetById(id: string) {
  if (!isAssetEnabled(id)) throw new Error("Unsupported asset");
  return ASSETS[id as AssetId];
}
export function atomicPrice(price: Price) {
  const asset = assetById(price.asset);
  if (
    !/^\d{1,12}(\.\d+)?$/.test(price.amount) ||
    (price.amount.split(".")[1]?.length ?? 0) > asset.decimals
  )
    throw new Error("Invalid price precision");
  const amount = parseUnits(price.amount, asset.decimals);
  const max = asset.network === "solana" ? 9_000_000_000_000_000n : 10n ** 35n;
  if (amount < 100n || amount > max)
    throw new Error("Price is outside supported limits");
  return amount;
}
export function split(
  amount: bigint,
  fixedFee: bigint,
  affiliateBps = 0,
  feeBps = 500,
) {
  if (
    amount < 100n ||
    !(
      (feeBps === 500 && fixedFee > 0n) ||
      (feeBps === 1000 && fixedFee === 0n)
    ) ||
    !Number.isInteger(affiliateBps) ||
    affiliateBps < 0 ||
    affiliateBps > 9000
  )
    throw new Error("Invalid commission");
  const fee = (amount * BigInt(feeBps)) / 10_000n + fixedFee;
  const affiliate = (amount * BigInt(affiliateBps)) / 10_000n;
  if (fee + affiliate >= amount)
    throw new Error("Цена слишком мала для комиссии платформы и партнёра");
  return { fee, affiliate, seller: amount - fee - affiliate };
}
export function saleParts(
  sale: Pick<Sale, "amount" | "fee" | "affiliate_amount">,
) {
  const fee = BigInt(sale.fee),
    affiliate = BigInt(sale.affiliate_amount);
  const seller = BigInt(sale.amount) - fee - affiliate;
  if (fee <= 0n || affiliate < 0n || seller <= 0n)
    throw new Error("Invalid payment allocation");
  return { fee, affiliate, seller };
}
export function displayAmount(amount: string | bigint, asset: AssetId) {
  return `${formatUnits(BigInt(amount), ASSETS[asset].decimals)} ${ASSETS[asset].symbol}`;
}
export function orderReference(id: string): `0x${string}` {
  return `0x${id.replaceAll("-", "").padStart(64, "0")}`;
}
export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
export type Product = {
  delivery_mode: "file" | "stock";
  is_hidden: boolean;
  id: string;
  seller_id: string;
  title: string;
  description: string;
  prices: Price[];
  preview_key: string;
  file_name: string;
  file_size: number;
  active: boolean;
  affiliate_enabled: boolean;
  affiliate_bps: number;
  created_at: string;
  revision: number;
  category: Category;
  gallery_keys: string[];
  youtube_id: string | null;
};
export type Sale = {
  delivery_mode: "file" | "stock";
  quantity: number;
  unit_amount: string;
  checkout_key: string | null;
  reservation_released_at: string | null;
  payment_started_at: string | null;
  solana_last_valid_height: number | null;
  solana_blockhashes: string[];
  solana_first_slot: number | null;
  id: string;
  product_id: string;
  seller_id: string;
  buyer_id: string;
  buyer_wallet: string;
  seller_wallet: string;
  platform_wallet: string;
  asset: AssetId;
  network: Network;
  amount: string;
  fee: string;
  fixed_fee: string;
  fee_bps: number;
  commission_version: number;
  affiliate_amount: string;
  affiliate_wallet: string | null;
  affiliate_id: string | null;
  affiliate_link_id: string | null;
  affiliate_bps: number;
  usd_rate: string;
  rate_quoted_at: string;
  quote_signature: `0x${string}` | null;
  chain_environment: "testnet" | "mainnet";
  router: string | null;
  status: "pending" | "paid";
  tx_hash: string | null;
  created_at: string;
  expires_at: string;
  paid_at: string | null;
  block_number: string | null;
};
