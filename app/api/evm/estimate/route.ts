import { z } from "zod";
import { requireUser, rateLimit } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/server";
import { sameOrigin, readJson, json, failure, HttpError } from "@/lib/http";
import { CHAIN_ENV } from "@/lib/network";
import { inspectEvmPayment } from "@/lib/evm-preflight";
import type { Sale } from "@/lib/catalog";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    await rateLimit(`evm-estimate:${user.id}`, 30);
    const { orderId } = z
      .object({ orderId: z.string().uuid() })
      .parse(await readJson(request));
    const result = await adminDb()
      .from("sales")
      .select("*")
      .eq("id", orderId)
      .eq("buyer_id", user.id)
      .eq("chain_environment", CHAIN_ENV)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new HttpError(404, "Заказ не найден");
    if (
      result.data.status !== "pending" ||
      result.data.reservation_released_at ||
      Date.parse(result.data.expires_at) <= Date.now()
    )
      throw new HttpError(409, "Заказ закрыт или истёк");
    return json(await inspectEvmPayment(result.data as Sale));
  } catch (error) {
    return failure(error);
  }
}
