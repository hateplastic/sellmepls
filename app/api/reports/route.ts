import { z } from "zod";
import { requireUser, rateLimit } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/server";
import { sameOrigin, readJson, json, failure, HttpError } from "@/lib/http";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    await rateLimit(`report:${user.id}`, 5, 3600);
    const input = z
      .object({
        productId: z.string().uuid(),
        reason: z.enum([
          "malware",
          "fraud",
          "copyright",
          "prohibited",
          "other",
        ]),
        details: z.string().trim().min(10).max(2000),
      })
      .parse(await readJson(request));
    const db = adminDb(),
      product = await db
        .from("products")
        .select("id")
        .eq("id", input.productId)
        .eq("active", true)
        .eq("is_hidden", false)
        .maybeSingle();
    if (product.error) throw product.error;
    if (!product.data) throw new HttpError(404, "Товар недоступен");
    const result = await db
      .from("product_reports")
      .upsert(
        {
          product_id: input.productId,
          reporter_id: user.id,
          reason: input.reason,
          details: input.details,
        },
        { onConflict: "product_id,reporter_id", ignoreDuplicates: true },
      );
    if (result.error) throw result.error;
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
