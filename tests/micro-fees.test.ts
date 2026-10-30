import { describe, expect, it } from "vitest";
import { platformFee } from "../lib/pricing";
import { split, type AssetId } from "../lib/catalog";

describe("micro purchase commission", () => {
  it.each([
    ["100000", "10000", "90000", 1000, "0"],
    ["600000", "60000", "540000", 1000, "0"],
    ["2499999", "249999", "2250000", 1000, "0"],
    ["2500000", "625000", "1875000", 500, "500000"],
    ["4999999", "749999", "4250000", 500, "500000"],
    ["5000000", "750000", "4250000", 500, "500000"],
  ])(
    "splits %s atomic USDC exactly at the $2.50 boundary",
    (amount, fee, seller, bps, fixed) => {
      const commission = platformFee(BigInt(amount), "solana:USDC", "1");
      expect(commission).toEqual({
        feeBps: bps,
        fixedFee: BigInt(fixed),
        version: 2,
      });
      expect(
        split(BigInt(amount), commission.fixedFee, 0, commission.feeBps),
      ).toEqual({ fee: BigInt(fee), seller: BigInt(seller), affiliate: 0n });
    },
  );
  it.each([
    ["base:ETH", 1_000_000_000_000_000n, "2500"],
    ["solana:SOL", 25_000_000n, "100"],
  ] as const)(
    "uses exact USD rate for %s, with no floating point rounding",
    (asset, boundary, rate) => {
      expect(platformFee(boundary - 1n, asset as AssetId, rate).feeBps).toBe(
        1000,
      );
      expect(platformFee(boundary, asset as AssetId, rate).feeBps).toBe(500);
    },
  );
  it("splits an affiliate micro sale from the full amount", () => {
    expect(split(1_000_000n, 0n, 2000, 1000)).toEqual({
      fee: 100_000n,
      affiliate: 200_000n,
      seller: 700_000n,
    });
    expect(() => split(1_000_000n, 0n, 9000, 1000)).toThrow();
    expect(() => split(1_000_000n, 1n, 0, 1000)).toThrow();
  });
});
