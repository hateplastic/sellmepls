import { z } from "zod";
import { randomBytes } from "node:crypto";
import { requireUser, rateLimit } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/server";
import { sameOrigin, readJson, json, failure, HttpError } from "@/lib/http";
import { ASSETS, isAssetOffered, type Price } from "@/lib/catalog";
import { appEnv } from "@/lib/env";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    await rateLimit(`affiliate-view:${user.id}`, 120);
    const input = z
      .object({
        productId: z.string().uuid().optional(),
        sellerId: z.string().uuid(),
        campaign: z.string().trim().min(1).max(40),
      })
      .parse(await readJson(request));
    if (user.id === input.sellerId)
      throw new HttpError(
        400,
        "Партнёрские ссылки предназначены для чужих товаров",
      );
    const db = adminDb();
    let query = db
      .from("products")
      .select("prices")
      .eq("seller_id", input.sellerId)
      .eq("active", true)
      .eq("is_hidden", false)
      .eq("affiliate_enabled", true);
    if (input.productId) query = query.eq("id", input.productId);
    const [{ data: products, error }, { data: profile, error: profileError }] =
      await Promise.all([
        query.limit(1000),
        db
          .from("users")
          .select("evm_wallet,solana_wallet")
          .eq("id", user.id)
          .single(),
      ]);
    if (error || profileError) throw error || profileError;
    if (!products?.length)
      throw new HttpError(400, "Продавец не включил партнёрскую программу");
    const prices = products
      .flatMap((p) => p.prices as Price[])
      .filter((p) => isAssetOffered(p.asset));
    if (!prices.length)
      throw new HttpError(
        400,
        "Для этого товара пока нет доступных сетей оплаты",
      );
    if (
      (prices.some((p) => ASSETS[p.asset].network !== "solana") &&
        !profile.evm_wallet) ||
      (prices.some((p) => ASSETS[p.asset].network === "solana") &&
        !profile.solana_wallet)
    )
      throw new HttpError(
        400,
        "Сначала сохраните кошельки для всех сетей товара в разделе «Профиль и выплаты»",
      );
    let existing = db
      .from("affiliate_links")
      .select("code")
      .eq("user_id", user.id)
      .eq("seller_id", input.sellerId)
      .eq("campaign", input.campaign);
    existing = input.productId
      ? existing.eq("product_id", input.productId)
      : existing.is("product_id", null);
    const found = await existing.maybeSingle();
    if (found.error) throw found.error;
    let code = found.data?.code;
    if (!code) {
      await rateLimit(`affiliate:${user.id}`, 20, 3600);
      const inserted = await db
        .from("affiliate_links")
        .insert({
          user_id: user.id,
          seller_id: input.sellerId,
          product_id: input.productId || null,
          campaign: input.campaign,
          code: randomBytes(12).toString("base64url"),
        })
        .select("code")
        .single();
      if (inserted.error) {
        if (inserted.error.code !== "23505") throw inserted.error;
        const retry = await existing.single();
        if (retry.error) throw retry.error;
        code = retry.data.code;
      } else code = inserted.data.code;
    }
    return json({ url: `${appEnv().NEXT_PUBLIC_APP_URL}/r/${code}`, code });
  } catch (error) {
    return failure(error);
  }
}
