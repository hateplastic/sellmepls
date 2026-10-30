import {
  getAddress,
  parseEventLogs,
  zeroAddress,
  TransactionReceiptNotFoundError,
  type Hex,
} from "viem";
import {
  PublicKey,
  SystemProgram,
  type ParsedTransactionWithMeta,
  type ParsedInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "./spl";
import { ASSETS, saleParts, orderReference, type Sale } from "./catalog";
import { CHAIN_ENV } from "./network";
import { routerAbi, evmClient, solanaConnection, SOLANA_GENESIS } from "./web3";
export class PaymentPending extends Error {}
export class InvalidPayment extends Error {}
export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const COMPUTE_PROGRAM = "ComputeBudget111111111111111111111111111111";
function demand(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InvalidPayment(message);
}
function checkTime(order: Sale, seconds: number) {
  demand(
    seconds * 1000 >= Date.parse(order.created_at) - 30_000 &&
      (order.network === "solana" ||
        seconds * 1000 <= Date.parse(order.expires_at)),
    "Платёж вне срока заказа",
  );
}
export function verifySolanaTransaction(
  order: Sale,
  tx: ParsedTransactionWithMeta,
) {
  demand(tx.meta && !tx.meta.err, "Транзакция отклонена сетью");
  demand(tx.blockTime, "Отсутствует время блока");
  checkTime(order, tx.blockTime);
  if (order.delivery_mode === "stock")
    demand(
      !order.reservation_released_at &&
        order.solana_blockhashes.includes(
          tx.transaction.message.recentBlockhash,
        ),
      "Транзакция не относится к действующему резерву товара",
    );
  demand(
    tx.transaction.message.accountKeys[0]?.pubkey.toBase58() ===
      order.buyer_wallet && tx.transaction.message.accountKeys[0]?.signer,
    "Кошелёк плательщика не совпадает",
  );
  const asset = ASSETS[order.asset],
    amounts = saleParts(order);
  demand(asset.network === "solana", "Неверная сеть");
  const instructions = tx.transaction.message.instructions;
  const memos = instructions.filter(
    (i) => i.programId.toBase58() === MEMO_PROGRAM,
  );
  demand(
    memos.length === 1 &&
      "parsed" in memos[0] &&
      memos[0].parsed === `sellmepls:${order.id}`,
    "Не совпадает идентификатор заказа",
  );
  const isNative = asset.symbol === "SOL";
  const allowed = new Set([
    MEMO_PROGRAM,
    COMPUTE_PROGRAM,
    isNative ? SystemProgram.programId.toBase58() : TOKEN_PROGRAM_ID.toBase58(),
    ...(!isNative ? [ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()] : []),
  ]);
  demand(
    instructions.every((i) => allowed.has(i.programId.toBase58())),
    "Недопустимая инструкция платежа",
  );
  const transfers = instructions.filter((i) =>
    i.programId.equals(isNative ? SystemProgram.programId : TOKEN_PROGRAM_ID),
  );
  const count = order.affiliate_wallet ? 3 : 2;
  demand(transfers.length === count, "Не совпадает число переводов");
  const expected = new Map([
    [order.seller_wallet, amounts.seller],
    [order.platform_wallet, amounts.fee],
  ]);
  if (order.affiliate_wallet)
    expected.set(order.affiliate_wallet, amounts.affiliate);
  demand(
    expected.size === count && !expected.has(order.buyer_wallet),
    "Получатели должны различаться",
  );
  for (const ix of transfers) {
    demand("parsed" in ix, "Нераспознанная инструкция");
    const parsed = (ix as ParsedInstruction).parsed;
    const info = parsed.info;
    if (isNative) {
      demand(
        parsed.type === "transfer" &&
          info.source === order.buyer_wallet &&
          Number.isSafeInteger(info.lamports),
        "Неверный перевод SOL",
      );
      demand(
        expected.get(info.destination) === BigInt(info.lamports),
        "Неверная сумма или получатель SOL",
      );
      expected.delete(info.destination);
    } else {
      demand(
        parsed.type === "transferChecked" &&
          info.authority === order.buyer_wallet &&
          info.mint === asset.address &&
          info.tokenAmount?.decimals === asset.decimals,
        "Неверный перевод токена",
      );
      const mint = new PublicKey(asset.address);
      demand(
        info.source ===
          getAssociatedTokenAddressSync(
            mint,
            new PublicKey(order.buyer_wallet),
          ).toBase58(),
        "Неверный источник токена",
      );
      const recipient = [...expected.keys()].find(
        (address) =>
          getAssociatedTokenAddressSync(
            mint,
            new PublicKey(address),
          ).toBase58() === info.destination,
      );
      demand(
        recipient &&
          expected.get(recipient) === BigInt(info.tokenAmount.amount),
        "Неверная сумма или получатель токена",
      );
      expected.delete(recipient);
    }
  }
  demand([...expected].length === 0, "Не найдены все части платежа");
  return {
    block: String(tx.slot),
    paidAt: new Date(tx.blockTime * 1000).toISOString(),
  };
}
export type VerifyConfig = {
  rpc: string;
  confirmations: number;
  solanaCommitment: "confirmed" | "finalized";
};
export async function verifyPayment(
  order: Sale,
  hash: string,
  config: VerifyConfig,
) {
  demand(
    order.chain_environment === CHAIN_ENV,
    "Заказ создан в другом окружении сети",
  );
  if (order.network === "solana") {
    const connection = solanaConnection(config.rpc);
    demand(
      (await connection.getGenesisHash()) === SOLANA_GENESIS,
      "RPC подключён к другой сети Solana",
    );
    const tx = await connection.getParsedTransaction(hash, {
      commitment: config.solanaCommitment,
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) throw new PaymentPending("Ожидаем подтверждение Solana");
    return verifySolanaTransaction(order, tx);
  }
  if (order.network === "tron") {
    const { verifyTronPayment } = await import("./verify-tron");
    return verifyTronPayment(order, hash);
  }
  const client = evmClient(order.network, config.rpc);
  demand(
    (await client.getChainId()) === client.chain.id,
    "RPC подключён к другой сети",
  );
  const receipt = await client
    .getTransactionReceipt({ hash: hash as Hex })
    .catch((error) => {
      if (error instanceof TransactionReceiptNotFoundError)
        throw new PaymentPending("Ожидаем включение в блок");
      throw error;
    });
  demand(receipt.status === "success", "Транзакция завершилась ошибкой");
  // Smart wallets may route payments through a batch executor or relayer.
  // Only the snapshotted router's Paid event proves the buyer and payment.
  demand(order.router, "Не указан платёжный контракт");
  const [head, block] = await Promise.all([
    client.getBlockNumber({ cacheTime: 0 }),
    client.getBlock({ blockNumber: receipt.blockNumber }),
  ]);
  if (head - receipt.blockNumber + 1n < BigInt(config.confirmations))
    throw new PaymentPending("Ожидаем подтверждения");
  demand(block.hash === receipt.blockHash, "Блок больше не канонический");
  checkTime(order, Number(block.timestamp));
  const logs = parseEventLogs({
    abi: routerAbi,
    eventName: "Paid",
    logs: receipt.logs.filter(
      (l) => getAddress(l.address) === getAddress(order.router!),
    ),
    strict: true,
  }).filter((log) => log.args.orderId === orderReference(order.id));
  demand(logs.length === 1, "Платёжное событие не найдено");
  const e = logs[0].args,
    asset = ASSETS[order.asset];
  demand(
    e.orderId === orderReference(order.id) &&
      getAddress(e.buyer) === getAddress(order.buyer_wallet) &&
      getAddress(e.seller) === getAddress(order.seller_wallet),
    "Событие не соответствует заказу",
  );
  demand(
    getAddress(e.token) ===
      getAddress(asset.address === "native" ? zeroAddress : asset.address),
    "Неверный токен",
  );
  demand(
    e.amount === BigInt(order.amount) &&
      e.fee === BigInt(order.fee) &&
      getAddress(e.affiliate) ===
        getAddress(order.affiliate_wallet || zeroAddress) &&
      e.affiliateAmount === BigInt(order.affiliate_amount),
    "Неверная сумма или комиссия",
  );
  return {
    block: receipt.blockNumber.toString(),
    paidAt: new Date(Number(block.timestamp) * 1000).toISOString(),
  };
}
