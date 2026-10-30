"use client";
import { api } from "./wallet";
import type { Sale } from "./catalog";
import { connectTron } from "./tron-wallet";
import {
  assertTronTransaction,
  type TronTransaction,
  type TronStep,
} from "./tron-transaction";
export type TronPrepared = {
  step: TronStep;
  transaction: TronTransaction;
  ticket: string;
  estimate: {
    asset: string;
    tokenBalance: string;
    nativeBalance: string;
    feeLimit: string;
    maximumFee: string;
    needsApproval: boolean;
  };
};
export async function payTron(
  order: Sale,
  onHash: (hash: string) => void,
  onStatus: (status: string) => void,
) {
  const { wallet } = await connectTron(order.buyer_wallet);
  for (let stage = 0; stage < 3; stage++) {
    const prepared = await api<TronPrepared>("/api/tron/transaction", {
      action: "prepare",
      orderId: order.id,
    });
    assertTronTransaction(order, prepared.step, prepared.transaction);
    onStatus(
      `${prepared.step === "pay" ? "Оплата" : prepared.step === "approve" ? "Разрешение только суммы заказа" : "Сброс старого разрешения"} · TRON. Лимит сетевых расходов этой операции: ${prepared.estimate.maximumFee} TRX. Подтвердите в кошельке.`,
    );
    const signed = await wallet.trx.sign(prepared.transaction);
    const sent = await api<{ hash: string }>("/api/tron/transaction", {
      action: "send",
      orderId: order.id,
      step: prepared.step,
      transaction: signed,
      ticket: prepared.ticket,
    });
    if (prepared.step === "pay") {
      onHash(sent.hash);
      return;
    }
    onStatus("Ожидаем подтверждение разрешения TRON…");
    let confirmed = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const state = await api<{ confirmed: boolean; success: boolean }>(
        "/api/tron/transaction",
        { action: "status", orderId: order.id, hash: sent.hash },
      );
      if (state.confirmed) {
        if (!state.success) throw new Error("Разрешение токена отклонено TRON");
        confirmed = true;
        break;
      }
    }
    if (!confirmed)
      throw new Error(
        `Подтверждение TRON задерживается. Хеш разрешения: ${sent.hash}. Повторите оплату после подтверждения; повторное разрешение не потребуется.`,
      );
  }
  throw new Error(
    "Не удалось завершить разрешение TRON. Повторите проверку заказа.",
  );
}
