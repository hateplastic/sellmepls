import Link from "next/link";
import { MessageCircle, ArrowUpRight } from "lucide-react";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/server";
import { HttpError } from "@/lib/http";
import { WalletAuth } from "@/components/wallet-auth";
import { ContactSeller } from "@/components/contact-seller";
export const dynamic = "force-dynamic";
export default async function Messages({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; page?: string }>;
}) {
  const params = await searchParams;
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (!(error instanceof HttpError && error.status === 401)) throw error;
    return (
      <section className="shell py-20">
        <h1 className="text-4xl mb-5">Личные сообщения</h1>
        <p className="text-muted mb-8">
          Войдите кошельком, чтобы написать продавцу. Покупать товар для этого
          не нужно.
        </p>
        <WalletAuth />
      </section>
    );
  }
  const db = adminDb(),
    page = Math.max(
      1,
      Math.min(100000, Number.parseInt(params.page || "1", 10) || 1),
    );
  const result = await db
    .from("conversations")
    .select(
      "id,buyer_id,seller_id,updated_at,product:products(title),buyer:users!conversations_buyer_id_fkey(display_name),seller:users!conversations_seller_id_fkey(display_name)",
    )
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
    .order("updated_at", { ascending: false })
    .order("id")
    .range((page - 1) * 20, page * 20);
  if (result.error) throw result.error;
  const conversations = result.data as unknown as {
    id: string;
    buyer_id: string;
    seller_id: string;
    updated_at: string;
    product: { title: string };
    buyer: { display_name: string };
    seller: { display_name: string };
  }[];
  const requestedProduct = z.string().uuid().safeParse(params.product);
  let product: { id: string; title: string; seller_id: string } | null = null;
  if (requestedProduct.success) {
    const lookup = await db
      .from("products")
      .select("id,title,seller_id")
      .eq("id", requestedProduct.data)
      .eq("active", true)
      .maybeSingle();
    if (lookup.error) throw lookup.error;
    product = lookup.data;
  }
  return (
    <section className="shell py-14 max-w-4xl">
      <p className="eyebrow mb-3">Связь с автором</p>
      <h1 className="text-4xl mb-4">Сообщения</h1>
      <p className="text-muted mb-8">
        Вопросы до покупки и поддержка после — в одной переписке по товару.
      </p>
      {product && product.seller_id !== user.id && (
        <div className="panel p-5 mb-6 space-y-4">
          <p>{product.title}</p>
          <ContactSeller productId={product.id} />
        </div>
      )}
      <div className="space-y-3">
        {conversations.slice(0, 20).map((c) => (
          <Link
            href={`/messages/${c.id}`}
            key={c.id}
            className="panel p-5 flex items-center gap-4 hover:border-acid/40"
          >
            <MessageCircle className="text-acid shrink-0" size={23} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold truncate">
                {c.buyer_id === user.id
                  ? c.seller.display_name
                  : c.buyer.display_name}
                <span className="text-xs font-normal text-muted ml-3">
                  {c.buyer_id === user.id ? "Продавец" : "Покупатель"}
                </span>
              </p>
              <p className="text-sm text-muted truncate mt-1">
                {c.product.title}
              </p>
              <time className="text-xs text-muted" dateTime={c.updated_at}>
                {new Date(c.updated_at).toLocaleString("ru-RU", {
                  timeZone: "Europe/Chisinau",
                })}
              </time>
            </div>
            <ArrowUpRight size={18} />
          </Link>
        ))}
      </div>
      {!conversations.length && (
        <div className="panel p-10 text-center text-muted">
          Пока нет диалогов. На странице товара нажмите «Написать продавцу».
        </div>
      )}
      <div className="flex gap-3 mt-6">
        {page > 1 && (
          <Link
            className="button-secondary"
            href={`/messages?page=${page - 1}`}
          >
            Назад
          </Link>
        )}
        {conversations.length > 20 && (
          <Link
            className="button-secondary"
            href={`/messages?page=${page + 1}`}
          >
            Следующие
          </Link>
        )}
      </div>
    </section>
  );
}
