import { parseUnits } from "viem";
import { ASSETS, type AssetId } from "./catalog";
export const FEE_SUMMARY = "Ниже $2.50 — 10%; от $2.50 — 5% + $0.50";
export function platformFee(amount: bigint, assetId: AssetId, usdRate: string) {
  const decimals = ASSETS[assetId].decimals;
  const standardFixed = fixedFeeAtRate(decimals, usdRate);
  const micro =
    amount * parseUnits(usdRate, 8) < 250_000_000n * 10n ** BigInt(decimals);
  return {
    fixedFee: micro ? 0n : standardFixed,
    feeBps: micro ? 1000 : 500,
    version: 2,
  };
}
export function fixedFeeAtRate(decimals: number, usdRate: string) {
  if (!/^\d{1,9}(\.\d{1,8})?$/.test(usdRate))
    throw new Error("Invalid USD rate");
  const rate = parseUnits(usdRate, 8);
  if (rate <= 0n) throw new Error("Invalid USD rate");
  const numerator = 50_000_000n * 10n ** BigInt(decimals);
  return (numerator + rate - 1n) / rate;
}
export function parseTicker(value: unknown, now = Date.now()) {
  if (
    !value ||
    typeof value !== "object" ||
    !("price" in value) ||
    !("time" in value) ||
    typeof value.price !== "string" ||
    typeof value.time !== "string"
  )
    throw new Error("Invalid price feed");
  fixedFeeAtRate(9, value.price);
  const time = Date.parse(value.time);
  if (!Number.isFinite(time) || now - time > 60_000 || time - now > 10_000)
    throw new Error("Price feed is stale");
  return { rate: value.price, quotedAt: value.time };
}
const cache = new Map<
  string,
  { rate: string; quotedAt: string; fetchedAt: number }
>();
export async function feeQuote(assetId: AssetId) {
  const asset = ASSETS[assetId];
  if (asset.symbol === "USDC" || asset.symbol === "USDT")
    return {
      fixedFee: fixedFeeAtRate(asset.decimals, "1"),
      rate: "1",
      quotedAt: new Date().toISOString(),
    };
  let ticker = cache.get(asset.symbol);
  if (
    !ticker ||
    Date.now() - ticker.fetchedAt > 15_000 ||
    Date.now() - Date.parse(ticker.quotedAt) > 45_000
  ) {
    const response = await fetch(
      `https://api.exchange.coinbase.com/products/${asset.symbol}-USD/ticker`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
        headers: { Accept: "application/json" },
        redirect: "error",
      },
    );
    if (!response.ok) throw new Error("Price feed unavailable");
    ticker = { ...parseTicker(await response.json()), fetchedAt: Date.now() };
    cache.set(asset.symbol, ticker);
  }
  return { ...ticker, fixedFee: fixedFeeAtRate(asset.decimals, ticker.rate) };
}
