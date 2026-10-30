import { formatUnits, parseUnits } from "viem";
import { ASSETS, atomicPrice, type Price } from "./catalog";

// Match the integer rounding used by the payment split before converting for display.
export function affiliateReward(
  price: Price,
  bps: number,
  nativeUsdRate?: string | null,
) {
  const asset = ASSETS[price.asset];
  const amount = (atomicPrice(price) * BigInt(bps)) / 10_000n;
  const stable = asset.symbol === "USDC" || asset.symbol === "USDT";
  const rate = stable ? "1" : nativeUsdRate;
  if (!rate) return `${formatUnits(amount, asset.decimals)} ${asset.symbol}`;
  const usd = (amount * parseUnits(rate, 8)) / 10n ** BigInt(asset.decimals);
  if (amount > 0n && usd < 100n) return `${stable ? "" : "≈ "}< $0.000001`;
  return `${stable ? "" : "≈ "}$${Number(formatUnits(usd, 8)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: usd < 1_000_000n ? 6 : 2 })}`;
}
