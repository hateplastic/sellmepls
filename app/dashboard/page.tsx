import Link from "next/link";
import { ArrowUpRight, Package, Wallet, ShoppingBag } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/server";
import { HttpError } from "@/lib/http";
import { ProductForm } from "@/components/product-form";
import { ProductControls } from "@/components/product-controls";
import { ProfileForm } from "@/components/profile-form";
import { WalletAuth } from "@/components/wallet-auth";
import {
  displayAmount,
  saleParts,
  shortAddress,
  type Product,
  type AssetId,
  type Sale,
} from "@/lib/catalog";
import { storageEnv } from "@/lib/env";
import { isAdmin } from "@/lib/admin";
import { CHAIN_ENV } from "@/lib/network";
import { inventoryCounts } from "@/lib/inventory";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; saved?: string }>;
}) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (
      (error instanceof HttpError && error.status === 401) ||
      !process.env.NEXT_PUBLIC_SUPABASE_URL
    )
      return (
        <section className="shell py-24 max-w-xl">
          <p className="eyebrow mb-4">Кабинет создателя</p>
          <h1 className="text-4xl tracking-tight mb-5">
            Ваша работа заслуживает своей витрины.
          </h1>
          <p className="text-muted mb-8">
            Подключите кошелёк и подпишите вход, чтобы добавить товар или
            открыть покупки.
          </p>
          <WalletAuth />
        </section>
      );
    throw error;
  }
  const params = await searchParams,
    page = Math.max(
      1,
      Math.min(100000, Number.parseInt(params.page || "1", 10) || 1),
    ),
    db = adminDb();
  const [
    profileResult,
    productResult,
    totalResult,
    salesResult,
    purchasesResult,
  ] = await Promise.all([
    db.from("users").select("*").eq("id", user.id).single(),
    db
      .from("products")
      .select("*", { count: "exact" })
      .eq("seller_id", user.id)
      .order("created_at", { ascending: false })
      .range((page - 1) * 20, page * 20 - 1),
    db.rpc("seller_totals_v2", { p_seller: user.id, p_environment: CHAIN_ENV }),
    db
      .from("sales")
      .select("*")
      .eq("seller_id", user.id)
      .eq("status", "paid")
      .eq("chain_environment", CHAIN_ENV)
      .order("paid_at", { ascending: false })
      .limit(20),
    db
      .from("sales")
      .select("*, products(title)")
      .eq("buyer_id", user.id)
      .eq("chain_environment", CHAIN_ENV)
      .order("created_at", { ascending: false })
      .range((page - 1) * 20, page * 20 - 1),
  ]);
  for (const r of [
    profileResult,
    productResult,
    totalResult,
    salesResult,
    purchasesResult,
  ])
    if (r.error) throw r.error;
  const totals = totalResult.data as {
      asset: AssetId;
      net: string;
      count: number;
    }[],
    products = productResult.data as Product[],
    sales = salesResult.data as Sale[];
  const stockCounts = new Map(
    await Promise.all(
      products
        .filter((p) => p.delivery_mode === "stock")
        .map(async (p) => [p.id, await inventoryCounts(p.id)] as const),
    ),
  );
  return (
    <section className="shell py-12">
      <div className="flex justify-between items-end flex-wrap gap-5 mb-10">
        <div>
          <p className="eyebrow mb-3">Creator dashboard</p>
          <h1 className="text-4xl tracking-tight">Ваш кабинет</h1>
          <p className="text-muted mt-3 font-mono text-sm">
            {shortAddress(user.address)}
          </p>
        </div>
        <Link href="/" className="button-secondary">
          Открыть маркетплейс
          <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="flex flex-wrap gap-3 mb-6">
        <Link href="/messages" className="button-secondary">
          Сообщения ↗
        </Link>
        {isAdmin(user) && (
          <Link href="/admin" className="button-secondary">
            Админка ↗
          </Link>
        )}
        <Link href={`/s/${user.id}`} className="button-secondary">
          Моя витрина ↗
        </Link>
        <Link href="/affiliates" className="button-secondary">
          Партнёрский кабинет ↗
        </Link>
      </div>
      {params.saved && (
        <p role="status" className="panel p-4 mb-6 text-acid">
          Изменения товара сохранены. Ссылка на товар осталась прежней.
        </p>
      )}
      {(profileResult.data.evm_wallet?.toLowerCase() ===
        process.env.PLATFORM_EVM_WALLET?.toLowerCase() ||
        profileResult.data.solana_wallet ===
          process.env.PLATFORM_SOLANA_WALLET) && (
        <div
          role="alert"
          className="panel p-5 mb-6 border-amber-300/40 text-amber-200"
        >
          <p className="font-medium mb-2">
            Адрес выплат совпадает с кошельком платформы
          </p>
          <p className="text-sm">
            Покупки в этой сети заблокированы. В профиле ниже укажите отдельный
            принадлежащий вам адрес продавца и сохраните. Для покупки
            используйте ещё один аккаунт покупателя. Переключение адреса только
            в расширении не меняет вход на сайт — нажмите «Сменить аккаунт».
          </p>
        </div>
      )}
      <ProfileForm profile={profileResult.data} />
      <div className="grid sm:grid-cols-3 gap-4 mb-10">
        <div className="panel p-6">
          <Package size={19} className="text-muted mb-4" />
          <p className="text-3xl">{productResult.count || 0}</p>
          <p className="text-sm text-muted mt-2">Товаров</p>
        </div>
        <div className="panel p-6">
          <ShoppingBag size={19} className="text-muted mb-4" />
          <p className="text-3xl">
            {totals.reduce((n, t) => n + Number(t.count), 0)}
          </p>
          <p className="text-sm text-muted mt-2">Подтверждённых продаж</p>
        </div>
        <div className="panel p-6">
          <Wallet size={19} className="text-acid mb-4" />
          {totals.length ? (
            totals.map((t) => (
              <p key={t.asset} className="text-acid text-lg">
                {displayAmount(t.net, t.asset)}
                <span className="text-xs text-muted ml-2">
                  {t.asset.split(":")[0]}
                </span>
              </p>
            ))
          ) : (
            <p className="text-3xl">—</p>
          )}
          <p className="text-sm text-muted mt-2">
            Доход после комиссии, по активам
          </p>
        </div>
      </div>
      <div className="grid lg:grid-cols-[1.1fr_1fr] gap-8 items-start">
        <ProductForm
          evmWallet={
            profileResult.data.evm_wallet ||
            (user.chain === "ethereum" ? user.address : "")
          }
          tronWallet={profileResult.data.tron_wallet || (user.chain === "tron" ? user.address : "")}
          solanaWallet={
            profileResult.data.solana_wallet ||
            (user.chain === "solana" ? user.address : "")
          }
          maxBytes={storageEnv().MAX_FILE_BYTES}
        />
        <div className="space-y-8">
          <div>
            <h2 className="text-2xl mb-5">Мои товары</h2>
            {products.length ? (
              <div className="space-y-3">
                {products.map((p) => (
                  <div
                    key={p.id}
                    className="panel p-5 flex flex-wrap justify-between gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/p/${p.id}`}
                        className="font-medium hover:text-acid break-words"
                      >
                        {p.title} ↗
                      </Link>
                      <p className="text-xs text-muted mt-2">
                        {p.is_hidden
                          ? "Скрыт модератором"
                          : p.active
                            ? "Опубликован"
                            : "Скрыт"}{" "}
                        ·{" "}
                        {p.delivery_mode === "stock"
                          ? `${stockCounts.get(p.id)?.available || 0} шт. доступно · ${stockCounts.get(p.id)?.reserved || 0} в резерве · ${stockCounts.get(p.id)?.sold || 0} продано`
                          : `${(p.file_size / 1048576).toFixed(1)} MB`}
                      </p>
                      {p.delivery_mode === "stock" && (
                        <Link
                          href={`/dashboard/products/${p.id}/edit#stock`}
                          className="text-acid text-xs block mt-2"
                        >
                          Пополнить склад ↗
                        </Link>
                      )}
                    </div>
                    <ProductControls
                      id={p.id}
                      active={p.active}
                      affiliateEnabled={p.affiliate_enabled}
                      affiliateBps={p.affiliate_bps}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="panel p-8 text-muted">
                Товаров пока нет. Создайте первый в форме рядом.
              </p>
            )}
          </div>
          <div>
            <h2 className="text-2xl mb-5">Последние продажи</h2>
            {sales.length ? (
              <div className="panel divide-y divide-white/10">
                {sales.map((s) => (
                  <div
                    key={s.id}
                    className="p-4 flex justify-between gap-4 text-sm"
                  >
                    <div>
                      <p>{shortAddress(s.buyer_wallet)}</p>
                      <p className="text-xs text-muted mt-1">
                        {new Date(s.paid_at!).toLocaleString("ru-RU", {
                          timeZone: "UTC",
                        })}{" "}
                        UTC · {s.network}{" "}
                        {s.delivery_mode === "stock"
                          ? `· ${s.quantity} шт.`
                          : ""}
                      </p>
                    </div>
                    <p className="text-acid">
                      +{displayAmount(saleParts(s).seller, s.asset)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted text-sm">
                Здесь появятся подтверждённые покупки ваших товаров.
              </p>
            )}
          </div>
          <div id="purchases">
            <h2 className="text-2xl mb-5">Мои покупки</h2>
            {purchasesResult.data!.length ? (
              <div className="panel divide-y divide-white/10">
                {purchasesResult.data!.map((p) => (
                  <div key={p.id} className="p-4 flex justify-between gap-4">
                    <div>
                      <p className="text-sm">
                        {p.products?.title || "Цифровой товар"}
                      </p>
                      <p className="text-xs text-muted mt-1">
                        {p.status === "paid"
                          ? "Оплачен"
                          : p.reservation_released_at
                            ? "Резерв закрыт"
                            : "Ожидает оплаты"}{" "}
                        {p.delivery_mode === "stock"
                          ? `· ${p.quantity} шт.`
                          : ""}
                      </p>
                    </div>
                    <Link
                      href={`/p/${p.product_id}?order=${p.id}`}
                      className="text-acid text-sm"
                    >
                      {p.status === "paid" ? "Скачать" : "Открыть"} ↗
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted text-sm">
                Ваши покупки сохраняются в аккаунте этого кошелька.
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="mt-8 flex justify-end gap-3">
        {page > 1 && (
          <Link
            className="button-secondary"
            href={`/dashboard?page=${page - 1}`}
          >
            Назад
          </Link>
        )}
        {((productResult.count || 0) > page * 20 ||
          purchasesResult.data!.length === 20) && (
          <Link
            className="button-secondary"
            href={`/dashboard?page=${page + 1}`}
          >
            Далее
          </Link>
        )}
      </div>
    </section>
  );
}
