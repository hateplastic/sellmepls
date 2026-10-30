import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../lib/supabase/server", () => ({ adminDb: vi.fn() }));
import { Trx, TronWeb } from "tronweb";
import {
  encodeEventTopics,
  encodeAbiParameters,
  zeroAddress,
  parseUnits,
} from "viem";
import { tronToEvm, evmToTron, isTronAddress } from "../lib/tron-address";
import { verifyTronSignature } from "../lib/tron-auth";
import { walletIdentity } from "../lib/wallet-identity";
import { tronResourceBudget } from "../lib/tron-resources";
import {
  assertTronTransaction,
  tronCall,
  type TronTransaction,
} from "../lib/tron-transaction";
import { verifyTronReceipt } from "../lib/verify-tron";
import { routerAbi } from "../lib/web3";
import { ASSETS, orderReference, type Sale } from "../lib/catalog";
import { feeQuote, platformFee } from "../lib/pricing";
const addr = (n: string) => evmToTron(`0x${n.repeat(40)}`);
const sale = {
  id: "11111111-1111-4111-8111-111111111111",
  asset: "tron:USDT",
  network: "tron",
  buyer_wallet: addr("1"),
  seller_wallet: addr("2"),
  platform_wallet: addr("3"),
  router: addr("4"),
  amount: "1000000",
  fee: "100000",
  affiliate_amount: "0",
  affiliate_wallet: null,
  quote_signature: `0x${"11".repeat(65)}`,
  created_at: new Date(Date.now() - 10000).toISOString(),
  expires_at: new Date(Date.now() + 600000).toISOString(),
} as Sale;
const hex = (address: string) => `41${tronToEvm(address).slice(2)}`;
const hash = "ab".repeat(32);
function chainTx() {
  return {
    txID: hash,
    ret: [{ contractRet: "SUCCESS" }],
    raw_data: {
      contract: [
        {
          type: "TriggerSmartContract",
          parameter: {
            value: {
              owner_address: hex(sale.buyer_wallet),
              contract_address: hex(sale.router!),
            },
          },
        },
      ],
    },
  };
}
function receipt() {
  return {
    id: hash,
    blockNumber: 999,
    blockTimeStamp: Date.now(),
    receipt: { result: "SUCCESS" },
    log: [
      {
        address: tronToEvm(sale.router!).slice(2),
        topics: encodeEventTopics({
          abi: routerAbi,
          eventName: "Paid",
          args: {
            orderId: orderReference(sale.id),
            buyer: tronToEvm(sale.buyer_wallet),
            seller: tronToEvm(sale.seller_wallet),
          },
        }).map((v) => (v as string).slice(2)),
        data: encodeAbiParameters(
          [
            { type: "address" },
            { type: "uint256" },
            { type: "uint256" },
            { type: "address" },
            { type: "uint256" },
          ],
          [
            tronToEvm(ASSETS[sale.asset].address),
            1000000n,
            100000n,
            zeroAddress,
            0n,
          ],
        ).slice(2),
      },
    ],
  };
}
function unsigned(step: "pay" | "approve" | "reset" = "pay") {
  const c = tronCall(sale, step);
  return {
    raw_data: {
      contract: [
        {
          type: "TriggerSmartContract",
          parameter: {
            value: {
              owner_address: hex(sale.buyer_wallet),
              contract_address: hex(c.target),
              data: c.data.slice(2),
            },
          },
        },
      ],
      fee_limit: 10000000,
      expiration: Date.now() + 60000,
    },
    raw_data_hex: "11",
    txID: hash,
  } as TronTransaction;
}
describe("TRON payment boundaries", () => {
  it("validates checksum and round trips the platform address", () => {
    const platform = "TBmzphPbAsj294wEc4ucrw8kUDRiUK4M8K";
    expect(isTronAddress(platform)).toBe(true);
    expect(evmToTron(tronToEvm(platform))).toBe(platform);
    expect(isTronAddress(platform.slice(0, -1) + "X")).toBe(false);
    expect(isTronAddress(addr("0"))).toBe(false);
  });
  it("verifies message signatures and rejects changed challenges and other wallets", async () => {
    const key = "ab".repeat(32),
      address = TronWeb.address.fromPrivateKey(key) as string,
      message = "localhost sign-in nonce 123";
    const signature = Trx.signMessageV2(message, key);
    await expect(
      verifyTronSignature(message, signature, address),
    ).resolves.toBeUndefined();
    await expect(
      verifyTronSignature(message + "x", signature, address),
    ).rejects.toThrow();
    await expect(
      verifyTronSignature(message, signature, addr("1")),
    ).rejects.toThrow();
  });
  it("accepts server claims only", () => {
    const claims = { wallet_provider: "tron", wallet_address: addr("1") };
    expect(walletIdentity({ app_metadata: claims })).toEqual({
      chain: "tron",
      address: addr("1"),
    });
    expect(
      walletIdentity({ identities: [], ...{ user_metadata: claims } }),
    ).toBeNull();
  });
  it.each(["pay", "approve", "reset"] as const)(
    "accepts exact %s instruction",
    (step) =>
      expect(() =>
        assertTronTransaction(sale, step, unsigned(step)),
      ).not.toThrow(),
  );
  it.each([
    "recipient",
    "owner",
    "data",
    "value",
    "permission",
    "fee",
    "expiration",
    "extra",
  ])("rejects mutated %s", (kind) => {
    const t = unsigned(),
      c = t.raw_data.contract[0];
    if (kind === "recipient")
      c.parameter.value.contract_address = hex(addr("5"));
    if (kind === "owner") c.parameter.value.owner_address = hex(addr("5"));
    if (kind === "data") c.parameter.value.data += "00";
    if (kind === "value") c.parameter.value.call_value = 1;
    if (kind === "permission") c.Permission_id = 2;
    if (kind === "fee") t.raw_data.fee_limit = 1000000001;
    if (kind === "expiration") t.raw_data.expiration = Date.now() - 1;
    if (kind === "extra") t.raw_data.contract.push(c);
    expect(() => assertTronTransaction(sale, "pay", t)).toThrow();
  });
  it("accepts the exact confirmed split", () =>
    expect(verifyTronReceipt(sale, hash, receipt(), chainTx()).block).toBe(
      "999",
    ));
  it.each([
    "hash",
    "failure",
    "missing-event",
    "other-router",
    "replay",
    "amount",
    "time",
    "buyer",
  ])("rejects invalid receipt: %s", (kind) => {
    const r = receipt(),
      t = chainTx(),
      order = { ...sale };
    if (kind === "hash") r.id = "ff".repeat(32);
    if (kind === "failure") r.receipt.result = "REVERT";
    if (kind === "missing-event") r.log = [];
    if (kind === "other-router")
      r.log[0].address = tronToEvm(addr("5")).slice(2);
    if (kind === "replay") order.id = crypto.randomUUID();
    if (kind === "amount") order.amount = "1000001";
    if (kind === "time") r.blockTimeStamp = Date.parse(sale.expires_at) + 1;
    if (kind === "buyer")
      t.raw_data.contract[0].parameter.value.owner_address = hex(addr("5"));
    expect(() => verifyTronReceipt(order, hash, r, t)).toThrow();
  });
  it("accounts for owned resources without pooling bandwidth", () => {
    expect(tronResourceBudget(100, 200, 100, 1000, {})).toBe(210000n);
    expect(
      tronResourceBudget(100, 200, 100, 1000, {
        EnergyLimit: 100,
        NetLimit: 300,
      }),
    ).toBe(0n);
    expect(
      tronResourceBudget(100, 200, 100, 1000, {
        EnergyLimit: 100,
        EnergyUsed: 50,
        NetLimit: 100,
        freeNetLimit: 100,
      }),
    ).toBe(205000n);
  });
  it("uses 18 decimals for BEP20 USDT commission", async () => {
    expect((await feeQuote("bsc:USDT")).fixedFee).toBe(parseUnits("0.5", 18));
    expect(
      platformFee(parseUnits("2.5", 18) - 1n, "bsc:USDT", "1").feeBps,
    ).toBe(1000);
    expect(platformFee(parseUnits("2.5", 18), "bsc:USDT", "1").fixedFee).toBe(
      parseUnits("0.5", 18),
    );
  });
});
