"use client";
import type { TronWeb } from "tronweb";
import { isTronAddress } from "./tron-address";
declare global {
  interface Window {
    tronLink?: {
      request(input: { method: string }): Promise<{ code?: number }>;
      tronWeb?: TronWeb;
    };
    tronWeb?: TronWeb;
  }
}
export async function connectTron(expected?: string) {
  if (!window.tronLink && !window.tronWeb)
    throw new Error(
      "Установите TronLink или откройте сайт в браузере кошелька с поддержкой TRON",
    );
  if (window.tronLink) {
    const result = await window.tronLink.request({
      method: "tron_requestAccounts",
    });
    if (result?.code && result.code !== 200)
      throw new Error("Подключение TRON отклонено кошельком");
  }
  const wallet = window.tronLink?.tronWeb || window.tronWeb,
    address = wallet?.defaultAddress.base58;
  if (!wallet || typeof address !== "string" || !isTronAddress(address))
    throw new Error("Разблокируйте кошелёк TRON и выберите аккаунт");
  if (expected && expected !== address)
    throw new Error(
      "В кошельке TRON выбран другой адрес. Выберите адрес входа на сайт.",
    );
  return { wallet, address };
}
