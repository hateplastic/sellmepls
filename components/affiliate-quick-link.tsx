"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Link2, LoaderCircle, X } from "lucide-react";
import { ShareLink } from "./affiliate-tools";
import { WalletAuth } from "./wallet-auth";

export function AffiliateQuickLink({
  productId,
  sellerId,
  title,
  bps,
  reward,
  priceLabel,
  stock,
}: {
  productId: string;
  sellerId: string;
  title: string;
  bps: number;
  reward: string;
  priceLabel: string;
  stock: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  async function load() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setUrl("");
    setNeedsLogin(false);
    try {
      const response = await fetch("/api/affiliate-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, sellerId, campaign: "Основная" }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (response.status === 401) {
        setNeedsLogin(true);
        setError("Войдите кошельком, чтобы получить личную ссылку.");
      } else if (!response.ok) {
        setError(
          data.error || "Не удалось получить ссылку. Попробуйте ещё раз.",
        );
      } else setUrl(data.url);
    } catch {
      if (!controller.signal.aborted)
        setError("Не удалось связаться с сервером. Попробуйте ещё раз.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="mx-5 mb-5 flex items-center gap-2 rounded-md text-left text-xs text-acid hover:text-lime-200 transition py-1"
        aria-haspopup="dialog"
        aria-label={`Получить партнёрскую ссылку: ${title}, ${bps / 100}%, ${reward}`}
        title="Получить партнёрскую ссылку"
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
          void load();
        }}
      >
        <Link2 size={14} aria-hidden="true" className="shrink-0" />
        <span>
          {bps / 100}% <span className="text-muted mx-1">·</span>{" "}
          <strong className="font-semibold">{reward}</strong>{" "}
          <span className="text-muted">{stock ? "за шт." : "за продажу"}</span>
        </span>
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={headingId}
        className="m-auto w-[calc(100%_-_2rem)] max-w-md max-h-[85dvh] overflow-y-auto rounded-2xl border border-white/15 bg-[#111611] text-white p-6 sm:p-7 shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm"
        onClose={() => {
          request.current?.abort();
          setOpen(false);
          setBusy(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const rect = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < rect.left ||
              event.clientX > rect.right ||
              event.clientY < rect.top ||
              event.clientY > rect.bottom
            )
              dialog.current?.close();
          }
        }}
      >
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <p className="eyebrow mb-2">Партнёрская ссылка</p>
            <h2 id={headingId} className="text-xl break-words">
              {title}
            </h2>
          </div>
          <button
            type="button"
            autoFocus
            aria-label="Закрыть"
            className="p-2 rounded-lg hover:bg-white/10 shrink-0"
            onClick={() => dialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <p className="text-3xl font-semibold text-acid">{reward}</p>
        <p className="text-sm text-muted mt-2">
          {bps / 100}% от цены {priceLabel}{" "}
          {stock ? "за одну единицу" : "за продажу"}.
        </p>
        <p className="text-xs text-muted leading-5 mt-3 mb-6">
          Выплата — в валюте покупки на ваш кошелёк. Долларовая сумма
          ориентировочная; она зависит от выбранной цены и курса при оплате.
        </p>
        {busy && (
          <p role="status" className="flex gap-2 items-center text-sm">
            <LoaderCircle className="animate-spin" size={18} /> Получаем вашу
            ссылку…
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-amber-200 mb-4">
            {error}
          </p>
        )}
        {needsLogin && (
          <div className="mb-4">
            <WalletAuth />
          </div>
        )}
        {!busy && error && (
          <button
            type="button"
            className="button-secondary mb-4"
            onClick={() => void load()}
          >
            {needsLogin ? "Получить ссылку после входа" : "Повторить"}
          </button>
        )}
        {url && <ShareLink url={url} />}
        <Link
          href="/affiliates"
          className="block text-xs text-muted underline mt-5"
        >
          Настройки выплат и мои партнёрские ссылки ↗
        </Link>
      </dialog>
    </>
  );
}
