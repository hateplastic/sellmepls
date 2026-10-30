import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { adminDb } from "@/lib/supabase/server";
import { HttpError } from "@/lib/http";
import { TESTNET } from "@/lib/network";
import { WalletAuth } from "@/components/wallet-auth";
import { RouterSetup } from "@/components/router-setup";
import { paymentAvailability } from "@/lib/payment-routers";
import { ModerationPanel } from "@/components/moderation-panel";
export const dynamic = "force-dynamic";
type Metrics = {
  registered_users: number;
  sellers_total: number;
  active_sellers_30d: number;
  products_today: number;
  products_total: number;
  products_active: number;
  paid_sales: number;
  turnover_usd: string;
  revenue_usd: string;
  average_usd: string;
  affiliate_usd: string;
  daily: { day: string; sales: number; turnover: string; revenue: string }[];
  assets: { asset: string; sales: number; turnover: string; revenue: string }[];
};
const usd = (value: string) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value));
export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  try {
    await requireAdmin();
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    if (error.status !== 401 && error.status !== 403) throw error;
    return (
      <section className="shell py-20">
        <p className="eyebrow mb-4">Управление платформой</p>
        <h1 className="text-4xl mb-5">Администратор</h1>
        <p className="text-muted mb-8">
          {error.status === 401
            ? "Войдите одним из кошельков владельца платформы."
            : "Для этого аккаунта доступ закрыт. Выйдите и подключите кошелёк администратора."}
        </p>
        <WalletAuth />
      </section>
    );
  }
  const requested = Number((await searchParams).days),
    days = [7, 30, 90].includes(requested) ? requested : 30;
  const result = await adminDb().rpc("admin_metrics", {
    p_days: days,
    p_environment: TESTNET ? "testnet" : "mainnet",
  });
  if (result.error) throw result.error;
  const m = result.data as Metrics;
  const [reports, hidden, visible] = await Promise.all([
    adminDb()
      .from("product_reports")
      .select(
        "id,product_id,reason,details,created_at,product:products!inner(title)",
      )
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(100),
    adminDb()
      .from("products")
      .select("id,title")
      .eq("is_hidden", true)
      .order("created_at", { ascending: false })
      .limit(100),
    adminDb()
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .eq("is_hidden", false),
  ]);
  if (reports.error || hidden.error || visible.error)
    throw reports.error || hidden.error || visible.error;
  const peak = Math.max(1, ...m.daily.map((d) => Number(d.turnover)));
  const cards = [
    ["Оборот за период", usd(m.turnover_usd)],
    ["Доход платформы", usd(m.revenue_usd)],
    ["Средний чек", usd(m.average_usd)],
    ["Оплаченные заказы", m.paid_sales],
    ["Активные продавцы · 30 дней", m.active_sellers_30d],
    ["Продавцы за всё время", m.sellers_total],
    ["Опубликовано сегодня", m.products_today],
    ["Зарегистрированные пользователи", m.registered_users],
  ];
  return (
    <section className="shell py-14">
      <div className="flex justify-between items-end flex-wrap gap-5 mb-8">
        <div>
          <p className="eyebrow mb-3">
            Обзор платформы · {TESTNET ? "тестовые сети" : "основные сети"}
          </p>
          <h1 className="text-4xl">Администратор</h1>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map((period) => (
            <Link
              key={period}
              className={
                days === period ? "button-primary" : "button-secondary"
              }
              href={`/admin?days=${period}`}
            >
              {period} дней
            </Link>
          ))}
        </div>
      </div>
      <RouterSetup initial={await paymentAvailability()} />
      <ModerationPanel
        reports={
          reports.data as unknown as Parameters<
            typeof ModerationPanel
          >[0]["reports"]
        }
        hidden={hidden.data!}
      />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(([label, value]) => (
          <div className="panel p-5" key={label}>
            <p className="text-xs text-muted mb-4">{label}</p>
            <p className="text-3xl text-acid break-words">{value}</p>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted my-6 leading-7">
        Активный продавец опубликовал хотя бы один товар за последние 30 дней.
        Всего товаров: {m.products_total}, открыты продажи: {visible.count ?? 0}
        . Статистика регистраций и публикаций общая для платформы.
      </p>
      <div className="panel p-6 mb-8">
        <h2 className="text-2xl mb-2">Оборот по дням</h2>
        <p className="text-xs text-muted mb-6">
          Europe/Chisinau · сумма в USD по курсу, зафиксированному в заказе
        </p>
        <div
          className="flex items-end h-40 gap-1"
          role="img"
          aria-label={`Оборот за ${days} дней: ${usd(m.turnover_usd)}. Точные значения в таблице ниже.`}
        >
          {m.daily.map((day) => (
            <div
              key={day.day}
              className="flex-1 bg-acid/70 hover:bg-acid rounded-t min-w-0"
              style={{
                height: `${Math.max(1, (Number(day.turnover) / peak) * 100)}%`,
              }}
              title={`${day.day}: ${usd(day.turnover)} · ${day.sales} продаж`}
            />
          ))}
        </div>
        <div className="flex justify-between text-xs text-muted mt-3">
          <span>{m.daily[0]?.day}</span>
          <span>{m.daily.at(-1)?.day}</span>
        </div>
      </div>
      <div className="grid lg:grid-cols-2 gap-8">
        <div className="panel p-6">
          <h2 className="text-2xl mb-5">Выплаты по активам</h2>
          {m.assets.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-muted">
                  <tr>
                    <th className="pb-3">Актив / сеть</th>
                    <th className="pb-3">Оборот</th>
                    <th className="pb-3">Платформе</th>
                  </tr>
                </thead>
                <tbody>
                  {m.assets.map((a) => (
                    <tr key={a.asset} className="border-t border-white/10">
                      <td className="py-3 pr-4">
                        {a.asset}
                        <span className="block text-xs text-muted">
                          {a.sales} продаж
                        </span>
                      </td>
                      <td className="pr-4">
                        {Number(a.turnover).toLocaleString("ru-RU", {
                          maximumFractionDigits: 9,
                        })}
                      </td>
                      <td className="text-acid">
                        {Number(a.revenue).toLocaleString("ru-RU", {
                          maximumFractionDigits: 9,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted">
              Подтверждённых оплат за этот период ещё нет.
            </p>
          )}
          <p className="text-sm text-muted mt-6 leading-7">
            Доход платформы — фактически полученная комиссия (10% для цены ниже $2.50, иначе 5% + $0.50), до расходов
            сервиса. Выплаты партнёрам: {usd(m.affiliate_usd)}. Курс каждого
            заказа фиксируется отдельно; это оценка оборота, а не текущий баланс
            кошельков.
            {TESTNET && " Все суммы здесь относятся к тестовым токенам."}
          </p>
        </div>
        <div className="panel p-6">
          <h2 className="text-2xl mb-5">По дням</h2>
          <div className="overflow-auto max-h-96">
            <table className="w-full text-sm text-left">
              <thead className="text-muted">
                <tr>
                  <th className="pb-3">День</th>
                  <th className="pb-3">Продажи</th>
                  <th className="pb-3">Оборот</th>
                  <th className="pb-3">Доход</th>
                </tr>
              </thead>
              <tbody>
                {[...m.daily].reverse().map((d) => (
                  <tr key={d.day} className="border-t border-white/10">
                    <td className="py-3 pr-3 whitespace-nowrap">{d.day}</td>
                    <td>{d.sales}</td>
                    <td className="pr-3 whitespace-nowrap">
                      {usd(d.turnover)}
                    </td>
                    <td className="text-acid whitespace-nowrap">
                      {usd(d.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
