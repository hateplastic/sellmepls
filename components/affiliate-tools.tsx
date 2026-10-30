"use client";
import Link from "next/link";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Share2 } from "lucide-react";
import { api, walletError } from "@/lib/wallet";
export function ShareLink({ url }: { url: string }) {
  const [message, setMessage] = useState("");
  return (
    <div className="space-y-3">
      <input
        aria-label="Партнёрская ссылка"
        readOnly
        value={url}
        onFocus={(e) => e.target.select()}
        className="font-mono text-xs"
      />
      <div className="flex gap-3 flex-wrap">
        <button
          className="button-secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setMessage("Ссылка скопирована");
            } catch {
              setMessage("Выделите и скопируйте ссылку выше");
            }
          }}
        >
          <Copy size={15} />
          Копировать
        </button>
        <button
          className="button-secondary"
          onClick={async () => {
            try {
              if (navigator.share)
                await navigator.share({
                  title: "Рекомендую этот магазин",
                  url,
                });
              else {
                await navigator.clipboard.writeText(url);
                setMessage("Ссылка скопирована");
              }
            } catch {
              setMessage("Публикация отменена");
            }
          }}
        >
          <Share2 size={15} />
          Поделиться
        </button>
        <details>
          <summary className="button-secondary cursor-pointer">QR-код</summary>
          <div className="mt-3 p-3 bg-white w-fit rounded-lg">
            <QRCodeSVG value={url} size={144} />
          </div>
        </details>
      </div>
      {message && (
        <p role="status" className="text-xs text-acid">
          {message}
        </p>
      )}
    </div>
  );
}
export function AffiliateJoin({
  productId,
  sellerId,
  bps,
}: {
  productId?: string;
  sellerId: string;
  bps?: number;
}) {
  const [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <aside className="panel p-6 mt-6">
      <p className="eyebrow mb-3">Зарабатывайте на рекомендациях</p>
      <h2 className="text-xl">
        {bps ? `${bps / 100}% за продажу` : "Партнёрская ссылка на витрину"}
      </h2>
      <p className="text-sm text-muted mt-3 leading-6">
        {productId
          ? "Продавец разрешил продвигать этот товар."
          : "Комиссия начисляется за товары с включённой партнёрской программой; процент указан в каждом товаре."}{" "}
        Выплата поступает на ваш кошелёк при оплате. Срок перехода — 30 дней.
      </p>
      <form
        className="my-4 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const d = new FormData(e.currentTarget);
          try {
            const r = await api<{ url: string }>("/api/affiliate-links", {
              productId,
              sellerId,
              campaign: d.get("campaign"),
            });
            setUrl(r.url);
          } catch (err) {
            setError(walletError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Название кампании
          <input
            name="campaign"
            className="mt-2"
            defaultValue="Основная"
            maxLength={40}
            required
          />
        </label>
        <button className="button-primary" disabled={busy}>
          {busy ? "Создаём…" : "Получить мою ссылку"}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-red-300 text-sm mb-3">
          {error}
        </p>
      )}
      {url && <ShareLink url={url} />}
      <Link
        className="text-xs text-muted underline block mt-4"
        href="/affiliates"
      >
        Мои ссылки, статистика и настройки выплат ↗
      </Link>
    </aside>
  );
}
