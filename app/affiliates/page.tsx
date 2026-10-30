import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/server";
import { HttpError } from "@/lib/http";
import { appEnv } from "@/lib/env";
import { displayAmount, type AssetId } from "@/lib/catalog";
import { WalletAuth } from "@/components/wallet-auth";
import { ProfileForm } from "@/components/profile-form";
import { ShareLink } from "@/components/affiliate-tools";
import { CHAIN_ENV } from "@/lib/network";
export const dynamic = "force-dynamic";
export default async function Affiliates({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
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
          <p className="eyebrow mb-4">Affiliate studio</p>
          <h1 className="text-4xl mb-5">Рекомендуйте. Зарабатывайте.</h1>
          <p className="text-muted mb-6">
            Войдите кошельком, возьмите ссылку на товар с партнёрской программой
            и отслеживайте результат здесь.
          </p>
          <WalletAuth />
        </section>
      );
    throw error;
  }
  const page = Math.max(
      1,
      Math.min(
        100000,
        Number.parseInt((await searchParams).page || "1", 10) || 1,
      ),
    ),
    db = adminDb();
  const [profile, metrics, totals, payouts] = await Promise.all([
    db.from("users").select("*").eq("id", user.id).single(),
    db.rpc("affiliate_metrics_v2", {
      p_user: user.id,
      p_environment: CHAIN_ENV,
      p_offset: (page - 1) * 20,
    }),
    db.rpc("affiliate_totals_v2", {
      p_user: user.id,
      p_environment: CHAIN_ENV,
    }),
    db
      .from("sales")
      .select(
        "id,asset,network,affiliate_amount,affiliate_wallet,tx_hash,paid_at,products(title)",
      )
      .eq("affiliate_id", user.id)
      .eq("status", "paid")
      .eq("chain_environment", CHAIN_ENV)
      .order("paid_at", { ascending: false })
      .range((page - 1) * 20, page * 20 - 1),
  ]);
  for (const result of [profile, metrics, totals, payouts])
    if (result.error) throw result.error;
  const links = metrics.data as {
    id: string;
    code: string;
    product_id: string | null;
    seller_id: string;
    campaign: string;
    clicks: number;
    leads: number;
    conversions: number;
  }[];
  return (
    <section className="shell py-12">
      <div className="flex flex-wrap gap-5 justify-between items-center mb-8">
        <div>
          <p className="eyebrow mb-3">Affiliate studio</p>
          <h1 className="text-4xl">Ваши рекомендации работают.</h1>
        </div>
        <Link href="/#market" className="button-primary">
          Найти товар для продвижения ↗
        </Link>
      </div>
      <ProfileForm
        profile={{
          ...profile.data,
          evm_wallet:
            profile.data.evm_wallet ||
            (user.chain === "ethereum" ? user.address : null),
          solana_wallet:
            profile.data.solana_wallet ||
            (user.chain === "solana" ? user.address : null),
        }}
      />
      <div className="panel p-6 mb-8">
        <p className="text-muted mb-3">Выплачено на кошелёк за всё время</p>
        {totals.data.length ? (
          totals.data.map(
            (t: { asset: AssetId; earned: string; count: number }) => (
              <p className="text-2xl text-acid" key={t.asset}>
                {displayAmount(t.earned, t.asset)}{" "}
                <span className="text-xs text-muted">
                  {t.asset.split(":")[0]} · {t.count} продаж
                </span>
              </p>
            ),
          )
        ) : (
          <p className="text-2xl">Пока нет выплат</p>
        )}
        <p className="text-xs text-muted mt-4">
          Средства перечисляются в транзакции покупателя. Запрашивать вывод не
          нужно.
        </p>
      </div>
      <h2 className="text-2xl mb-5">Ссылки и кампании</h2>
      <div className="grid md:grid-cols-2 gap-5">
        {links.map((l) => (
          <article className="panel p-6" key={l.id}>
            <div className="flex justify-between gap-3 mb-5">
              <h3>{l.campaign}</h3>
              <Link
                className="text-xs text-muted underline"
                href={l.product_id ? `/p/${l.product_id}` : `/s/${l.seller_id}`}
              >
                {l.product_id ? "Товар" : "Витрина"} ↗
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                [l.clicks, "Переходы"],
                [l.leads, "Лиды"],
                [l.conversions, "Продажи"],
              ].map(([v, label]) => (
                <div key={label}>
                  <p className="text-2xl">{v}</p>
                  <p className="text-xs text-muted">{label}</p>
                </div>
              ))}
            </div>
            <ShareLink url={`${appEnv().NEXT_PUBLIC_APP_URL}/r/${l.code}`} />
          </article>
        ))}
      </div>
      {!links.length && (
        <p className="panel p-8 text-muted">
          Откройте товар с партнёрской программой и нажмите «Получить мою
          ссылку». Для Instagram, Telegram и других каналов можно создать
          отдельные кампании.
        </p>
      )}
      <p className="text-xs text-muted mt-5 leading-6">
        Переходы считаются по уникальному браузеру в сутки. Лид — посетитель,
        начавший заказ. Продажа — подтверждённая оплата. Действует последний
        партнёрский переход за 30 дней; созданный заказ сохраняет своего
        партнёра. Собственные покупки не приносят комиссию.
      </p>
      <h2 className="text-2xl mt-10 mb-5">Последние выплаты</h2>
      <div className="panel divide-y divide-white/10">
        {payouts.data!.map((p) => (
          <article key={p.id} className="p-5 text-sm">
            <div className="flex justify-between gap-5">
              <span>
                {(p.products as unknown as { title: string })?.title ||
                  "Продажа"}
              </span>
              <span className="text-acid">
                +{displayAmount(p.affiliate_amount, p.asset as AssetId)}
              </span>
            </div>
            <p className="text-xs text-muted mt-2">
              {new Date(p.paid_at).toLocaleString("ru-RU", { timeZone: "UTC" })}{" "}
              UTC · {p.network}
            </p>
            <p className="text-xs font-mono break-all mt-2">
              Получатель: {p.affiliate_wallet}
              <br />
              TX: {p.tx_hash}
            </p>
          </article>
        ))}
      </div>
      <div className="mt-8 flex gap-3">
        {page > 1 && (
          <Link
            href={`/affiliates?page=${page - 1}`}
            className="button-secondary"
          >
            Назад
          </Link>
        )}
        {(links.length === 20 || payouts.data!.length === 20) && (
          <Link
            href={`/affiliates?page=${page + 1}`}
            className="button-secondary"
          >
            Далее
          </Link>
        )}
      </div>
    </section>
  );
}
