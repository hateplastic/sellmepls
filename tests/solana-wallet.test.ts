import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import type { Wallet } from "@wallet-standard/base";
const registry = vi.hoisted(() => ({ wallets: [] as unknown[] }));
vi.mock("@wallet-standard/app", () => ({ getWallets: () => ({ get: () => registry.wallets }) }));
vi.mock("../lib/network", () => ({ TESTNET: false }));
import { connectSolana, solanaWallets } from "../lib/solana-wallet";
const buyer = Keypair.generate();
function standardWallet() {
  const account = { address: buyer.publicKey.toBase58(), publicKey: buyer.publicKey.toBytes(), chains: ["solana:mainnet"], features: ["solana:signMessage", "solana:signTransaction"] };
  const signMessage = vi.fn(async ({ message }: { message: Uint8Array }) => [{ signedMessage: message, signature: new Uint8Array(64) }]);
  const signTransaction = vi.fn(async ({ transaction }: { transaction: Uint8Array }) => {
    const tx = Transaction.from(transaction); tx.sign(buyer);
    return [{ signedTransaction: tx.serialize() }];
  });
  const wallet = { name: "Test Standard Wallet", version: "1.0.0", chains: ["solana:mainnet"], accounts: [account], features: {
    "standard:connect": { connect: async () => ({ accounts: [account] }) },
    "solana:signMessage": { signMessage },
    "solana:signTransaction": { supportedTransactionVersions: ["legacy"], signTransaction },
  } } as unknown as Wallet;
  registry.wallets = [wallet];
  return { wallet, signMessage, signTransaction };
}
beforeEach(() => {
  registry.wallets = [];
  const items = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => items.get(key), setItem: (key: string, value: string) => items.set(key, value), removeItem: (key: string) => items.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());
describe("Solana Wallet Standard payment adapter", () => {
  it("discovers compatible providers and remembers the selected wallet", async () => {
    const { wallet } = standardWallet();
    expect(solanaWallets()).toEqual([wallet]);
    const connected = await connectSolana(wallet.name);
    expect(connected.publicKey.equals(buyer.publicKey)).toBe(true);
    expect((await connectSolana(undefined, buyer.publicKey.toBase58())).name).toBe(wallet.name);
  });
  it("refuses a different buyer address before requesting a payment signature", async () => {
    const { wallet, signTransaction } = standardWallet();
    await expect(connectSolana(wallet.name, Keypair.generate().publicKey.toBase58())).rejects.toThrow(/адрес/);
    expect(signTransaction).not.toHaveBeenCalled();
  });
  it("refuses signing messages changed by the wallet", async () => {
    const { wallet, signMessage } = standardWallet();
    signMessage.mockResolvedValue([{ signedMessage: new TextEncoder().encode("different"), signature: new Uint8Array(64) }]);
    const connected = await connectSolana(wallet.name);
    await expect(connected.signMessage(new TextEncoder().encode("original"))).rejects.toThrow(/изменил сообщение/);
  });
  it("signs the exact transaction with no changed transfers", async () => {
    const { wallet } = standardWallet();
    const tx = new Transaction({ feePayer: buyer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(SystemProgram.transfer({ fromPubkey: buyer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1000 }));
    const connected = await connectSolana(wallet.name), signed = await connected.signTransaction(tx);
    expect(signed.serializeMessage().equals(tx.serializeMessage())).toBe(true);
    expect(signed.verifySignatures()).toBe(true);
  });
  it("rejects a modified destination before anything is broadcast", async () => {
    const { wallet, signTransaction } = standardWallet();
    signTransaction.mockImplementation(async ({ transaction }) => {
      const tx = Transaction.from(transaction);
      tx.instructions[0].keys[1].pubkey = Keypair.generate().publicKey;
      tx.sign(buyer);
      return [{ signedTransaction: tx.serialize() }];
    });
    const tx = new Transaction({ feePayer: buyer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(SystemProgram.transfer({ fromPubkey: buyer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1000 }));
    const connected = await connectSolana(wallet.name);
    await expect(connected.signTransaction(tx)).rejects.toThrow(/изменил платёж/);
  });
  it("does not substitute another provider if the selected one is missing", async () => {
    standardWallet();
    await expect(connectSolana("Missing Wallet")).rejects.toThrow(/Missing Wallet/);
  });
});
