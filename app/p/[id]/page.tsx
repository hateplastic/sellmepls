import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, File, ShieldCheck } from "lucide-react";
import { adminDb } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { appEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { Checkout } from "@/components/checkout";
import { AffiliateJoin } from "@/components/affiliate-tools";
import { Community, type CommunityEntry } from "@/components/community";
import { referralFor } from "@/lib/referrals";
import type { Product, Sale } from "@/lib/catalog";
import { CATEGORIES } from "@/lib/categories";
import { ContactSeller } from "@/components/contact-seller";
import { ProductGallery } from "@/components/product-gallery";
import { CHAIN_ENV } from "@/lib/network";
import { paymentAvailability } from "@/lib/payment-routers";
import { isAdmin } from "@/lib/admin";
import { ReportProduct } from "@/components/report-product";
import { inventoryCounts } from "@/lib/inventory";
export const dynamic = "force-dynamic";
export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ order?: string; feedback?: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const db = adminDb();
  const { data, error } = await db
    .from("products")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) notFound();
  const product = data as Product,
    query = await searchParams;
  let order: Sale | null = null;
  let viewer: Awaited<ReturnType<typeof requireUser>> | null = null;
  try {
    viewer = await requireUser();
  } catch (error) {
    if (!(error instanceof HttpError && error.status === 401)) throw error;
  }
  const visible = product.active && !product.is_hidden;
  if (query.order || !visible) {
    try {
      const user = await requireUser();
      let lookup = db
        .from("sales")
        .select("*")
        .eq("product_id", id)
        .eq("buyer_id", user.id);
      lookup = lookup.eq("chain_environment", CHAIN_ENV);
      if (query.order && z.string().uuid().safeParse(query.order).success)
        lookup = lookup.eq("id", query.order);
      const result = await lookup
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (result.error) throw result.error;
      order = result.data as Sale | null;
      if (!visible && !order && product.seller_id !== user.id && !isAdmin(user))
        notFound();
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) {
        if (!visible) notFound();
      } else throw error;
    }
  }
  const feedbackPage = Math.max(
    1,
    Math.min(100000, Number.parseInt(query.feedback || "1", 10) || 1),
  );
  const [seller, reputation, reviews, comments, purchase, ownReview, referral] =
    await Promise.all([
      db
        .from("users")
        .select("display_name,bio")
        .eq("id", product.seller_id)
        .single(),
      db.rpc("seller_reputation", { p_seller: product.seller_id }),
      db
        .from("reviews")
        .select(
          "id,author_id,rating,body,seller_reply,created_at,author:users!reviews_author_id_fkey(display_name)",
        )
        .eq("product_id", id)
        .order("created_at", { ascending: false })
        .range((feedbackPage - 1) * 20, feedbackPage * 20 - 1),
      db
        .from("comments")
        .select(
          "id,author_id,body,created_at,author:users!comments_author_id_fkey(display_name)",
        )
        .eq("product_id", id)
        .order("created_at", { ascending: false })
        .range((feedbackPage - 1) * 20, feedbackPage * 20 - 1),
      viewer
        ? db
            .from("sales")
            .select("*")
            .eq("product_id", id)
            .eq("buyer_id", viewer.id)
            .eq("status", "paid")
            .eq("chain_environment", CHAIN_ENV)
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      viewer
        ? db
            .from("reviews")
            .select("rating,body")
            .eq("product_id", id)
            .eq("author_id", viewer.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      product.affiliate_enabled
        ? referralFor(id, product.seller_id)
        : Promise.resolve(null),
    ]);
  for (const r of [seller, reputation, reviews, comments, purchase, ownReview])
    if (r.error) throw r.error;
  if (!order && purchase.data && product.delivery_mode !== "stock")
    order = purchase.data as Sale;
  const rating = reputation.data[0] as {
    rating: number | null;
    reviews: number;
    sales: number;
  };
  return (
    <section className="shell py-10">
      <Link
        href="/#market"
        className="inline-flex items-center gap-2 text-sm text-muted mb-8"
      >
        <ArrowLeft size={15} />
        Все товары
      </Link>
      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-8 lg:gap-14 items-start">
        <article>
          {visible || (viewer && isAdmin(viewer)) ? (
            <ProductGallery
              productId={id}
              revision={product.revision}
              title={product.title}
              images={product.gallery_keys?.length || 0}
              youtubeId={product.youtube_id}
            />
          ) : (
            <div className="panel p-12 text-muted">
              Товар снят с публикации. Ранее оплаченные файлы остаются доступны.
            </div>
          )}
          <p className="eyebrow mt-8 mb-4">{CATEGORIES[product.category]}</p>
          <Link
            href={`/s/${product.seller_id}`}
            className="panel p-4 mb-6 flex flex-wrap justify-between gap-3 items-center"
          >
            <span>
              {seller.data!.display_name}{" "}
              <span className="text-muted text-xs ml-2">Витрина ↗</span>
            </span>
            <span className="text-sm text-acid">
              {rating.rating ? `★ ${rating.rating} / 5` : "Пока без рейтинга"}
              <span className="text-muted ml-3">
                {rating.reviews} отзывов · {rating.sales} продаж
              </span>
            </span>
          </Link>
          {viewer?.id !== product.seller_id && (
            <div className="mb-6">
              <ContactSeller productId={id} />
            </div>
          )}
          <h1 className="text-4xl sm:text-5xl tracking-tight break-words">
            {product.title}
          </h1>
          <div className="flex flex-wrap gap-5 mt-6 text-sm text-muted">
            <span className="flex items-center gap-2">
              <File size={16} />
              {product.delivery_mode === "stock"
                ? "Поштучная выдача · TXT с купленными единицами"
                : product.file_name}
            </span>
            <span>
              {product.delivery_mode === "stock"
                ? "Уникальные единицы"
                : `${(product.file_size / 1048576).toFixed(1)} MB`}
            </span>
          </div>
          <p className="whitespace-pre-wrap break-words text-muted leading-8 mt-8">
            {product.description}
          </p>
          <div className="border-t border-white/10 pt-6 mt-8 flex items-start gap-3 text-sm text-muted">
            <ShieldCheck size={19} className="shrink-0 text-acid" />
            <p>
              {product.delivery_mode === "stock"
                ? "Вы получите TXT только с купленными единицами. Эти строки закрепляются за вашим заказом."
                : "Вы получите оригинальный файл продавца."}{" "}
              После оплаты загрузку можно повторно открыть в разделе «Мои
              покупки».
            </p>
          </div>
          <Community
            productId={id}
            reviews={reviews.data as unknown as CommunityEntry[]}
            comments={comments.data as unknown as CommunityEntry[]}
            userId={viewer?.id || null}
            isSeller={viewer?.id === product.seller_id}
            canReview={Boolean(purchase.data)}
            ownReview={ownReview.data}
          />
          {visible && <ReportProduct productId={id} />}
          <div className="flex gap-3 mt-6">
            {feedbackPage > 1 && (
              <Link
                className="button-secondary"
                href={`/p/${id}?feedback=${feedbackPage - 1}#community`}
              >
                Предыдущие отзывы
              </Link>
            )}
            {(reviews.data!.length === 20 || comments.data!.length === 20) && (
              <Link
                className="button-secondary"
                href={`/p/${id}?feedback=${feedbackPage + 1}#community`}
              >
                Ещё отзывы и комментарии
              </Link>
            )}
          </div>
        </article>
        <div>
          <Checkout
            stockAvailable={
              product.delivery_mode === "stock"
                ? (await inventoryCounts(id)).available
                : null
            }
            key={`${viewer?.id || "guest"}:${CHAIN_ENV}`}
            viewer={
              viewer
                ? {
                    id: viewer.id,
                    address: viewer.address,
                    chain: viewer.chain,
                  }
                : null
            }
            availability={await paymentAvailability()}
            product={product}
            initialOrder={order}
            appUrl={appEnv().NEXT_PUBLIC_APP_URL}
            referralCode={referral?.code}
            referralBps={referral ? product.affiliate_bps : 0}
          />
          {visible && product.affiliate_enabled && (
            <AffiliateJoin
              productId={id}
              sellerId={product.seller_id}
              bps={product.affiliate_bps}
            />
          )}
        </div>
      </div>
    </section>
  );
}
