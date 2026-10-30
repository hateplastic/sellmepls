import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { adminDb } from "@/lib/supabase/server";
import { ASSETS, isAssetOffered, type Product } from "@/lib/catalog";
import { AffiliateJoin } from "@/components/affiliate-tools";
import { AffiliateQuickLink } from "@/components/affiliate-quick-link";
import { affiliateReward } from "@/lib/affiliate-reward";
import { feeQuote } from "@/lib/pricing";
export const dynamic = "force-dynamic";
export default async function Storefront({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const page = Math.max(
      1,
      Math.min(
        100000,
        Number.parseInt((await searchParams).page || "1", 10) || 1,
      ),
    ),
    db = adminDb();
  const [profile, products, reputation, program] = await Promise.all([
    db
      .from("users")
      .select("display_name,bio,created_at")
      .eq("id", id)
      .maybeSingle(),
    db
      .from("products")
      .select("*", { count: "exact" })
      .eq("seller_id", id)
      .eq("active", true)
      .eq("is_hidden", false)
      .order("created_at", { ascending: false })
      .range((page - 1) * 20, page * 20 - 1),
    db.rpc("seller_reputation", { p_seller: id }),
    db
      .from("products")
      .select("id")
      .eq("seller_id", id)
      .eq("active", true)
      .eq("is_hidden", false)
      .eq("affiliate_enabled", true)
      .limit(1),
  ]);
  for (const r of [profile, products, reputation, program])
    if (r.error) throw r.error;
  if (!profile.data) notFound();
  const nativeRates: Partial<Record<string, string>> = {};
  const nativePrices = new Map(
    (products.data as Product[]).flatMap((p) => {
      const price = p.prices.find((price) => isAssetOffered(price.asset));
      if (!p.affiliate_enabled || !price) return [];
      const symbol = ASSETS[price.asset].symbol;
      return symbol === "ETH" || symbol === "SOL"
        ? [[symbol, price.asset] as const]
        : [];
    }),
  );
  await Promise.allSettled(
    [...nativePrices].map(async ([symbol, asset]) => {
      nativeRates[symbol] = (await feeQuote(asset)).rate;
    }),
  );
  const rating = reputation.data[0] as {
    rating: number | null;
    reviews: number;
    sales: number;
  };
  return (
    <section className="shell py-12">
      <Link href="/#market" className="text-sm text-muted">
        ← Все авторы и товары
      </Link>
      <div className="grid lg:grid-cols-[1fr_360px] gap-8 mt-8">
        <div>
          <div className="panel p-8 mb-8">
            <p className="eyebrow mb-4">Витрина автора</p>
            <h1 className="text-4xl sm:text-5xl break-words">
              {profile.data.display_name}
            </h1>
            <p className="whitespace-pre-wrap text-muted mt-5 leading-7 break-words">
              {profile.data.bio || "Цифровые работы от независимого автора."}
            </p>
            <div className="flex flex-wrap gap-6 mt-6 text-sm">
              <span className="text-acid">
                {rating.rating ? `★ ${rating.rating} / 5` : "Пока без рейтинга"}
              </span>
              <span>{rating.reviews} отзывов</span>
              <span>{rating.sales} продаж</span>
              <span>{products.count || 0} товаров</span>
            </div>
            <p className="text-xs text-muted mt-4">
              Рейтинг основан на отзывах подтверждённых покупателей.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-5">
            {(products.data as Product[]).map((p) => {
              const price = p.prices.find((price) =>
                isAssetOffered(price.asset),
              );
              return (
                <article
                  key={p.id}
                  className="panel overflow-hidden group flex flex-col"
                >
                  <Link href={`/p/${p.id}`} className="block flex-1">
                    <div className="aspect-[4/3]">
                      <img
                        src={`/api/preview/${p.id}?v=${p.revision}`}
                        alt={p.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="p-5">
                      <h2 className="text-xl group-hover:text-acid break-words">
                        {p.title}
                      </h2>
                      <p className="text-muted text-sm mt-3">
                        {price
                          ? `${price.amount} ${ASSETS[price.asset].symbol}${p.delivery_mode === "stock" ? " / шт." : ""}`
                          : "Оплата пока недоступна"}
                      </p>
                    </div>
                  </Link>
                  {p.affiliate_enabled && price && (
                    <AffiliateQuickLink
                      productId={p.id}
                      sellerId={p.seller_id}
                      title={p.title}
                      bps={p.affiliate_bps}
                      reward={affiliateReward(
                        price,
                        p.affiliate_bps,
                        nativeRates[ASSETS[price.asset].symbol],
                      )}
                      priceLabel={`${price.amount} ${ASSETS[price.asset].label}`}
                      stock={p.delivery_mode === "stock"}
                    />
                  )}
                </article>
              );
            })}
          </div>
          {!products.data!.length && (
            <p className="text-muted">Автор пока не опубликовал товары.</p>
          )}
          <div className="flex gap-3 mt-8">
            {page > 1 && (
              <Link
                className="button-secondary"
                href={`/s/${id}?page=${page - 1}`}
              >
                Назад
              </Link>
            )}
            {(products.count || 0) > page * 20 && (
              <Link
                className="button-secondary"
                href={`/s/${id}?page=${page + 1}`}
              >
                Далее
              </Link>
            )}
          </div>
        </div>
        <aside>
          {Boolean(program.data!.length) && <AffiliateJoin sellerId={id} />}
          <div className="panel p-6 mt-6">
            <h2>Прямая поддержка автора</h2>
            <p className="text-muted text-sm mt-3 leading-6">
              Платёж поступает продавцу и участникам продажи одной транзакцией.
              Оплаченные файлы доступны в вашем кабинете.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
