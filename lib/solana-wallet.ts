"use client";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import type { StandardConnectFeature } from "@wallet-standard/features";
import type {
  SolanaSignMessageFeature,
  SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import { PublicKey, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { phantomWallet } from "./wallet";
import { TESTNET } from "./network";

const selectionKey = "sellmepls:solana-wallet";
type Supported = Wallet & {
  features: StandardConnectFeature &
    SolanaSignMessageFeature &
    SolanaSignTransactionFeature;
};
const chain = TESTNET ? "solana:devnet" : "solana:mainnet";
function supported(wallet: Wallet): wallet is Supported {
  return Boolean(
    wallet.features["standard:connect"] &&
    wallet.features["solana:signMessage"] &&
    wallet.features["solana:signTransaction"] &&
    wallet.chains.includes(chain),
  );
}
export function solanaWallets() {
  return getWallets().get().filter(supported);
}
export function watchSolanaWallets(update: () => void) {
  const registry = getWallets();
  const offRegister = registry.on("register", update);
  const offUnregister = registry.on("unregister", update);
  return () => {
    offRegister();
    offUnregister();
  };
}
export function forgetSolanaWallet() {
  try {
    localStorage.removeItem(selectionKey);
  } catch {}
}
export async function connectSolana(name?: string, expectedAddress?: string) {
  let selected = name;
  if (!selected)
    try {
      selected = localStorage.getItem(selectionKey) || undefined;
    } catch {}
  const wallets = solanaWallets();
  const wallet = selected
    ? wallets.find((w) => w.name === selected)
    : wallets.length === 1
      ? wallets[0]
      : undefined;
  if (wallet) {
    if (
      !wallet.features[
        "solana:signTransaction"
      ].supportedTransactionVersions.includes("legacy")
    )
      throw new Error(
        "Этот кошелёк не поддерживает формат платежа. Выберите другой Solana-кошелёк.",
      );
    const { accounts } = await wallet.features["standard:connect"].connect();
    const account: WalletAccount | undefined = accounts.find(
      (a) =>
        a.chains.includes(chain) &&
        (!expectedAddress || a.address === expectedAddress),
    );
    if (!account)
      throw new Error(
        "Выберите в кошельке Solana-адрес, которым выполнен вход на сайт, либо смените аккаунт на сайте.",
      );
    try {
      localStorage.setItem(selectionKey, wallet.name);
    } catch {}
    return {
      name: wallet.name,
      publicKey: new PublicKey(account.address),
      async signMessage(message: Uint8Array) {
        const [result] = await wallet.features[
          "solana:signMessage"
        ].signMessage({ account, message });
        if (
          !result ||
          result.signature.length !== 64 ||
          !Buffer.from(result.signedMessage).equals(Buffer.from(message))
        )
          throw new Error(
            "Кошелёк изменил сообщение входа или вернул неверную подпись.",
          );
        return result.signature;
      },
      async signTransaction(transaction: Transaction) {
        const message = transaction.serializeMessage();
        const [result] = await wallet.features[
          "solana:signTransaction"
        ].signTransaction({
          account,
          chain,
          transaction: transaction.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          }),
        });
        if (!result) throw new Error("Кошелёк не подписал транзакцию");
        const signed = Transaction.from(result.signedTransaction);
        if (!signed.serializeMessage().equals(message))
          throw new Error("Кошелёк изменил платёж. Транзакция не отправлена.");
        return signed;
      },
    };
  }
  if (selected && selected !== "Phantom")
    throw new Error(
      `Откройте ${selected} или заново войдите доступным кошельком Solana.`,
    );
  const fallback = phantomWallet();
  const { publicKey } = await fallback.connect();
  if (expectedAddress && publicKey.toBase58() !== expectedAddress)
    throw new Error(
      "Выберите в Phantom адрес входа на сайт, либо смените аккаунт на сайте.",
    );
  try {
    localStorage.setItem(selectionKey, "Phantom");
  } catch {}
  return {
    name: "Phantom",
    publicKey,
    async signMessage(message: Uint8Array) {
      return (await fallback.signMessage(message, "utf8")).signature;
    },
    async signTransaction(transaction: Transaction) {
      const message = transaction.serializeMessage();
      const signed = await fallback.signTransaction(transaction);
      if (!signed.serializeMessage().equals(message))
        throw new Error("Кошелёк изменил платёж. Транзакция не отправлена.");
      return signed;
    },
  };
}
