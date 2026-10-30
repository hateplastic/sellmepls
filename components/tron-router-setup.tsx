"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TronWeb } from "tronweb";
import { connectTron } from "@/lib/tron-wallet";
import { api, walletError } from "@/lib/wallet";
import { CHAIN_ENV } from "@/lib/network";
type Deployment = Awaited<
  ReturnType<TronWeb["transactionBuilder"]["createSmartContract"]>
>;
export function TronRouterSetup({ enabled }: { enabled: boolean }) {
  const [busy, setBusy] = useState(false),
    [hash, setHash] = useState(""),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const router = useRouter();
  async function register() {
    await api("/api/admin/tron-router", { action: "register", hash });
    setStatus("TRON-контракт проверен. Приём USDT TRC20 включён.");
    router.refresh();
  }
  return (
    <div className="panel p-6 mb-8">
      <h2 className="text-2xl mb-3">TRON · USDT TRC20</h2>
      <p className="text-sm text-muted mb-4">
        {enabled
          ? "Контракт зарегистрирован."
          : "Один раз создайте контракт распределения выплат через TronLink. Лимит расходов развёртывания — 200 TRX; фактические расходы покажет кошелёк. Комиссии покупок оплачивает покупатель, платформа не спонсирует Energy."}
      </p>
      <button
        className="button-primary"
        disabled={busy || enabled || Boolean(hash)}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const { wallet, address } = await connectTron();
            const prepared = await api<{
              transaction: Deployment;
              data: string;
              environment: string;
            }>("/api/admin/tron-router", { action: "prepare", address });
            if (
              prepared.environment !== CHAIN_ENV ||
              prepared.transaction.raw_data.contract[0].parameter.value.new_contract.bytecode.toLowerCase() !==
                prepared.data.slice(2).toLowerCase()
            )
              throw new Error("Параметры развёртывания изменены");
            setStatus(
              "Проверьте лимит TRX и подтвердите развёртывание в кошельке",
            );
            const signed = await wallet.trx.sign(prepared.transaction);
            const sent = await wallet.trx.sendRawTransaction(signed);
            if (!sent.result) throw new Error("TRON отклонил развёртывание");
            setHash(signed.txID);
            setStatus(
              "Транзакция отправлена. После подтверждения нажмите «Проверить и сохранить».",
            );
          } catch (e) {
            setError(walletError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Создать TRON-контракт через кошелёк
      </button>
      <label className="block mt-4">
        Хеш развёртывания TRON
        <input
          className="mt-2"
          value={hash}
          onChange={(e) => setHash(e.target.value.trim())}
          maxLength={64}
        />
      </label>
      <button
        className="button-secondary mt-3"
        disabled={busy || !/^[0-9a-fA-F]{64}$/.test(hash)}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await register();
          } catch (e) {
            setError(walletError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Проверить и сохранить
      </button>
      {status && (
        <p role="status" className="text-acid text-sm mt-3">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-300 text-sm mt-3">
          {error}
        </p>
      )}
    </div>
  );
}
