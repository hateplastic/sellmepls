"use client";
import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import {
  createWalletClient,
  custom,
  type Abi,
  type Hex,
  type EIP1193Provider,
} from "viem";
import { chains } from "@/lib/web3";
import {
  CHAIN_ENV,
  EVM_NETWORKS,
  isNetworkOffered,
  type EvmNetwork,
  type PaymentAvailability,
} from "@/lib/network";
import { walletError } from "@/lib/wallet";
import { useRouter } from "next/navigation";
import { TronRouterSetup } from "./tron-router-setup";
export function RouterSetup({ initial }: { initial: PaymentAvailability }) {
  const account = useAccount(),
    { connectors, connectAsync } = useConnect(),
    router = useRouter();
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [network, setNetwork] = useState<EvmNetwork>("base"),
    [hash, setHash] = useState("");
  const storageKey = `sellmepls:deployment:${CHAIN_ENV}:${network}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      setHash(saved && /^0x[0-9a-fA-F]{64}$/.test(saved) ? saved : "");
    } catch {
      setHash("");
    }
  }, [storageKey]);
  async function register(tx: string) {
    for (let attempt = 0; attempt < 36; attempt++) {
      const response = await fetch("/api/admin/routers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network, hash: tx }),
        signal: AbortSignal.timeout(45000),
      });
      const result = await response.json();
      if (response.status === 202) {
        setStatus(result.error || "Ожидаем подтверждение сети…");
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      if (!response.ok)
        throw new Error(
          result.error || "Проверка контракта временно недоступна",
        );
      try {
        localStorage.removeItem(storageKey);
      } catch {}
      setStatus("Контракт проверен и сохранён. Оплата в этой сети доступна.");
      router.refresh();
      return;
    }
    throw new Error(
      "Подтверждение ещё ожидается. Хеш сохранён — повторите проверку без нового развёртывания.",
    );
  }
  async function deploy() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/routers?network=${network}`);
      const config = (await response.json()) as {
        abi: Abi;
        bytecode: Hex;
        args: readonly unknown[];
        environment: string;
        address: string | null;
        error?: string;
      };
      if (!response.ok)
        throw new Error(config.error || "Конфигурация недоступна");
      if (config.environment !== CHAIN_ENV)
        throw new Error("Окружение страницы устарело. Обновите страницу.");
      if (config.address)
        throw new Error("Контракт уже настроен. Обновите страницу.");
      const connector =
        account.connector ||
        connectors.find((c) => c.name.toLowerCase().includes("metamask")) ||
        connectors[0];
      if (!connector)
        throw new Error("Подключите EVM-кошелёк через кнопку входа");
      if (
        network === "arbitrum" &&
        connector.name.toLowerCase().includes("phantom")
      )
        throw new Error(
          "Для Arbitrum используйте MetaMask или другой совместимый EVM-кошелёк. Phantom не поддерживает Arbitrum.",
        );
      if (!account.isConnected) await connectAsync({ connector });
      const provider = (await connector.getProvider()) as EIP1193Provider;
      const client = createWalletClient({
        chain: chains[network],
        transport: custom(provider),
      });
      try {
        await client.switchChain({ id: chains[network].id });
      } catch (error) {
        if ((error as { code?: number }).code !== 4902) throw error;
        await client.addChain({ chain: chains[network] });
        await client.switchChain({ id: chains[network].id });
      }
      const [address] = await client.requestAddresses();
      if (!address) throw new Error("Кошелёк не предоставил адрес");
      setStatus(
        "Подтвердите создание контракта в кошельке. Потребуется ETH или BNB в выбранной сети на комиссию.",
      );
      const tx = await client.deployContract({
        account: address,
        abi: config.abi,
        bytecode: config.bytecode,
        args: config.args,
      });
      setHash(tx);
      try {
        localStorage.setItem(storageKey, tx);
      } catch {}
      setStatus(
        "Контракт отправлен. Ожидаем два подтверждения… Сохраните хеш на случай закрытия страницы.",
      );
      await register(tx);
    } catch (error) {
      setError(walletError(error));
      setStatus(
        "Если транзакция уже отправлена, повторите проверку по сохранённому хешу. Создавать контракт заново не нужно.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {isNetworkOffered("tron") && <TronRouterSetup enabled={initial.tron} />}
      <div className="panel p-6 mb-8">
        <h2 className="text-2xl mb-3">Настройка платежей · {CHAIN_ENV}</h2>
        <p className="text-sm text-muted mb-4">
          Solana:{" "}
          {initial.solana ? "настроена" : "нужна настройка RPC и адреса"}. Base:{" "}
          {initial.base ? "настроена" : "нужен контракт"}. Arbitrum:{" "}
          {initial.arbitrum ? "настроена" : "нужен контракт"}. BNB Chain:{" "}
          {initial.bsc ? "настроена" : "нужен контракт"}.
        </p>
        <p className="text-sm text-muted mb-4">
          Для разделения платежа в Base, Arbitrum и BNB Chain один раз создайте
          контракт в каждой сети. Кошелёк покажет расход ETH (или BNB для BNB
          Chain) на развёртывание. Адрес платформы и ключ проверки заказов
          зашиты в контракт; сервер проверит их перед подключением. Приватный
          ключ кошелька сайту не нужен.
        </p>
        <div className="flex flex-wrap gap-3">
          <select
            aria-label="Сеть для контракта"
            value={network}
            disabled={busy}
            onChange={(e) => {
              setNetwork(e.target.value as typeof network);
              setHash("");
              setError("");
              setStatus("");
            }}
          >
            {EVM_NETWORKS.filter(isNetworkOffered).map((n) => (
              <option key={n} value={n}>
                {chains[n].name}
              </option>
            ))}
          </select>
          <button
            className="button-primary"
            disabled={busy || initial[network] || Boolean(hash)}
            onClick={deploy}
          >
            {busy
              ? "Ожидание…"
              : initial[network]
                ? "Уже настроено"
                : "Создать контракт через кошелёк"}
          </button>
        </div>
        <details className="text-sm mt-4" open={Boolean(hash)}>
          <summary>Восстановить настройку по хешу развёртывания</summary>
          <input
            className="mt-3"
            aria-label="Хеш развёртывания"
            value={hash}
            disabled={busy}
            onChange={(e) => {
              const value = e.target.value.trim();
              setHash(value);
              if (/^0x[0-9a-fA-F]{64}$/.test(value))
                try {
                  localStorage.setItem(storageKey, value);
                } catch {}
            }}
            placeholder="0x…"
          />
          <button
            className="button-secondary mt-3"
            disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(hash)}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await register(hash);
              } catch (e) {
                setError(walletError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Проверить и сохранить
          </button>
        </details>
        {status && (
          <p role="status" className="text-acid text-sm mt-4">
            {status}
          </p>
        )}
        {hash && <p className="text-xs font-mono break-all mt-3">TX: {hash}</p>}
        {error && (
          <p role="alert" className="text-red-300 text-sm mt-4">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
