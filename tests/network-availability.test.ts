import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_CHAIN_ENV", "mainnet");
});

describe("paused payment networks", () => {
  it("offers the four inexpensive networks and preserves historical asset parsing", async () => {
    const { isAssetEnabled, isAssetOffered, atomicPrice } =
      await import("../lib/catalog");
    for (const asset of [
      "ethereum:ETH",
      "ethereum:USDC",
      "ethereum:USDT",
      "tron:USDT",
    ]) {
      expect(isAssetEnabled(asset)).toBe(true);
      expect(isAssetOffered(asset)).toBe(false);
    }
    for (const asset of [
      "base:USDC",
      "arbitrum:USDT",
      "bsc:USDT",
      "solana:SOL",
    ]) {
      expect(isAssetOffered(asset)).toBe(true);
    }
    expect(atomicPrice({ asset: "ethereum:ETH", amount: "0.001" })).toBe(
      1000000000000000n,
    );
    expect(atomicPrice({ asset: "tron:USDT", amount: "1" })).toBe(1000000n);
    expect(isAssetOffered("fake:USDT")).toBe(false);
  });
  it("does not offer mainnet-only tokens in testnet", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ENV", "testnet");
    const { isAssetOffered } = await import("../lib/catalog");
    expect(isAssetOffered("bsc:USDT")).toBe(false);
    expect(isAssetOffered("base:USDC")).toBe(true);
  });
});
