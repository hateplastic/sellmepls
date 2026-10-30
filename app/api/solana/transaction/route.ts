import { z } from "zod";
import { Transaction, SendTransactionError } from "@solana/web3.js";
import bs58 from "bs58";
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireUser, rateLimit } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/server";
import { sameOrigin, readJson, json, failure, HttpError } from "@/lib/http";
import { settlementEnv, referralEnv } from "@/lib/env";
import { CHAIN_ENV } from "@/lib/network";
import {
  solanaConnection,
  SOLANA_GENESIS,
  SolanaRpcHttpError,
} from "@/lib/web3";
import { buildSolanaTransaction } from "@/lib/solana-transaction";
import type { Sale } from "@/lib/catalog";
import { inspectSolanaPayment } from "@/lib/solana-preflight";
export const runtime = "nodejs";
export const maxDuration = 60;
function ticket(orderId: string, message: Buffer) {
  return createHmac("sha256", referralEnv().REFERRAL_SECRET)
    .update(`solana-payment:${CHAIN_ENV}:${orderId}:`)
    .update(message)
    .digest();
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    await rateLimit(`solana:${user.id}`, 30);
    const input = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("inspect"), orderId: z.string().uuid() }),
        z.object({ action: z.literal("prepare"), orderId: z.string().uuid() }),
        z.object({
          action: z.literal("send"),
          orderId: z.string().uuid(),
          transaction: z
            .string()
            .max(1800)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/),
          ticket: z.string().regex(/^[0-9a-f]{64}$/),
        }),
      ])
      .parse(await readJson(request));
    const db = adminDb(),
      result = await db
        .from("sales")
        .select("*")
        .eq("id", input.orderId)
        .eq("buyer_id", user.id)
        .eq("chain_environment", CHAIN_ENV)
        .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new HttpError(404, "Заказ не найден");
    const order = result.data as Sale;
    if (
      user.chain !== "solana" ||
      order.network !== "solana" ||
      order.buyer_wallet !== user.address
    )
      throw new HttpError(403, "Нужен кошелёк покупателя Solana");
    if (
      order.status !== "pending" ||
      order.reservation_released_at ||
      Date.parse(order.expires_at) <= Date.now()
    )
      throw new HttpError(
        409,
        "Заказ уже оплачен или срок истёк. Обновите страницу.",
      );
    const connection = solanaConnection(settlementEnv().SOLANA_RPC_URL);
    if ((await connection.getGenesisHash()) !== SOLANA_GENESIS)
      throw new HttpError(503, "RPC настроен на другую сеть Solana");
    if (input.action === "prepare" || input.action === "inspect") {
      if (order.tx_hash)
        throw new HttpError(
          409,
          "У заказа уже есть отправленная транзакция. Обновите страницу для проверки.",
        );
      const product = await db
        .from("products")
        .select("id")
        .eq("id", order.product_id)
        .eq("active", true)
        .eq("is_hidden", false)
        .maybeSingle();
      if (product.error) throw product.error;
      if (!product.data)
        throw new HttpError(409, "Продажа товара приостановлена");
      const { value: latest, context } =
        await connection.getLatestBlockhashAndContext("confirmed");
      const tx = buildSolanaTransaction(order, latest.blockhash);
      const estimate = await inspectSolanaPayment(order, tx, connection);
      if (input.action === "inspect") return json(estimate);
      if (order.delivery_mode === "stock") {
        const armed = await db.rpc("arm_inventory_payment", {
          p_id: order.id,
          p_height: latest.lastValidBlockHeight,
          p_blockhash: latest.blockhash,
          p_slot: context.slot,
        });
        if (armed.error) throw armed.error;
        if (!armed.data)
          throw new HttpError(409, "Срок резерва истёк. Обновите заказ");
      }
      return json({
        estimate,
        transaction: tx
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString("base64"),
        ticket: ticket(order.id, tx.serializeMessage()).toString("hex"),
      });
    }
    let tx: Transaction;
    try {
      tx = Transaction.from(Buffer.from(input.transaction, "base64"));
    } catch {
      throw new HttpError(400, "Неверный формат транзакции");
    }
    if (
      !tx.feePayer ||
      tx.feePayer.toBase58() !== user.address ||
      !tx.signature ||
      !tx.verifySignatures()
    )
      throw new HttpError(403, "Подпись покупателя не прошла проверку");
    const message = tx.serializeMessage();
    if (
      !timingSafeEqual(
        ticket(order.id, message),
        Buffer.from(input.ticket, "hex"),
      ) ||
      !message.equals(
        buildSolanaTransaction(order, tx.recentBlockhash!).serializeMessage(),
      )
    )
      throw new HttpError(403, "Суммы или получатели транзакции изменены");
    const hash = bs58.encode(tx.signature);
    if (order.tx_hash && order.tx_hash !== hash)
      throw new HttpError(409, "У заказа уже есть другая транзакция");
    const saved = await db
      .from("sales")
      .update({ tx_hash: hash, verification_error: null })
      .eq("id", order.id)
      .eq("status", "pending")
      .or(`tx_hash.is.null,tx_hash.eq.${hash}`)
      .select("id");
    if (saved.error) throw saved.error;
    if (!saved.data?.length)
      throw new HttpError(
        409,
        "Состояние заказа изменилось. Обновите страницу.",
      );
    try {
      await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 4,
      });
    } catch (error) {
      const refusedByProvider =
        error instanceof SolanaRpcHttpError &&
        [401, 403, 429].includes(error.status);
      if (error instanceof SendTransactionError || refusedByProvider) {
        const reset = await db
          .from("sales")
          .update({ tx_hash: null })
          .eq("id", order.id)
          .eq("status", "pending")
          .eq("tx_hash", hash);
        if (reset.error) throw reset.error;
        if (refusedByProvider)
          throw new HttpError(
            503,
            "RPC-провайдер временно отклонил отправку. Платёж не отправлен; повторите позже. Администратору нужно проверить доступ и лимит RPC.",
          );
        const estimate = await inspectSolanaPayment(order, tx, connection);
        if (!estimate.ready)
          throw new HttpError(422, estimate.issues.join("\n"));
        throw new HttpError(
          422,
          order.asset === "solana:SOL"
            ? "Сеть отклонила перевод SOL до отправки. Обновите расчёт и подпишите заново: blockhash мог истечь, пока кошелёк ожидал подтверждения. USDC/USDT для этой оплаты не нужны."
            : "Сеть отклонила перевод токена до отправки. Обновите расчёт и подпишите заново; проверьте баланс выбранного USDC/USDT и SOL для сетевых расходов.",
        );
      }
      // A timeout can occur after the node accepted the transaction. Preserve
      // its signature and let the existing verifier/worker establish the result.
      return json({ signature: hash, pending: true }, 202);
    }
    return json({ signature: hash, pending: false });
  } catch (error) {
    if (error instanceof SolanaRpcHttpError)
      return failure(
        new HttpError(
          503,
          "Не удалось связаться с Solana RPC. Повторите позже; администратору нужно проверить доступ и лимит провайдера.",
        ),
      );
    return failure(error);
  }
}
