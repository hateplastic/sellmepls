import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  type ParsedTransactionWithMeta,
  type ParsedInstruction,
} from "@solana/web3.js";
import { encodeEventTopics, encodeAbiParameters, zeroAddress } from "viem";
import {
  atomicPrice,
  split,
  saleParts,
  orderReference,
  ASSETS,
  type Sale,
} from "../lib/catalog";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
} from "../lib/spl";
import {
  verifySolanaTransaction,
  verifyPayment,
  MEMO_PROGRAM,
  InvalidPayment,
  PaymentPending,
} from "../lib/verify";
import { routerAbi, evmClient } from "../lib/web3";
vi.mock("../lib/web3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/web3")>()),
  evmClient: vi.fn(),
}));
const buyer = Keypair.generate().publicKey,
  seller = Keypair.generate().publicKey,
  platform = Keypair.generate().publicKey;
const now = Math.floor(Date.now() / 1000);
const sale: Sale = {
  delivery_mode: "file",
  quantity: 1,
  unit_amount: "1000000000",
  checkout_key: null,
  reservation_released_at: null,
  payment_started_at: null,
  solana_last_valid_height: null,
  solana_blockhashes: [],
  solana_first_slot: null,
  id: "11111111-1111-4111-8111-111111111111",
  product_id: crypto.randomUUID(),
  seller_id: crypto.randomUUID(),
  buyer_id: crypto.randomUUID(),
  buyer_wallet: buyer.toBase58(),
  seller_wallet: seller.toBase58(),
  platform_wallet: platform.toBase58(),
  asset: "solana:SOL",
  network: "solana",
  amount: "1000000000",
  fee: "50500000",
  fixed_fee: "500000",
  fee_bps: 500,
  commission_version: 1,
  affiliate_amount: "0",
  affiliate_wallet: null,
  affiliate_id: null,
  affiliate_link_id: null,
  affiliate_bps: 0,
  usd_rate: "1000",
  rate_quoted_at: new Date(now * 1000).toISOString(),
  quote_signature: null,
  chain_environment: "testnet",
  router: null,
  status: "pending",
  tx_hash: null,
  created_at: new Date((now - 10) * 1000).toISOString(),
  expires_at: new Date((now + 1000) * 1000).toISOString(),
  paid_at: null,
  block_number: null,
};
function txFor(order: Sale): ParsedTransactionWithMeta {
  const asset = ASSETS[order.asset],
    amounts = saleParts(order);
  const transfers = [
    { destination: order.seller_wallet, amount: amounts.seller },
    { destination: order.platform_wallet, amount: amounts.fee },
    ...(order.affiliate_wallet
      ? [{ destination: order.affiliate_wallet, amount: amounts.affiliate }]
      : []),
  ].map(({ destination, amount }) => {
    if (asset.symbol === "SOL")
      return {
        programId: SystemProgram.programId,
        program: "system",
        parsed: {
          type: "transfer",
          info: {
            source: order.buyer_wallet,
            destination,
            lamports: Number(amount),
          },
        },
      };
    const mint = new PublicKey(asset.address);
    return {
      programId: TOKEN_PROGRAM_ID,
      program: "spl-token",
      parsed: {
        type: "transferChecked",
        info: {
          authority: order.buyer_wallet,
          mint: asset.address,
          source: getAssociatedTokenAddressSync(mint, buyer).toBase58(),
          destination: getAssociatedTokenAddressSync(
            mint,
            new PublicKey(destination),
          ).toBase58(),
          tokenAmount: {
            amount: amount.toString(),
            decimals: 6,
            uiAmount: null,
            uiAmountString: "",
          },
        },
      },
    };
  });
  return {
    slot: 123,
    blockTime: now,
    version: "legacy",
    meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
    transaction: {
      signatures: ["signature"],
      message: {
        accountKeys: [{ pubkey: buyer, signer: true, writable: true }],
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions: [
          ...transfers,
          {
            programId: new PublicKey(MEMO_PROGRAM),
            program: "spl-memo",
            parsed: `sellmepls:${order.id}`,
          },
        ],
      },
    },
  };
}
describe("money precision", () => {
  it("preserves ETH wei and rounds fee down", () => {
    expect(
      atomicPrice({ asset: "base:ETH", amount: "1.234567891234567891" }),
    ).toBe(1234567891234567891n);
    expect(split(10_000_000n, 500_000n, 1000)).toEqual({
      fee: 1_000_000n,
      affiliate: 1_000_000n,
      seller: 8_000_000n,
    });
  });
  it.each(["0", "-1", "1e3", "0.0000001", "1,20"])(
    "rejects invalid USDC price %s",
    (amount) =>
      expect(() => atomicPrice({ asset: "base:USDC", amount })).toThrow(),
  );
  it("rejects prototype properties as assets", () =>
    expect(() =>
      atomicPrice({ asset: "__proto__" as "base:USDC", amount: "1" }),
    ).toThrow());
});
describe("Solana verification", () => {
  it("accepts stock only for an issued blockhash and rejects released reservations", () => {
    const stock = { ...sale, delivery_mode: "stock" as const, quantity: 30 };
    const transaction = txFor(stock);
    expect(() => verifySolanaTransaction(stock, transaction)).toThrow(/резерв/);
    stock.solana_blockhashes = [
      transaction.transaction.message.recentBlockhash,
    ];
    expect(verifySolanaTransaction(stock, transaction).block).toBe("123");
    expect(() =>
      verifySolanaTransaction(
        { ...stock, reservation_released_at: new Date().toISOString() },
        transaction,
      ),
    ).toThrow(/резерв/);
  });
  it.each(["solana:SOL", "solana:USDC"] as const)(
    "verifies all three recipients for %s",
    (asset) => {
      const order = {
        ...sale,
        asset,
        affiliate_wallet: Keypair.generate().publicKey.toBase58(),
        affiliate_amount: "100000000",
      };
      expect(verifySolanaTransaction(order, txFor(order)).block).toBe("123");
      const tx = txFor(order);
      (
        tx.transaction.message.instructions[2] as ParsedInstruction
      ).parsed.info.destination = Keypair.generate().publicKey.toBase58();
      expect(() => verifySolanaTransaction(order, tx)).toThrow(InvalidPayment);
    },
  );
  it("rejects a missing affiliate transfer", () => {
    const order = {
      ...sale,
      affiliate_wallet: Keypair.generate().publicKey.toBase58(),
      affiliate_amount: "100000000",
    };
    const tx = txFor(order);
    tx.transaction.message.instructions.splice(2, 1);
    expect(() => verifySolanaTransaction(order, tx)).toThrow(InvalidPayment);
  });
  it.each(["solana:SOL", "solana:USDC", "solana:USDT"] as const)(
    "accepts an exact atomic split for %s",
    (asset) => {
      const order = { ...sale, asset };
      expect(verifySolanaTransaction(order, txFor(order)).block).toBe("123");
    },
  );
  it("rejects another order memo", () => {
    const tx = txFor(sale);
    (tx.transaction.message.instructions[2] as ParsedInstruction).parsed =
      "sellmepls:another";
    expect(() => verifySolanaTransaction(sale, tx)).toThrow(InvalidPayment);
  });
  it("rejects missing fee", () => {
    const tx = txFor(sale);
    tx.transaction.message.instructions.splice(1, 1);
    expect(() => verifySolanaTransaction(sale, tx)).toThrow();
  });
  it("rejects underpayment", () => {
    const tx = txFor(sale);
    (tx.transaction.message.instructions[0] as ParsedInstruction).parsed.info
      .lamports--;
    expect(() => verifySolanaTransaction(sale, tx)).toThrow();
  });
  it("rejects self payment", () => {
    const order = { ...sale, seller_wallet: sale.buyer_wallet };
    expect(() => verifySolanaTransaction(order, txFor(order))).toThrow();
  });
  it("rejects a forged token mint", () => {
    const order = { ...sale, asset: "solana:USDC" as const },
      tx = txFor(order);
    (
      tx.transaction.message.instructions[0] as ParsedInstruction
    ).parsed.info.mint = Keypair.generate().publicKey.toBase58();
    expect(() => verifySolanaTransaction(order, tx)).toThrow();
  });
  it("rejects a failed transaction", () => {
    const tx = txFor(sale);
    tx.meta!.err = { InstructionError: [1, "InvalidArgument"] };
    expect(() => verifySolanaTransaction(sale, tx)).toThrow();
  });
  it("rejects extra token instructions", () => {
    const order = { ...sale, asset: "solana:USDC" as const },
      tx = txFor(order);
    tx.transaction.message.instructions.push({
      programId: TOKEN_PROGRAM_ID,
      program: "spl-token",
      parsed: { type: "closeAccount", info: {} },
    });
    expect(() => verifySolanaTransaction(order, tx)).toThrow();
  });
  it("honors a late Solana payment against its immutable quote", () => {
    const tx = txFor(sale);
    tx.blockTime = now + 2000;
    expect(verifySolanaTransaction(sale, tx).block).toBe("123");
  });
  it("encodes TransferChecked with an exact u64", () => {
    const ix = createTransferCheckedInstruction(
      buyer,
      seller,
      platform,
      buyer,
      9007199254740991n,
      6,
    );
    expect(ix.data.toString("hex")).toBe("0cffffffffffff1f0006");
    expect(ix.keys[3].isSigner).toBe(true);
  });
});
describe("EVM verification", () => {
  const router = "0x1111111111111111111111111111111111111111",
    payer = "0x2222222222222222222222222222222222222222",
    recipient = "0x3333333333333333333333333333333333333333";
  const order: Sale = {
    ...sale,
    network: "base",
    asset: "base:ETH",
    router,
    buyer_wallet: payer,
    seller_wallet: recipient,
  };
  function receipt() {
    return {
      status: "success",
      from: payer,
      to: router,
      blockNumber: 10n,
      blockHash: "0xabc",
      logs: [
        {
          address: router,
          topics: encodeEventTopics({
            abi: routerAbi,
            eventName: "Paid",
            args: {
              orderId: orderReference(order.id),
              buyer: payer,
              seller: recipient,
            },
          }),
          data: encodeAbiParameters(
            [
              { type: "address" },
              { type: "uint256" },
              { type: "uint256" },
              { type: "address" },
              { type: "uint256" },
            ],
            [zeroAddress, 1000000000n, 50500000n, zeroAddress, 0n],
          ),
        },
      ],
    };
  }
  let current: ReturnType<typeof receipt>, head: bigint;
  beforeEach(() => {
    current = receipt();
    head = 10n;
    vi.mocked(evmClient).mockReturnValue({
      chain: { id: 8453 },
      getChainId: async () => 8453,
      getTransactionReceipt: async () => current,
      getBlockNumber: async () => head,
      getBlock: async () => ({ hash: "0xabc", timestamp: BigInt(now) }),
    } as unknown as ReturnType<typeof evmClient>);
  });
  const verify = () =>
    verifyPayment(order, `0x${"a".repeat(64)}`, {
      rpc: "https://rpc.invalid",
      confirmations: 1,
      solanaCommitment: "confirmed",
    });
  it("accepts successful canonical payment", async () =>
    expect((await verify()).block).toBe("10"));
  it("rejects a forged emitter", async () => {
    current.logs[0].address = payer;
    await expect(verify()).rejects.toThrow(InvalidPayment);
  });
  it("rejects a failed receipt", async () => {
    current.status = "reverted";
    await expect(verify()).rejects.toThrow(InvalidPayment);
  });
  it("waits for enough confirmations", async () => {
    head = 9n;
    await expect(verify()).rejects.toThrow(PaymentPending);
  });
  it("accepts a batched payment through a wallet executor", async () => {
    current.to = recipient;
    expect((await verify()).block).toBe("10");
  });
  it("accepts a relayed payment when the router event proves the buyer", async () => {
    current.from = recipient;
    current.to = recipient;
    expect((await verify()).block).toBe("10");
  });
  it("rejects another buyer in the authenticated router event", async () => {
    current.logs[0].topics = encodeEventTopics({
      abi: routerAbi,
      eventName: "Paid",
      args: {
        orderId: orderReference(order.id),
        buyer: recipient,
        seller: recipient,
      },
    });
    await expect(verify()).rejects.toThrow(InvalidPayment);
  });
  it("rejects another order in the authenticated router event", async () => {
    current.logs[0].topics = encodeEventTopics({
      abi: routerAbi,
      eventName: "Paid",
      args: {
        orderId: orderReference(crypto.randomUUID()),
        buyer: payer,
        seller: recipient,
      },
    });
    await expect(verify()).rejects.toThrow(InvalidPayment);
  });
  it("rejects duplicate matching events", async () => {
    current.logs.push(current.logs[0]);
    await expect(verify()).rejects.toThrow(InvalidPayment);
  });
  it("finds the exact order when a batch contains other payments", async () => {
    current.to = recipient;
    current.logs.push({
      ...current.logs[0],
      topics: encodeEventTopics({
        abi: routerAbi,
        eventName: "Paid",
        args: {
          orderId: orderReference(crypto.randomUUID()),
          buyer: payer,
          seller: recipient,
        },
      }),
    });
    expect((await verify()).block).toBe("10");
  });
  it("rejects wrong event amount", async () => {
    current.logs[0].data = encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
      ],
      [zeroAddress, 1n, 0n, zeroAddress, 0n],
    );
    await expect(verify()).rejects.toThrow(InvalidPayment);
  });
});
