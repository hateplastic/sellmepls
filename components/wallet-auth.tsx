"use client";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { ethereumLoginMessage, solanaLoginMessage } from "@/lib/login-message";
import { useRouter } from "next/navigation";
import { Wallet, LogOut, LoaderCircle } from "lucide-react";
import { browserDb } from "@/lib/supabase/client";
import { connectTron } from "@/lib/tron-wallet";
import type { WalletFamily } from "@/lib/network";
import { api, walletError } from "@/lib/wallet";
import {
  connectSolana,
  forgetSolanaWallet,
  solanaWallets,
  watchSolanaWallets,
} from "@/lib/solana-wallet";
import Link from "next/link";
import { shortAddress } from "@/lib/catalog";
import { walletIdentity } from "@/lib/wallet-identity";
export function WalletAuth({
  compact = false,
  preferredChain,
}: {
  compact?: boolean;
  preferredChain?: WalletFamily;
}) {
  const router = useRouter(),
    account = useAccount(),
    { connectors, connectAsync } = useConnect(),
    { disconnect } = useDisconnect();
  const [address, setAddress] = useState(""),
    [chain, setChain] = useState(""),
    [solWalletNames, setSolWalletNames] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false);
  useEffect(() => {
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
      return;
    const db = browserDb();
    const update = (user: import("@supabase/supabase-js").User | null) => {
      const identity = walletIdentity(user);
      setAddress(identity?.address || "");
      setChain(identity?.chain || "");
    };
    db.auth.getUser().then(({ data }) => update(data.user));
    const { data } = db.auth.onAuthStateChange((_event, session) =>
      update(session?.user || null),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const update = () => setSolWalletNames(solanaWallets().map((w) => w.name));
    update();
    return watchSolanaWallets(update);
  }, []);
  async function signIn(
    kind: WalletFamily,
    connectorIndex = 0,
    solanaName?: string,
  ) {
    setBusy(true);
    setError("");
    let stage = "Подключение кошелька";
    try {
      const db = browserDb();
      if (kind === "tron") {
        const { wallet, address } = await connectTron();
        const challenge = await api<{ id: string; message: string }>(
          "/api/auth/tron",
          { action: "challenge", address },
        );
        stage = "Подпись входа TRON";
        const signature = await wallet.trx.signMessageV2(challenge.message);
        await api("/api/auth/tron", {
          action: "verify",
          id: challenge.id,
          signature,
        });
        window.location.reload();
        return;
      }
      if (kind === "ethereum") {
        const connector = connectors[connectorIndex];
        if (!connector)
          throw new Error(
            "Установите MetaMask или откройте сайт в браузере кошелька.",
          );
        if (!account.isConnected || account.connector?.uid !== connector.uid)
          await connectAsync({ connector });
        const provider = (await connector.getProvider()) as EIP1193Provider;
        const client = createWalletClient({ transport: custom(provider) });
        const [currentAddress] = await client.requestAddresses();
        if (!currentAddress) throw new Error("Кошелёк не предоставил адрес");
        const chainId = await client.getChainId();
        const message = ethereumLoginMessage(
          currentAddress,
          chainId,
          window.location.origin,
        );
        stage = "Подпись входа";
        const signature = await client.signMessage({
          account: currentAddress,
          message,
        });
        stage = "Проверка подписи";
        const { error } = await db.auth.signInWithWeb3({
          chain: "ethereum",
          message,
          signature,
        });
        if (error) throw error;
      } else {
        const wallet = await connectSolana(solanaName);
        const publicKey = wallet.publicKey;
        const message = solanaLoginMessage(
          publicKey.toBase58(),
          window.location.origin,
        );
        stage = "Подпись входа Solana";
        const signature = await wallet.signMessage(
          new TextEncoder().encode(message),
        );
        if (!(signature instanceof Uint8Array) || signature.length !== 64)
          throw new Error("Кошелёк вернул некорректную подпись Solana");
        stage = "Проверка подписи Solana";
        const { error } = await db.auth.signInWithWeb3({
          chain: "solana",
          message,
          signature,
        });
        if (error) throw error;
      }
      setOpen(false);
      router.refresh();
    } catch (error) {
      setError(`${stage}: ${walletError(error)}`);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    try {
      const { error } = await browserDb().auth.signOut();
      if (error) throw error;
      disconnect();
      forgetSolanaWallet();
      setAddress("");
      setOpen(true);
      router.refresh();
    } catch (error) {
      setError(walletError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="relative">
      {address ? (
        <button
          className="button-secondary text-sm"
          onClick={signOut}
          disabled={busy}
          aria-label="Сменить аккаунт"
          title={`Выйти из ${address} и выбрать другой аккаунт`}
        >
          <span className="status-dot" />
          <span>
            {shortAddress(address)}
            <span className="hidden sm:inline">
              {" "}
              ·{" "}
              {chain === "tron"
                ? "TRON"
                : chain === "solana"
                  ? "Solana"
                  : "EVM"}
            </span>
          </span>
          <span className="text-xs hidden lg:inline">Сменить аккаунт</span>
          <LogOut size={14} />
        </button>
      ) : (
        <button
          className={compact ? "button-secondary" : "button-primary"}
          onClick={() => setOpen(!open)}
          disabled={busy}
        >
          <Wallet size={17} />
          {busy ? (
            "Подпишите вход…"
          ) : compact ? (
            <>
              <span className="sm:hidden">Войти</span>
              <span className="hidden sm:inline">Подключить кошелёк</span>
            </>
          ) : (
            "Подключить кошелёк"
          )}
        </button>
      )}
      {open && !address && (
        <div className="wallet-menu">
          <p className="mb-3 text-sm text-muted">Выберите кошелёк для входа</p>
          {preferredChain === "solana" && (
            <p className="text-acid text-xs mb-3">
              Для выбранной оплаты нужен адрес Solana.
            </p>
          )}
          {(!preferredChain || preferredChain === "ethereum") &&
            (connectors.length ? (
              connectors.map((c, i) =>
                c.id === "injected" && connectors.length > 1 ? null : (
                  <button
                    className="button-secondary w-full mb-2"
                    key={c.uid}
                    disabled={busy}
                    onClick={() => signIn("ethereum", i)}
                  >
                    {busy ? (
                      <LoaderCircle className="animate-spin" size={16} />
                    ) : (
                      <Wallet size={16} />
                    )}{" "}
                    {c.name === "Injected" ? "Кошелёк браузера" : c.name} ·{" "}
                    {c.name.toLowerCase().includes("phantom") ? "Base" : "EVM"}
                  </button>
                ),
              )
            ) : (
              <button
                className="button-secondary w-full mb-2"
                disabled={busy}
                onClick={() => signIn("ethereum")}
              >
                MetaMask / EVM
              </button>
            ))}
          {(!preferredChain || preferredChain === "solana") &&
            (solWalletNames.length ? (
              solWalletNames.map((name) => (
                <button
                  className="button-secondary w-full mb-2"
                  key={name}
                  disabled={busy}
                  onClick={() => signIn("solana", 0, name)}
                >
                  {name} · Solana
                </button>
              ))
            ) : (
              <button
                className="button-secondary w-full"
                disabled={busy}
                onClick={() => signIn("solana", 0, "Phantom")}
              >
                Phantom · Solana
              </button>
            ))}
          {preferredChain === "tron" && (
            <button
              className="button-secondary w-full mt-2"
              disabled={busy}
              onClick={() => signIn("tron")}
            >
              TronLink · TRON
            </button>
          )}
          <p className="text-xs text-muted mt-3">
            EVM — Base, Arbitrum и BNB Chain. У Solana — отдельная сеть и адрес.
            Разные адреса входа — разные аккаунты. Подпись для входа не
            переводит средства.
          </p>
          <Link href="/wallets" className="text-acid text-sm mt-3 block">
            Все сети и кошельки · установка ↗
          </Link>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 max-w-sm text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
