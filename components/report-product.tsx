"use client";
import { useState } from "react";
import { Flag } from "lucide-react";
import { api, walletError } from "@/lib/wallet";
export function ReportProduct({ productId }: { productId: string }) {
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState("malware"),
    [details, setDetails] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sent, setSent] = useState(false);
  return (
    <div className="mt-6">
      <button
        className="text-xs text-muted flex items-center gap-2"
        onClick={() => setOpen(!open)}
      >
        <Flag size={14} />
        Пожаловаться на товар
      </button>
      {open && (
        <form
          className="panel p-5 mt-3 space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api("/api/reports", { productId, reason, details });
              setSent(true);
            } catch (e) {
              setError(walletError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {sent ? (
            <p role="status" className="text-acid text-sm">
              Жалоба передана администратору. Повторно отправлять её не нужно.
            </p>
          ) : (
            <>
              <label>
                Причина
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                >
                  <option value="malware">
                    Подозрение на вредоносный файл
                  </option>
                  <option value="fraud">Обман / неверное описание</option>
                  <option value="copyright">Нарушение авторских прав</option>
                  <option value="prohibited">Запрещённое содержимое</option>
                  <option value="other">Другое</option>
                </select>
              </label>
              <label>
                Подробности
                <textarea
                  required
                  minLength={10}
                  maxLength={2000}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                />
              </label>
              <p className="text-xs text-muted">
                Нужен вход кошельком. Не указывайте приватные ключи и
                персональные данные в описании.
              </p>
              <button disabled={busy} className="button-secondary">
                {busy ? "Отправка…" : "Отправить жалобу"}
              </button>
            </>
          )}
          {error && (
            <p role="alert" className="text-red-300 text-sm">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
