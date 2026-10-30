import { z } from "zod";
import { requireUser, rateLimit } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/server";
import { HttpError, failure, json, readJson, sameOrigin } from "@/lib/http";
import { MESSAGE_COLUMNS } from "@/lib/messages";

export const runtime = "nodejs";
const postInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), productId: z.string().uuid() }),
  z.object({
    action: z.literal("send"),
    conversationId: z.string().uuid(),
    clientId: z.string().uuid(),
    body: z.string().trim().min(1).max(4000),
  }),
]);
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser(),
      input = postInput.parse(await readJson(request)),
      db = adminDb();
    await rateLimit(
      `chat:${input.action}:${user.id}`,
      input.action === "start" ? 30 : 60,
      input.action === "start" ? 3600 : 60,
    );
    if (input.action === "start") {
      const result = await db.rpc("start_conversation", {
        p_user: user.id,
        p_product: input.productId,
      });
      if (result.error) {
        if (
          /product_unavailable|cannot_message_yourself/.test(
            result.error.message,
          )
        )
          throw new HttpError(
            400,
            "Товар недоступен для нового диалога или принадлежит вам",
          );
        throw result.error;
      }
      return json({ id: result.data });
    }
    const result = await db.rpc("send_message", {
      p_user: user.id,
      p_conversation: input.conversationId,
      p_client: input.clientId,
      p_body: input.body,
    });
    if (result.error) {
      if (result.error.message.includes("conversation_not_found"))
        throw new HttpError(404, "Диалог не найден");
      if (result.error.message.includes("message_conflict"))
        throw new HttpError(409, "Обновите страницу перед повторной отправкой");
      throw result.error;
    }
    const { id, conversation_id, sender_id, body, created_at } = result.data;
    return json({
      message: { id, conversation_id, sender_id, body, created_at },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function GET(request: Request) {
  try {
    const user = await requireUser(),
      params = new URL(request.url).searchParams;
    const id = z.string().uuid().parse(params.get("conversation"));
    const cursor = z.coerce
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER);
    const before = params.has("before")
      ? cursor.parse(params.get("before"))
      : undefined;
    const after = params.has("after")
      ? cursor.parse(params.get("after"))
      : undefined;
    if (before !== undefined && after !== undefined)
      throw new HttpError(400, "Укажите одно направление истории");
    await rateLimit(`chat:read:${user.id}`, 90);
    const db = adminDb(),
      thread = await db
        .from("conversations")
        .select("id")
        .eq("id", id)
        .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
        .maybeSingle();
    if (thread.error) throw thread.error;
    if (!thread.data) throw new HttpError(404, "Диалог не найден");
    let query = db
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("conversation_id", id);
    if (before !== undefined) query = query.lt("id", before);
    if (after !== undefined) query = query.gt("id", after);
    const result = await query
      .order("id", { ascending: after !== undefined })
      .limit(51);
    if (result.error) throw result.error;
    const messages = result.data.slice(0, 50);
    return json({
      messages: after !== undefined ? messages : messages.reverse(),
      more: result.data.length > 50,
    });
  } catch (error) {
    return failure(error);
  }
}
