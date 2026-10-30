import { z } from "zod";
import { requireUser, rateLimit } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/server";
import { sameOrigin, readJson, json, failure, HttpError } from "@/lib/http";
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("review"),
    productId: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
    body: z.string().trim().min(10).max(2000),
  }),
  z.object({
    action: z.literal("comment"),
    productId: z.string().uuid(),
    body: z.string().trim().min(2).max(1000),
  }),
  z.object({ action: z.literal("delete-comment"), id: z.string().uuid() }),
  z.object({
    action: z.literal("reply"),
    id: z.string().uuid(),
    body: z.string().trim().max(1000),
  }),
]);
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    await rateLimit(`community:${user.id}`, 10, 600);
    const input = schema.parse(await readJson(request)),
      db = adminDb();
    if (input.action === "review") {
      const sale = await db
        .from("sales")
        .select("id")
        .eq("product_id", input.productId)
        .eq("buyer_id", user.id)
        .eq("status", "paid")
        .limit(1);
      if (sale.error) throw sale.error;
      if (!sale.data.length)
        throw new HttpError(
          403,
          "Оставить отзыв можно только после подтверждённой покупки",
        );
      const { error } = await db.rpc("save_review", {
        p_user: user.id,
        p_product: input.productId,
        p_rating: input.rating,
        p_body: input.body,
      });
      if (error) throw error;
    } else if (input.action === "comment") {
      const p = await db
        .from("products")
        .select("id")
        .eq("id", input.productId)
        .eq("active", true).eq("is_hidden", false)
        .maybeSingle();
      if (p.error) throw p.error;
      if (!p.data) throw new HttpError(404, "Товар не найден");
      const { error } = await db.from("comments").insert({
        product_id: input.productId,
        author_id: user.id,
        body: input.body,
      });
      if (error) throw error;
    } else if (input.action === "delete-comment") {
      const { error } = await db
        .from("comments")
        .delete()
        .eq("id", input.id)
        .eq("author_id", user.id);
      if (error) throw error;
    } else {
      const r = await db
        .from("reviews")
        .select("product_id")
        .eq("id", input.id)
        .single();
      if (r.error) throw new HttpError(404, "Отзыв не найден");
      const p = await db
        .from("products")
        .select("id")
        .eq("id", r.data.product_id)
        .eq("seller_id", user.id)
        .maybeSingle();
      if (p.error) throw p.error;
      if (!p.data) throw new HttpError(403, "Ответ доступен только продавцу");
      const { error } = await db
        .from("reviews")
        .update({ seller_reply: input.body })
        .eq("id", input.id);
      if (error) throw error;
    }
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
