import { describe, it, expect, vi, afterEach } from "vitest";
import {
  readAttributions,
  signValue,
  selectAttribution,
  REFERRAL_TTL,
} from "../lib/referral-token";
import { fixedFeeAtRate, parseTicker, feeQuote } from "../lib/pricing";
import { split, isAssetEnabled, ASSETS } from "../lib/catalog";
import { CHAIN_ENV } from "../lib/network";
const secret = "random-test-secret-at-least-32-characters";
const product = crypto.randomUUID(),
  seller = crypto.randomUUID(),
  now = Date.now();
afterEach(() => vi.unstubAllGlobals());
describe("affiliate attribution", () => {
  const value = {
    code: "abcdefghijklmnop",
    target: `p:${product}`,
    at: now - 10,
  };
  it("authenticates the cookie and rejects tampering", () => {
    const token = signValue([value], secret);
    expect(readAttributions(token, secret, now)).toEqual([value]);
    const tampered = signValue(
      [{ ...value, code: "zzzzzzzzzzzzzzzz" }],
      "attacker",
    );
    expect(readAttributions(tampered, secret, now)).toEqual([]);
  });
  it("expires referral attribution after 30 days", () =>
    expect(
      readAttributions(
        signValue([value], secret),
        secret,
        now + REFERRAL_TTL * 1000,
      ),
    ).toEqual([]));
  it("rejects future timestamps", () =>
    expect(
      readAttributions(
        signValue([{ ...value, at: now + 1 }], secret),
        secret,
        now,
      ),
    ).toEqual([]));
  it("uses the last matching product or storefront click", () => {
    const store = {
      ...value,
      code: "qrstuvwxyzabcdef",
      target: `s:${seller}`,
      at: now,
    };
    expect(selectAttribution([value, store], product, seller)).toEqual(store);
    expect(
      selectAttribution(
        [value, store],
        crypto.randomUUID(),
        crypto.randomUUID(),
      ),
    ).toBeUndefined();
  });
});
describe("fixed USD fee and affiliate precision", () => {
  it("rounds fixed ETH fee up to a wei", () => {
    const fee = fixedFeeAtRate(18, "3000");
    expect(fee).toBe(166666666666667n);
    expect(fee * 3000n).toBeGreaterThanOrEqual(500000000000000000n);
  });
  it("splits a $10 sale into $8 seller, $1 platform, $1 affiliate", () =>
    expect(split(10_000_000n, 500_000n, 1000)).toEqual({
      seller: 8_000_000n,
      fee: 1_000_000n,
      affiliate: 1_000_000n,
    }));
  it("leaves the unused affiliate share with the seller", () =>
    expect(split(10_000_000n, 500_000n).seller).toBe(9_000_000n));
  it("rejects a price below the fee", () =>
    expect(() => split(500_000n, 500_000n)).toThrow());
  it("rejects an impossible affiliate margin", () =>
    expect(() => split(1_000_000n, 500_000n, 9000)).toThrow());
  it("rejects stale and future rates", () => {
    expect(() =>
      parseTicker(
        { price: "100", time: new Date(now - 61000).toISOString() },
        now,
      ),
    ).toThrow();
    expect(() =>
      parseTicker(
        { price: "100", time: new Date(now + 11000).toISOString() },
        now,
      ),
    ).toThrow();
  });
  it("rejects non-positive rates", () =>
    expect(() =>
      parseTicker({ price: "0", time: new Date(now).toISOString() }, now),
    ).toThrow());
  it("stablecoin fees do not depend on a third-party feed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("offline");
      }),
    );
    expect((await feeQuote("base:USDC")).fixedFee).toBe(500_000n);
  });
  it("uses devnet assets by default and does not offer fake USDT", () => {
    expect(CHAIN_ENV).toBe("testnet");
    expect(ASSETS["base:USDC"].address).toBe(
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    );
    expect(isAssetEnabled("solana:USDT")).toBe(false);
  });
});
