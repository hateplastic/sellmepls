import { z } from "zod";
import bs58 from "bs58";
import { requireUser, rateLimit } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/server";
import { sameOrigin, readJson, json, failure, HttpError } from "@/lib/http";
import { downloadUrl } from "@/lib/storage";
import { settle } from "@/lib/settlement";
import { InvalidPayment, PaymentPending } from "@/lib/verify";
import type { Sale } from "@/lib/catalog";
import { CHAIN_ENV } from "@/lib/network";
import { inventoryDownload } from "@/lib/inventory";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    await rateLimit(`verify:${user.id}`, 40);
    const input = z
      .object({
        orderId: z.string().uuid(),
        txHash: z.string().min(64).max(100),
      })
      .parse(await readJson(request));
    const db = adminDb();
    const { data, error } = await db
      .from("sales")
      .select("*")
      .eq("id", input.orderId)
      .eq("buyer_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Заказ не найден");
    const sale = data as Sale;
    if (sale.reservation_released_at)
      throw new HttpError(
        409,
        "Резерв этого заказа закрыт. Создайте новую покупку",
      );
    if (sale.chain_environment !== CHAIN_ENV)
      throw new HttpError(409, "Заказ относится к другому окружению сети");
    let hash = input.txHash;
    if (sale.network === "tron") {
      if (!/^[0-9a-fA-F]{64}$/.test(hash))
        throw new HttpError(400, "Некорректный TRON txID");
      hash = hash.toLowerCase();
    } else if (sale.network !== "solana") {
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
        throw new HttpError(400, "Некорректный EVM хеш");
      hash = hash.toLowerCase();
    } else {
      try {
        if (bs58.decode(hash).length !== 64) throw new Error();
      } catch {
        throw new HttpError(400, "Некорректная Solana signature");
      }
    }
    if (sale.status === "paid" && sale.tx_hash !== hash)
      throw new HttpError(409, "Этот заказ уже оплачен другой транзакцией");
    if (sale.status === "pending") {
      const { error: updateError } = await db
        .from("sales")
        .update({
          tx_hash: hash,
          checked_at: new Date().toISOString(),
          verification_error: null,
        })
        .eq("id", sale.id)
        .eq("status", "pending");
      if (updateError) throw updateError;
    }
    let paid: Sale;
    try {
      paid = await settle(sale, hash);
    } catch (error) {
      if (error instanceof PaymentPending)
        return json({ status: "pending", message: error.message }, 202);
      if (error instanceof InvalidPayment) {
        await db
          .from("sales")
          .update({ verification_error: error.message, tx_hash: null })
          .eq("id", sale.id)
          .eq("status", "pending")
          .eq("tx_hash", hash);
        throw new HttpError(422, error.message);
      }
      throw error;
    }
    if (paid.delivery_mode === "stock")
      return json({
        status: "paid",
        quantity: paid.quantity,
        downloadUrl: await inventoryDownload(paid),
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      });
    const { data: file, error: fileError } = await db
      .from("product_files")
      .select("object_key, product:products!inner(file_name)")
      .eq("product_id", sale.product_id)
      .returns<{ object_key: string; product: { file_name: string } }[]>()
      .single();
    if (fileError) throw fileError;
    return json({
      status: "paid",
      downloadUrl: await downloadUrl(file.object_key, file.product.file_name),
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    });
  } catch (error) {
    return failure(error);
  }
}
