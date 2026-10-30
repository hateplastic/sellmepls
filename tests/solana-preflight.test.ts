import { describe, expect, it, vi } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  type Connection,
} from "@solana/web3.js";
import { inspectSolanaPayment } from "../lib/solana-preflight";
import { buildSolanaTransaction } from "../lib/solana-transaction";
import { ASSETS, type Sale } from "../lib/catalog";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "../lib/spl";
vi.mock("server-only", () => ({}));
const sale = {
  id: crypto.randomUUID(),
  network: "solana",
  asset: "solana:SOL",
  amount: "1000000",
  fee: "100000",
  affiliate_amount: "0",
  affiliate_wallet: null,
  buyer_wallet: Keypair.generate().publicKey.toBase58(),
  seller_wallet: Keypair.generate().publicKey.toBase58(),
  platform_wallet: Keypair.generate().publicKey.toBase58(),
} as Sale;
const account = (lamports: number) => ({
  lamports,
  data: Buffer.alloc(0),
  owner: SystemProgram.programId,
  executable: false,
  rentEpoch: 0,
});
function rpc(accounts: unknown[]) {
  return {
    getMultipleAccountsInfo: vi.fn().mockResolvedValue(accounts),
    getFeeForMessage: vi.fn().mockResolvedValue({ value: 5000 }),
    getMinimumBalanceForRentExemption: vi
      .fn()
      .mockImplementation(async (size: number) => (size ? 2039280 : 650240)),
    simulateTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
  } as unknown as Connection;
}
const tx = (order = sale) =>
  buildSolanaTransaction(order, Keypair.generate().publicKey.toBase58());
describe("Native SOL and token preflight", () => {
  it("builds SOL with only system transfers plus memo and the buyer as fee payer", () => {
    const built = tx();
    expect(built.feePayer?.toBase58()).toBe(sale.buyer_wallet);
    expect(
      built.instructions.filter((i) =>
        i.programId.equals(SystemProgram.programId),
      ),
    ).toHaveLength(2);
    expect(
      built.instructions.some(
        (i) =>
          i.programId.equals(TOKEN_PROGRAM_ID) ||
          i.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID),
      ),
    ).toBe(false);
  });
  it("simulates a funded 0.001 SOL payment without any token balance", async () => {
    const connection = rpc([
      account(2639283),
      account(1000000),
      account(890880),
    ]);
    const result = await inspectSolanaPayment(sale, tx(), connection);
    expect(result.ready).toBe(true);
    expect(result.tokenBalance).toBeNull();
    expect(result.accountRent).toBe("0");
    expect(result.totalSolCost).toBe("0.001005");
    expect(connection.simulateTransaction).toHaveBeenCalled();
  });
  it("explains a tiny payment to an empty recipient instead of blaming the buyer's token balance", async () => {
    const result = await inspectSolanaPayment(
      sale,
      tx(),
      rpc([account(3000000), account(1000000), null]),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.join(" ")).toMatch(
      /платформы.*предварительно пополнить/,
    );
  });
  it("accounts for a low nonzero payer remainder", async () => {
    const result = await inspectSolanaPayment(
      sale,
      tx(),
      rpc([account(1100000), account(1000000), account(1000000)]),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.join(" ")).toMatch(/минимального остатка/);
  });
  it("does not charge rent for an affiliate whose rounded payout is zero", async () => {
    const order = {
      ...sale,
      affiliate_wallet: Keypair.generate().publicKey.toBase58(),
    };
    const connection = rpc([
      account(3000000),
      account(1000000),
      account(1000000),
    ]);
    const result = await inspectSolanaPayment(order, tx(order), connection);
    expect(result.ready).toBe(true);
    expect(
      vi.mocked(connection.getMultipleAccountsInfo).mock.calls[0][0],
    ).toHaveLength(3);
  });
  it("does not confuse SOL with USDC and includes rent for missing token accounts", async () => {
    const order = { ...sale, asset: "solana:USDC" as const };
    const built = tx(order);
    expect(
      built.instructions.filter((i) => i.programId.equals(TOKEN_PROGRAM_ID)),
    ).toHaveLength(2);
    const result = await inspectSolanaPayment(
      order,
      built,
      rpc([account(10000000), null, null, null]),
    );
    expect(result.ready).toBe(false);
    expect(result.accountRent).toBe("0.00407856");
    expect(result.issues.join(" ")).toMatch(/Баланс SOL не заменяет USDC/);
  });
  it("accepts an actual funded SPL account and no extra rent for existing ATAs", async () => {
    const order = { ...sale, asset: "solana:USDC" as const },
      data = Buffer.alloc(165);
    new PublicKey(ASSETS[order.asset].address).toBuffer().copy(data, 0);
    new PublicKey(order.buyer_wallet).toBuffer().copy(data, 32);
    data.writeBigUInt64LE(2000000n, 64);
    data[108] = 1;
    const token = { ...account(2039280), data, owner: TOKEN_PROGRAM_ID };
    const result = await inspectSolanaPayment(
      order,
      tx(order),
      rpc([account(1000000), token, token, token]),
    );
    expect(result.ready).toBe(true);
    expect(result.tokenBalance).toBe("2");
    expect(result.accountRent).toBe("0");
  });
});
