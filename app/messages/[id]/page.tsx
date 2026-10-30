import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/server";
import { HttpError } from "@/lib/http";
import { MESSAGE_COLUMNS, type ChatMessage } from "@/lib/messages";
import { WalletAuth } from "@/components/wallet-auth";
import { Chat } from "@/components/chat";
export const dynamic = "force-dynamic";
export default async function Conversation({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (!(error instanceof HttpError && error.status === 401)) throw error;
    return (
      <section className="shell py-20">
        <h1 className="text-3xl mb-6">Войдите, чтобы открыть переписку</h1>
        <WalletAuth />
      </section>
    );
  }
  const db = adminDb(),
    result = await db
      .from("conversations")
      .select(
        "id,product_id,buyer_id,seller_id,product:products(title),buyer:users!conversations_buyer_id_fkey(display_name),seller:users!conversations_seller_id_fkey(display_name)",
      )
      .eq("id", id)
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) notFound();
  const thread = result.data as unknown as {
    id: string;
    product_id: string;
    buyer_id: string;
    seller_id: string;
    product: { title: string };
    buyer: { display_name: string };
    seller: { display_name: string };
  };
  const messages = await db
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", id)
    .order("id", { ascending: false })
    .limit(51);
  if (messages.error) throw messages.error;
  return (
    <section className="shell py-10 max-w-4xl">
      <Link href="/messages" className="text-sm text-muted">
        ← Все сообщения
      </Link>
      <div className="my-6">
        <h1 className="text-3xl">
          {thread.buyer_id === user.id
            ? thread.seller.display_name
            : thread.buyer.display_name}
        </h1>
        <Link
          className="text-sm text-acid mt-2 inline-block"
          href={`/p/${thread.product_id}`}
        >
          {thread.product.title} ↗
        </Link>
        <p className="text-xs text-muted mt-2">
          Личная переписка · время Europe/Chisinau · обновление каждые 5 секунд
        </p>
      </div>
      <Chat
        key={id}
        conversationId={id}
        userId={user.id}
        initial={(messages.data.slice(0, 50) as ChatMessage[]).reverse()}
        hasOlder={messages.data.length > 50}
      />
    </section>
  );
}
