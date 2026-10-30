import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { rateLimit } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/server";
import { sameOrigin, readJson, json, failure } from "@/lib/http";
import { revalidatePath } from "next/cache";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireAdmin();
    await rateLimit(`moderation:${user.id}`, 30);
    const input = z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("visibility"),
          productId: z.string().uuid(),
          hidden: z.boolean(),
          reason: z.string().trim().min(5).max(1000),
        }),
        z.object({ action: z.literal("dismiss"), reportId: z.string().uuid() }),
      ])
      .parse(await readJson(request));
    const db = adminDb();
    if (input.action === "visibility") {
      const result = await db.rpc("moderate_product", {
        p_admin: user.id,
        p_product: input.productId,
        p_hidden: input.hidden,
        p_reason: input.reason,
      });
      if (result.error) throw result.error;
      revalidatePath(`/p/${input.productId}`);
    } else {
      const result = await db
        .from("product_reports")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", input.reportId)
        .eq("status", "open");
      if (result.error) throw result.error;
    }
    revalidatePath("/");
    revalidatePath("/admin");
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
