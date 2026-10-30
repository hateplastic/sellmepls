import { describe, expect, it } from "vitest";
import { affiliateReward } from "../lib/affiliate-reward";

describe("affiliate reward shown on product cards", () => {
  it("uses the product price, not the seller's net payout", () => {
    expect(affiliateReward({ asset: "base:USDC", amount: "10" }, 3000)).toBe(
      "$3.00",
    );
  });
  it("keeps sub-cent rewards visible for cheap products", () => {
    expect(affiliateReward({ asset: "base:USDC", amount: "0.01" }, 3000)).toBe(
      "$0.003",
    );
  });
  it("matches token-unit truncation in settlement", () => {
    expect(
      affiliateReward({ asset: "base:USDC", amount: "0.000101" }, 3333),
    ).toBe("$0.000033");
  });
  it("converts native assets with the supplied USD rate", () => {
    expect(
      affiliateReward({ asset: "solana:SOL", amount: "0.1" }, 3000, "150"),
    ).toBe("≈ $4.50");
    expect(
      affiliateReward({ asset: "base:ETH", amount: "0.01" }, 3000, "2500"),
    ).toBe("≈ $7.50");
  });
  it("falls back to the payment currency if the price feed is unavailable", () => {
    expect(
      affiliateReward({ asset: "solana:SOL", amount: "0.1" }, 3000, null),
    ).toBe("0.03 SOL");
  });
  it("does not present a tiny positive reward as zero dollars", () => {
    expect(
      affiliateReward(
        { asset: "base:ETH", amount: "0.000000000000001" },
        3000,
        "2500",
      ),
    ).toBe("≈ < $0.000001");
  });
});
