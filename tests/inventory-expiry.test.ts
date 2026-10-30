import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sale } from "../lib/catalog";
vi.mock("server-only", () => ({}));
vi.mock("../lib/env", () => ({
  serverEvmRpc: () => "https://rpc.example",
  settlementEnv: () => ({
    SOLANA_RPC_URL: "https://rpc.example",
    BASE_RPC_URL: "https://rpc.example",
    ARBITRUM_RPC_URL: "https://rpc.example",
  }),
}));
vi.mock("../lib/supabase/server", () => ({ adminDb: vi.fn() }));
const mocks = vi.hoisted(() => ({
  settle: vi.fn(),
  genesis: vi.fn(),
  height: vi.fn(),
  first: vi.fn(),
  slot: vi.fn(),
  signatures: vi.fn(),
  block: vi.fn(),
  paid: vi.fn(),
}));
vi.mock("../lib/settlement", () => ({ settle: mocks.settle }));
vi.mock("../lib/web3", () => ({
  SOLANA_GENESIS: "genesis",
  routerAbi: [],
  solanaConnection: () => ({
    getGenesisHash: mocks.genesis,
    getBlockHeight: mocks.height,
    getFirstAvailableBlock: mocks.first,
    getSlot: mocks.slot,
    getSignaturesForAddress: mocks.signatures,
  }),
  evmClient: () => ({
    chain: { id: 84532 },
    getChainId: async () => 84532,
    getBlock: mocks.block,
    readContract: mocks.paid,
  }),
}));
import { inventoryCanExpire } from "../lib/inventory-expiry";
import { InvalidPayment, PaymentPending } from "../lib/verify";
const order = {
  id: "12345678-1234-1234-1234-123456789012",
  status: "pending",
  delivery_mode: "stock",
  network: "solana",
  buyer_wallet: "11111111111111111111111111111111",
  expires_at: new Date(Date.now() - 600000).toISOString(),
  payment_started_at: new Date(Date.now() - 900000).toISOString(),
  reservation_released_at: null,
  solana_last_valid_height: 100,
  solana_first_slot: 80,
} as Sale;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.genesis.mockResolvedValue("genesis");
  mocks.height.mockResolvedValue(110);
  mocks.first.mockResolvedValue(1);
  mocks.slot.mockResolvedValue(120);
  mocks.signatures.mockResolvedValue([]);
});
describe("Stock reservation expiry proof", () => {
  it("releases an unprepared expired order without an RPC request", async () => {
    expect(
      await inventoryCanExpire({ ...order, payment_started_at: null }),
    ).toBe(true);
    expect(mocks.genesis).not.toHaveBeenCalled();
  });
  it("holds until the last issued Solana blockhash is finalized as expired", async () => {
    mocks.height.mockResolvedValue(100);
    expect(await inventoryCanExpire(order)).toBe(false);
  });
  it("holds if retained chain history no longer covers the reservation", async () => {
    mocks.first.mockResolvedValue(81);
    expect(await inventoryCanExpire(order)).toBe(false);
  });
  it("recovers an on-chain payment lost by the browser instead of releasing it", async () => {
    mocks.signatures.mockResolvedValue([
      { slot: 90, signature: "paid", err: null },
    ]);
    mocks.settle.mockResolvedValue({ ...order, status: "paid" });
    expect(await inventoryCanExpire(order)).toBe(false);
    expect(mocks.settle).toHaveBeenCalledWith(order, "paid");
  });
  it("can release after inspecting unrelated transactions and reaching the history boundary", async () => {
    mocks.signatures.mockResolvedValue([
      { slot: 90, signature: "other", err: null },
      { slot: 79, signature: "old", err: null },
    ]);
    mocks.settle.mockRejectedValue(new InvalidPayment());
    expect(await inventoryCanExpire(order)).toBe(true);
    expect(mocks.settle).toHaveBeenCalledTimes(1);
  });
  it("does not treat missing transaction data or a provider error as proof of nonpayment", async () => {
    mocks.signatures.mockResolvedValue([
      { slot: 90, signature: "unknown", err: null },
    ]);
    mocks.settle.mockRejectedValue(new PaymentPending());
    await expect(inventoryCanExpire(order)).rejects.toBeInstanceOf(
      PaymentPending,
    );
  });
  it("keeps a busy wallet's reservation when the bounded scan cannot reach its start", async () => {
    mocks.signatures.mockResolvedValue(
      Array.from({ length: 101 }, () => ({
        slot: 90,
        signature: "other",
        err: { failed: true },
      })),
    );
    expect(await inventoryCanExpire(order)).toBe(false);
  });
  it("checks the router paid mapping at a finalized block strictly after quote expiry", async () => {
    const evm = {
      ...order,
      network: "base",
      buyer_wallet: "0x1111111111111111111111111111111111111111",
      router: "0x2222222222222222222222222222222222222222",
    } as Sale;
    mocks.block.mockResolvedValue({
      number: 123n,
      timestamp: BigInt(Math.ceil(Date.now() / 1000)),
    });
    mocks.paid.mockResolvedValue(true);
    expect(await inventoryCanExpire(evm)).toBe(false);
    mocks.paid.mockResolvedValue(false);
    expect(await inventoryCanExpire(evm)).toBe(true);
    expect(mocks.paid.mock.calls[0][0].blockNumber).toBe(123n);
  });
});
