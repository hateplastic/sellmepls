"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePicker } from "@/components/file-picker";
import { api, walletError } from "@/lib/wallet";
import { restockProduct } from "@/app/dashboard/actions";

export function InventoryPanel({
  productId,
  counts,
}: {
  productId: string;
  counts: { available: number; reserved: number; sold: number };
}) {
  const [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [, startTransition] = useTransition(),
    router = useRouter();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      if (
        !file ||
        !/\.txt$/i.test(file.name) ||
        !file.size ||
        file.size > 8 * 1048576
      )
        throw new Error("Выберите TXT до 8 MB");
      const checksum = btoa(
        String.fromCharCode(
          ...new Uint8Array(
            await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
          ),
        ),
      );
      const ticket = await api<{
        id: string;
        url: string;
        contentType: string;
      }>("/api/uploads", {
        kind: "file",
        filename: file.name,
        bytes: file.size,
        checksum,
        contentType: "application/octet-stream",
      });
      const uploaded = await fetch(ticket.url, {
        method: "PUT",
        headers: { "Content-Type": ticket.contentType },
        body: file,
      });
      if (!uploaded.ok) throw new Error("Не удалось загрузить TXT в хранилище");
      const result = await new Promise<{ added?: number; error?: string }>(
        (resolve, reject) =>
          startTransition(async () => {
            try {
              resolve(await restockProduct({ productId, uploadId: ticket.id }));
            } catch (error) {
              reject(error);
            }
          }),
      );
      if (result.error) throw new Error(result.error);
      setMessage(
        `Добавлено: ${result.added} шт. Строки, уже встречавшиеся в этом товаре, пропущены.`,
      );
      setFile(null);
      router.refresh();
    } catch (error) {
      setError(walletError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form id="stock" onSubmit={submit} className="panel p-6 space-y-5 mt-8">
      <h2 className="text-2xl">Склад</h2>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <p>
          <strong className="block text-2xl text-acid">
            {counts.available}
          </strong>
          Доступно
        </p>
        <p>
          <strong className="block text-2xl">{counts.reserved}</strong>В резерве
        </p>
        <p>
          <strong className="block text-2xl">{counts.sold}</strong>Продано
        </p>
      </div>
      <FilePicker
        label="Пополнить товар · TXT до 8 MB"
        file={file}
        onChange={setFile}
        disabled={busy}
        accept=".txt,text/plain"
        hint="Одна строка — одна единица. До 10 000 строк за загрузку. Пополнение добавляет новые единицы, сохраняя оплаченные и зарезервированные."
      />
      <button className="button-primary" disabled={busy || !file}>
        {busy ? "Добавляем…" : "Пополнить склад"}
      </button>
      {error && (
        <p role="alert" className="text-red-300 text-sm">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-acid text-sm">
          {message}
        </p>
      )}
      <p className="text-xs text-muted">
        Резерв действует 10 минут. После начала оплаты он освобождается только
        после проверки сети. При недоступном RPC единицы остаются в резерве,
        чтобы исключить двойную продажу.
      </p>
    </form>
  );
}
