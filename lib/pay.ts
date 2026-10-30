"use client";
import {
  createWalletClient,
  custom,
  erc20Abi,
  getAddress,
  zeroAddress,
  type EIP1193Provider,
  type Address,
} from "viem";
import { Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import bs58 from "bs58";
import { ASSETS, type Sale } from "@/lib/catalog";
import { quoteMessage } from "@/lib/quote";
import { CHAIN_ENV } from "@/lib/network";
import { chains, evmClient, routerAbi } from "@/lib/web3";
import { connectSolana } from "@/lib/solana-wallet";
import { api } from "@/lib/wallet";
import { buildSolanaTransaction } from "@/lib/solana-transaction";
import type { SolanaEstimate } from "@/lib/solana-preflight";
export async function payOrder(
  order: Sale,
  provider: EIP1193Provider | null,
  onHash: (hash: string) => void,
  onStatus: (status: string) => void,
) {
  if (order.chain_environment !== CHAIN_ENV)
    throw new Error("Неверное окружение сети для заказа");
  if (Date.parse(order.expires_at) <= Date.now() + 15_000)
    throw new Error("Срок заказа истёк. Создайте новый заказ.");
  const asset = ASSETS[order.asset],
    amount = BigInt(order.amount);
  if (order.network === "tron") {
    const { payTron } = await import("./pay-tron");
    return payTron(order, onHash, onStatus);
  }
  if (order.network === "solana") {
    const wallet = await connectSolana(undefined, order.buyer_wallet);
    onStatus("Проверяем баланс и симулируем платёж в Solana");
    const prepared = await api<{
      transaction: string;
      ticket: string;
      estimate: SolanaEstimate;
    }>("/api/solana/transaction", { action: "prepare", orderId: order.id });
    if (!prepared.estimate.ready)
      throw new Error(prepared.estimate.issues.join("\n"));
    const tx = Transaction.from(Buffer.from(prepared.transaction, "base64"));
    if (
      !tx
        .serializeMessage()
        .equals(
          buildSolanaTransaction(order, tx.recentBlockhash!).serializeMessage(),
        )
    )
      throw new Error(
        "Сервер вернул платёж с другими суммами или получателями",
      );
    onStatus(`Подтвердите платёж в ${wallet.name}`);
    const signed = await wallet.signTransaction(tx);
    if (!signed.signature) throw new Error("Кошелёк не подписал транзакцию");
    const hash = bs58.encode(signed.signature);
    onStatus("Отправляем подписанный платёж через сервер");
    const result = await api<{ signature: string }>("/api/solana/transaction", {
      action: "send",
      orderId: order.id,
      transaction: signed.serialize().toString("base64"),
      ticket: prepared.ticket,
    });
    if (result.signature !== hash)
      throw new Error("Хеш транзакции не совпадает");
    onHash(hash);
    return;
  }
  if (!provider || !order.router) throw new Error("Подключите EVM кошелёк");
  const chain = chains[order.network],
    wallet = createWalletClient({ chain, transport: custom(provider) }),
    publicClient = evmClient(order.network);
  const [buyer] = await wallet.getAddresses();
  if (!buyer || getAddress(buyer) !== getAddress(order.buyer_wallet))
    throw new Error("Выберите кошелёк, которым выполнен вход.");
  onStatus(`Переключаем сеть на ${chain.name}`);
  try {
    await wallet.switchChain({ id: chain.id });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === 4902 || error.code === -32603)
    ) {
      await wallet.addChain({ chain });
      await wallet.switchChain({ id: chain.id });
    } else throw error;
  }
  const token = getAddress(asset.address),
    router = getAddress(order.router);
  if (token !== zeroAddress) {
    const allowance = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [buyer, router],
    });
    if (allowance < amount) {
      if (allowance > 0n) {
        onStatus("Сбросьте предыдущее разрешение токена");
        const reset = await wallet.writeContract({
          account: buyer,
          address: token,
          abi: erc20Abi,
          functionName: "approve",
          args: [router, 0n],
        });
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: reset,
        });
        if (receipt.status !== "success")
          throw new Error("Не удалось сбросить разрешение");
      }
      onStatus("Разрешите расход только суммы заказа");
      const approval = await wallet.writeContract({
        account: buyer,
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [router, amount],
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: approval,
      });
      if (receipt.status !== "success")
        throw new Error("Разрешение токена отклонено");
    }
  }
  onStatus("Подтвердите оплату в кошельке");
  if (!order.quote_signature)
    throw new Error("В заказе отсутствует подпись цены");
  const { request } = await publicClient.simulateContract({
    account: buyer,
    address: router,
    abi: routerAbi,
    functionName: "pay",
    args: [quoteMessage(order), order.quote_signature],
    value: token === zeroAddress ? amount : 0n,
  });
  const hash = await wallet.writeContract(request);
  onHash(hash);
}
