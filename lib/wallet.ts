"use client";
import type { PublicKey, Transaction } from "@solana/web3.js";
export type PhantomProvider = {
  publicKey: PublicKey | null;
  connect(): Promise<{ publicKey: PublicKey }>;
  signMessage(
    message: Uint8Array,
    display?: string,
  ): Promise<{ signature: Uint8Array }>;
  signTransaction(transaction: Transaction): Promise<Transaction>;
  disconnect(): Promise<void>;
};
declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider };
    solana?: PhantomProvider;
  }
}
export function phantomWallet() {
  const wallet = window.phantom?.solana || window.solana;
  if (!wallet)
    throw new Error(
      "Откройте сайт в браузере Phantom или установите расширение Phantom.",
    );
  return wallet;
}
export function walletError(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "web3_provider_disabled"
  )
    return "Вход кошельком пока не включён владельцем сайта. Нужно включить Web3 в настройках Supabase Authentication.";
  if (error && typeof error === "object" && "shortMessage" in error)
    return String(error.shortMessage);
  return error instanceof Error
    ? error.message
    : "Не удалось выполнить операцию";
}
export async function api<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Сервис недоступен");
  return data as T;
}
