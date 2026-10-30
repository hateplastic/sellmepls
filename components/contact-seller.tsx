"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
export function ContactSeller({ productId }: { productId: string }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const router = useRouter();
  async function start() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", productId }),
      });
      if (response.status === 401) {
        router.push(`/messages?product=${productId}`);
        return;
      }
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Не удалось открыть переписку");
      router.push(`/messages/${result.id}`);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Не удалось открыть переписку",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button
        type="button"
        className="button-secondary"
        disabled={busy}
        onClick={start}
      >
        <MessageCircle size={17} />
        {busy ? "Открываем…" : "Написать продавцу"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-300 mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
