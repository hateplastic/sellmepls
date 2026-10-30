"use client";
import { useState } from "react";
import { Copy, Check, Eye, EyeOff, Pencil } from "lucide-react";
import Link from "next/link";
import { setProductActive, setAffiliateProgram } from "@/app/dashboard/actions";
export function ProductControls({
  id,
  active,
  affiliateEnabled,
  affiliateBps,
}: {
  id: string;
  active: boolean;
  affiliateEnabled: boolean;
  affiliateBps: number;
}) {
  const [copied, setCopied] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/p/${id}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Не удалось скопировать ссылку");
    }
  }
  async function toggle() {
    setBusy(true);
    try {
      await setProductActive(id, !active);
    } catch {
      setError("Не удалось обновить товар");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/dashboard/products/${id}/edit`}
          className="button-secondary !px-3 !py-2 text-xs"
        >
          <Pencil size={14} />
          Редактировать
        </Link>
        <button
          onClick={copy}
          className="button-secondary !px-3 !py-2"
          aria-label="Скопировать ссылку"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button
          disabled={busy}
          onClick={toggle}
          className="button-secondary !px-3 !py-2 text-xs"
        >
          {active ? <EyeOff size={14} /> : <Eye size={14} />}{" "}
          {active ? "Скрыть" : "Показать"}
        </button>
      </div>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer">
          Партнёрам: {affiliateEnabled ? `${affiliateBps / 100}%` : "выключено"}
        </summary>
        <form
          className="space-y-3 mt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const data = new FormData(e.currentTarget);
            try {
              await setAffiliateProgram(
                id,
                data.get("enabled") === "on",
                Math.round(Number(data.get("percent")) * 100),
              );
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Не удалось сохранить",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="flex gap-2 items-center">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={affiliateEnabled}
            />
            Включена
          </label>
          <label>
            Процент партнёру
            <input
              name="percent"
              type="number"
              min="1"
              max="90"
              step="0.01"
              defaultValue={affiliateBps / 100}
              required
            />
          </label>
          <button className="button-secondary" disabled={busy}>
            Сохранить
          </button>
          <p>
            Новые условия действуют для новых заказов. Уже созданные заказы
            сохраняют прежнюю комиссию.
          </p>
        </form>
      </details>
      {error && (
        <p className="text-red-300 text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
