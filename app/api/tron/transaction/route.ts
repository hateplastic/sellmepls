import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { utils } from "tronweb";
import { requireUser, rateLimit } from "@/lib/auth";
import { sameOrigin, readJson, json, failure, HttpError } from "@/lib/http";
import { adminDb } from "@/lib/supabase/server";
import { CHAIN_ENV } from "@/lib/network";
import { referralEnv } from "@/lib/env";
import { prepareTronStep } from "@/lib/tron-payment";
import {
  assertTronTransaction,
  type TronSignedTransaction,
  type TronStep,
} from "@/lib/tron-transaction";
import { assertTronNetwork, tronRpc } from "@/lib/tron-rpc";
import { evmToTron } from "@/lib/tron-address";
import type { Sale } from "@/lib/catalog";
export const maxDuration = 60;
function ticket(id: string, step: TronStep, raw: string) {
  return createHmac("sha256", referralEnv().REFERRAL_SECRET)
    .update(`tron:${CHAIN_ENV}:${id}:${step}:${raw}`)
    .digest();
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    await rateLimit(`tron-pay:${user.id}`, 40);
    const input = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("prepare"), orderId: z.string().uuid() }),
        z.object({
          action: z.literal("send"),
          orderId: z.string().uuid(),
          step: z.enum(["reset", "approve", "pay"]),
          transaction: z.unknown(),
          ticket: z.string().regex(/^[0-9a-f]{64}$/),
        }),
        z.object({
          action: z.literal("status"),
          orderId: z.string().uuid(),
          hash: z.string().regex(/^[0-9a-fA-F]{64}$/),
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
      user.chain !== "tron" ||
      order.network !== "tron" ||
      user.address !== order.buyer_wallet
    )
      throw new HttpError(403, "Войдите кошельком покупателя TRON");
    if (input.action === "status") {
      const receipt = await tronRpc<{
        id?: string;
        receipt?: { result?: string };
        result?: string;
      }>("walletsolidity/gettransactioninfobyid", { value: input.hash });
      return json({
        confirmed: Boolean(receipt.id),
        success: receipt.receipt?.result === "SUCCESS" && !receipt.result,
      });
    }
    if (
      order.status !== "pending" ||
      order.reservation_released_at ||
      Date.parse(order.expires_at) <= Date.now()
    )
      throw new HttpError(409, "Срок оплаты истёк или заказ закрыт");
    await assertTronNetwork();
    if (input.action === "prepare") {
      if (order.tx_hash)
        throw new HttpError(
          409,
          "Платёж уже отправлен; восстановите проверку заказа",
        );
      const available = await db
        .from("products")
        .select("id")
        .eq("id", order.product_id)
        .eq("active", true)
        .eq("is_hidden", false)
        .maybeSingle();
      if (available.error) throw available.error;
      if (!available.data)
        throw new HttpError(409, "Продажа товара приостановлена");
      const prepared = await prepareTronStep(order);
      return json({
        ...prepared,
        ticket: ticket(
          order.id,
          prepared.step,
          prepared.transaction.raw_data_hex,
        ).toString("hex"),
      });
    }
    const tx = input.transaction as TronSignedTransaction;
    try {
      assertTronTransaction(order, input.step, tx);
      if (
        !utils.transaction.txCheck(tx) ||
        tx.signature?.length !== 1 ||
        !timingSafeEqual(
          ticket(order.id, input.step, tx.raw_data_hex),
          Buffer.from(input.ticket, "hex"),
        )
      )
        throw new Error();
      const signer = utils.crypto.ecRecover(tx.txID, tx.signature[0]);
      if (
        evmToTron(`0x${signer.replace(/^0x/, "").slice(-40)}`) !== user.address
      )
        throw new Error();
    } catch {
      throw new HttpError(403, "Подпись, сумма или получатели TRON изменены");
    }
    if (input.step === "pay") {
      const saved = await db
        .from("sales")
        .update({ tx_hash: tx.txID, verification_error: null })
        .eq("id", order.id)
        .eq("status", "pending")
        .is("reservation_released_at", null)
        .or(`tx_hash.is.null,tx_hash.eq.${tx.txID}`)
        .select("id");
      if (saved.error) throw saved.error;
      if (!saved.data?.length)
        throw new HttpError(409, "Состояние заказа изменилось");
    }
    let broadcast: { result?: boolean; code?: string };
    try {
      broadcast = await tronRpc("wallet/broadcasttransaction", tx);
    } catch {
      return json({ hash: tx.txID, pending: true }, 202);
    }
    if (!broadcast.result && broadcast.code !== "DUP_TRANSACTION_ERROR") {
      if (input.step === "pay")
        await db
          .from("sales")
          .update({ tx_hash: null })
          .eq("id", order.id)
          .eq("status", "pending")
          .eq("tx_hash", tx.txID);
      throw new HttpError(
        422,
        `TRON отклонил отправку (${broadcast.code || "RPC rejected"}). Обновите расчёт операции.`,
      );
    }
    return json({ hash: tx.txID, pending: false });
  } catch (error) {
    return failure(error);
  }
}
