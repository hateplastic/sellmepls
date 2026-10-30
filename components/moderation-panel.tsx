"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, walletError } from "@/lib/wallet";
type Report = {
  id: string;
  product_id: string;
  reason: string;
  details: string;
  created_at: string;
  product: { title: string };
};
export function ModerationPanel({
  reports,
  hidden,
}: {
  reports: Report[];
  hidden: { id: string; title: string }[];
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [productId, setProductId] = useState(""),
    [reason, setReason] = useState("");
  async function send(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/moderation", body);
      router.refresh();
    } catch (e) {
      setError(walletError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="panel p-6 mb-8">
      <h2 className="text-2xl mb-4">Модерация</h2>
      <p className="text-sm text-muted mb-5">
        Скрытие убирает товар из каталога, витрины и новых заказов. Уже
        оплаченные покупки сохраняются. Показаны последние 100 открытых жалоб и
        100 скрытых товаров.
      </p>
      <form
        className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 mb-6"
        onSubmit={(e) => {
          e.preventDefault();
          void send({ action: "visibility", productId, hidden: true, reason });
        }}
      >
        <input
          aria-label="ID товара для скрытия"
          placeholder="ID товара"
          value={productId}
          onChange={(e) => setProductId(e.target.value.trim())}
          required
          pattern="[0-9a-fA-F-]{36}"
        />
        <input
          aria-label="Причина модерации"
          placeholder="Причина (сохранится в журнале)"
          value={reason}
          minLength={5}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
          required
        />
        <button className="button-secondary" disabled={busy}>
          Скрыть товар
        </button>
      </form>
      {reports.length ? (
        <div className="divide-y divide-white/10">
          {reports.map((r) => (
            <div className="py-4" key={r.id}>
              <Link className="text-acid" href={`/p/${r.product_id}`}>
                {r.product.title} ↗
              </Link>
              <p className="text-xs text-muted my-2">
                {r.reason} · {new Date(r.created_at).toLocaleString("ru-RU")}
              </p>
              <p className="text-sm whitespace-pre-wrap break-words mb-3">
                {r.details}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className="button-secondary"
                  disabled={busy}
                  onClick={() =>
                    send({
                      action: "visibility",
                      productId: r.product_id,
                      hidden: true,
                      reason: `Жалоба ${r.id}: ${r.reason}`,
                    })
                  }
                >
                  Скрыть и закрыть жалобы
                </button>
                <button
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => send({ action: "dismiss", reportId: r.id })}
                >
                  Закрыть без скрытия
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">Открытых жалоб нет.</p>
      )}
      {hidden.length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg mb-3">Скрытые товары</h3>
          {hidden.map((p) => (
            <div
              key={p.id}
              className="flex gap-4 justify-between items-center py-3 border-t border-white/10"
            >
              <Link className="text-sm break-words" href={`/p/${p.id}`}>
                {p.title} ↗
              </Link>
              <button
                disabled={busy}
                className="button-secondary shrink-0"
                onClick={() =>
                  send({
                    action: "visibility",
                    productId: p.id,
                    hidden: false,
                    reason:
                      "Повторная проверка администратором: публикация разрешена",
                  })
                }
              >
                Вернуть
              </button>
            </div>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300 mt-4">
          {error}
        </p>
      )}
    </div>
  );
}
