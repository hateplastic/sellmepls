import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  Wallet,
  Download,
  Package,
  ShieldCheck,
  Plus,
  Star,
} from "lucide-react";
import { Reveal } from "@/components/reveal";
import { adminDb } from "@/lib/supabase/server";
import { ASSETS, isAssetOffered } from "@/lib/catalog";
import { CATEGORIES } from "@/lib/categories";
import { CatalogControls } from "@/components/catalog-controls";
import {
  catalogFilters,
  catalogHref,
  type CatalogItem,
  type CatalogParams,
} from "@/lib/catalog-search";
import { CHAIN_ENV } from "@/lib/network";
import { feeQuote, FEE_SUMMARY } from "@/lib/pricing";
import { affiliateReward } from "@/lib/affiliate-reward";
import { AffiliateQuickLink } from "@/components/affiliate-quick-link";
export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<CatalogParams>;
}) {
  const filters = catalogFilters(await searchParams),
    { category, q, page } = filters;
  const nativeRates: Partial<Record<string, string>> = {};
  let items: CatalogItem[] = [],
    more = false,
    total = 0,
    ratesUnavailable = false,
    unavailable = false;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const rates = await Promise.allSettled([
        feeQuote("base:ETH"),
        feeQuote("solana:SOL"),
      ]);
      ratesUnavailable = rates.some((r) => r.status === "rejected");
      if (rates[0].status === "fulfilled")
        nativeRates.ETH = rates[0].value.rate;
      if (rates[1].status === "fulfilled")
        nativeRates.SOL = rates[1].value.rate;
      const { data, error } = await adminDb().rpc("search_catalog", {
        p_query: q,
        p_category: category,
        p_sort: filters.sort,
        p_offset: (page - 1) * 12,
        p_environment: CHAIN_ENV,
        p_eth_usd: rates[0].status === "fulfilled" ? rates[0].value.rate : null,
        p_sol_usd: rates[1].status === "fulfilled" ? rates[1].value.rate : null,
      });
      if (error) throw error;
      items = data.slice(0, 12) as CatalogItem[];
      more = data.length > 12;
      total = data[0]?.total_count ?? 0;
    } catch {
      unavailable = true;
    }
  }
  return (
    <>
      <section className="shell grid lg:grid-cols-[1.1fr_1fr] gap-12 pt-16 pb-20 lg:pt-24 lg:pb-28 items-center">
        <Reveal>
          <div className="eyebrow flex items-center gap-2 mb-7">
            <span className="status-dot" />
            Для тех, кто создаёт
          </div>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-[-.06em] leading-[1.03]">
            Ваши идеи.
            <br />
            Ваши правила.
            <br />
            <span className="text-acid">Ваш кошелёк.</span>
          </h1>
          <p className="max-w-md mt-7 text-muted text-lg leading-relaxed">
            Продавайте цифровые товары за криптовалюту. От первого файла до
            прямой выплаты — без банковских реквизитов.
          </p>
          <div className="flex flex-wrap gap-3 mt-8">
            <Link href="/dashboard" className="button-primary">
              Начать продавать
              <ArrowUpRight size={18} />
            </Link>
            <Link href="#market" className="button-secondary">
              Найти что-то своё
              <ArrowRight size={17} />
            </Link>
          </div>
          <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
            <span>Без подписки</span>
            <span>{FEE_SUMMARY}</span>
            <span>Вход по подписи кошелька</span>
          </div>
        </Reveal>
        <Reveal className="relative">
          <div className="panel grid-art relative p-7 sm:p-10 overflow-hidden">
            <div className="flex justify-between items-center text-xs font-mono text-muted">
              <span>THE CREATOR ECONOMY</span>
              <span className="text-acid">ONCHAIN ↗</span>
            </div>
            <div className="flex justify-center py-10">
              <div className="hero-orb flex justify-center items-center">
                <Package size={65} className="text-acid" strokeWidth={1} />
              </div>
            </div>
            <div className="border-t border-white/10 pt-6">
              <div className="text-xs text-muted mb-4">
                КАЖДАЯ ПРОДАЖА → ПРЯМЫЕ ВЫПЛАТЫ
              </div>
              <div className="flex justify-between items-end">
                <div>
                  <span className="text-5xl tracking-tighter">
                    5<span className="text-acid">%</span>
                  </span>
                  <p className="mt-2 text-sm text-muted">Комиссия платформы</p>
                </div>
                <Plus className="mb-5 text-muted" size={20} />
                <div className="text-right">
                  <span className="text-3xl text-muted">$0.50</span>
                  <p className="mt-2 text-sm text-muted">Для цены от $2.50</p>
                </div>
              </div>
              <div className="mt-5 flex gap-1">
                <div className="h-1.5 bg-acid rounded flex-1" />
                <div className="h-1.5 bg-white/30 rounded w-3" />
              </div>
              <p className="text-[11px] text-muted mt-4">
                Для товаров дешевле $2.50 — только 10%, без фиксированной части.
                Продавец отдельно задаёт процент партнёру.
              </p>
            </div>
          </div>
        </Reveal>
      </section>
      <div className="border-y border-white/10">
        <div className="shell py-6 flex flex-wrap gap-7 justify-between text-muted text-sm">
          <span>ЧЕТЫРЕ СЕТИ. ОДНА ВИТРИНА.</span>
          <span className="font-semibold text-white">BNB Chain</span>
          <span className="font-semibold text-white">● Base</span>
          <span className="font-semibold text-white">◈ Arbitrum</span>
          <span className="font-semibold text-white">≋ Solana</span>
          <span className="font-mono text-xs self-center">
            USDC / USDT / ETH / SOL
          </span>
        </div>
      </div>
      <section id="market" className="shell pt-20">
        <div className="flex justify-between items-end gap-6 mb-8">
          <div>
            <p className="eyebrow mb-3">Цифровое. Независимое. Ваше.</p>
            <h2 className="text-3xl sm:text-4xl tracking-tight">
              Найдите следующую идею
            </h2>
          </div>
          <span className="hidden sm:block text-sm text-muted">
            Поиск по названию и описанию
          </span>
        </div>
        <CatalogControls
          key={`${q}:${category}:${filters.sort}`}
          filters={filters}
        />
        <div className="text-sm text-muted mb-6 space-y-2" aria-live="polite">
          {!unavailable && (
            <p>
              Найдено: {total}
              {q ? ` · «${q}»` : ""} · страница {page}
            </p>
          )}
          <p>
            Цена для сравнения — минимальная из доступных цен товара, примерно в
            USD. Оценки — от подтверждённых покупателей.
          </p>
          {ratesUnavailable && (
            <p>
              Часть курсов ETH/SOL недоступна. Товары без известной цены в USD
              идут в конце сортировки по цене.
            </p>
          )}
        </div>
        {items.length ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((item) => {
              const p = item.product,
                price =
                  item.display_price && isAssetOffered(item.display_price.asset)
                    ? item.display_price
                    : p.prices.find((p) => isAssetOffered(p.asset));
              return (
                <article
                  key={p.id}
                  className="group panel overflow-hidden flex flex-col"
                >
                  <Link href={`/p/${p.id}`} className="block flex-1">
                    <div className="aspect-[4/3] bg-white/5 overflow-hidden">
                      <img
                        src={`/api/preview/${p.id}?v=${p.revision}`}
                        alt={p.title}
                        className="w-full h-full object-cover transition duration-500 group-hover:scale-105"
                        loading="lazy"
                      />
                    </div>
                    <div className="p-5">
                      <p className="text-xs text-acid mb-2">
                        {CATEGORIES[p.category]}
                      </p>
                      <p className="text-xs font-mono text-muted mb-3">
                        {p.file_name.split(".").at(-1)?.toUpperCase()} ·{" "}
                        {(p.file_size / 1048576).toFixed(1)} MB
                      </p>
                      <h3 className="text-xl truncate">{p.title}</h3>
                      <p className="flex items-center gap-1.5 text-xs text-muted mt-3">
                        <Star
                          size={14}
                          className={item.review_count ? "text-acid" : ""}
                        />
                        {item.review_count
                          ? `${Number(item.rating).toFixed(1)} · отзывов: ${item.review_count}`
                          : "Пока нет отзывов"}
                      </p>
                      <div className="flex justify-between mt-5 text-sm">
                        <span className="text-acid">
                          {price
                            ? `${price.amount} ${ASSETS[price.asset].symbol}${p.delivery_mode === "stock" ? " / шт." : ""}`
                            : "Оплата пока недоступна"}
                          {price === item.display_price &&
                            item.price_usd !== null && (
                              <span className="block text-xs text-muted mt-1">
                                ≈ $
                                {Number(item.price_usd).toLocaleString(
                                  "en-US",
                                  {
                                    maximumFractionDigits: 4,
                                  },
                                )}
                              </span>
                            )}
                        </span>
                        <ArrowUpRight size={18} />
                      </div>
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
        ) : (
          <div className="panel p-10 sm:p-14 flex flex-col items-center text-center">
            <Package size={40} strokeWidth={1} className="text-acid mb-5" />
            <h3 className="text-xl">
              {unavailable
                ? "Витрина временно недоступна"
                : q || category
                  ? "По этим условиям товаров пока нет"
                  : "Первый товар может быть вашим"}
            </h3>
            <p className="text-muted mt-3 max-w-lg">
              {unavailable
                ? "Не удалось загрузить каталог. Попробуйте обновить страницу позже."
                : q || category
                  ? "Попробуйте другое название, меньше слов или выберите все категории."
                  : "Шаблоны, музыка, книги, код или дизайн. Загрузите свою работу и откройте продажи."}
            </p>
            <Link className="button-secondary mt-6" href="/dashboard">
              Создать товар
              <ArrowUpRight size={16} />
            </Link>
          </div>
        )}
        <div className="flex gap-3 mt-6">
          {page > 1 && (
            <Link
              className="button-secondary"
              href={catalogHref(filters, page - 1)}
            >
              Назад
            </Link>
          )}
          {more && (
            <Link
              className="button-secondary"
              href={catalogHref(filters, page + 1)}
            >
              Ещё товары
            </Link>
          )}
        </div>
      </section>
      <section id="how" className="shell pt-24">
        <p className="eyebrow mb-3">От идеи до оплаты</p>
        <h2 className="text-3xl sm:text-4xl tracking-tight mb-10">
          Меньше шагов. Больше творчества.
        </h2>
        <div className="grid md:grid-cols-3 border-y border-white/10">
          {[
            {
              icon: Wallet,
              title: "Подключите кошелёк",
              text: "Войдите через MetaMask или Phantom. Подтвердите вход подписью — без пароля и банковского счёта.",
            },
            {
              icon: Package,
              title: "Загрузите работу",
              text: "Добавьте файл, обложку и цены в нужных сетях. Поделитесь публичной ссылкой на товар.",
            },
            {
              icon: Download,
              title: "Получите оплату",
              text: "Покупатель подтверждает транзакцию. Деньги поступают в кошелёк, файл доступен после проверки сети.",
            },
          ].map((step, i) => (
            <div
              key={step.title}
              className="py-9 md:px-7 first:pl-0 border-b md:border-b-0 md:border-r last:border-0 border-white/10"
            >
              <div className="flex justify-between text-muted mb-8">
                <step.icon size={25} className="text-acid" strokeWidth={1.5} />
                <span className="font-mono text-xs">0{i + 1}</span>
              </div>
              <h3 className="text-xl mb-4">{step.title}</h3>
              <p className="text-sm text-muted leading-7">{step.text}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-3 mt-6 text-sm text-muted">
          <ShieldCheck size={18} className="shrink-0" />
          <p>
            Файл выдаётся по временной ссылке на 15 минут. Оплаченный заказ
            сохраняется в аккаунте покупателя.
          </p>
        </div>
      </section>
    </>
  );
}
