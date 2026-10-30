import "server-only";
import { decodeEventLog, getAddress, zeroAddress } from "viem";
import { ASSETS, orderReference, type Sale } from "./catalog";
import { assertTronNetwork, tronRpc } from "./tron-rpc";
import { tronToEvm } from "./tron-address";
import { routerAbi } from "./web3";
import { InvalidPayment, PaymentPending } from "./verify";
type TronReceipt = {
  id?: string;
  blockNumber?: number;
  blockTimeStamp?: number;
  receipt?: { result?: string };
  result?: string;
  log?: { address: string; topics: string[]; data: string }[];
};
type TronChainTx = {
  txID?: string;
  ret?: { contractRet?: string }[];
  raw_data?: {
    contract: {
      type: string;
      parameter: { value: { owner_address: string; contract_address: string } };
    }[];
  };
};
export function verifyTronReceipt(
  order: Sale,
  hash: string,
  receipt: TronReceipt,
  tx: TronChainTx,
) {
  const demand = (value: unknown, message: string) => {
    if (!value) throw new InvalidPayment(message);
  };
  demand(receipt.id === hash && tx.txID === hash, "Не совпадает хеш TRON");
  demand(
    receipt.receipt?.result === "SUCCESS" &&
      tx.ret?.[0]?.contractRet === "SUCCESS" &&
      !receipt.result,
    "Транзакция TRON завершилась ошибкой",
  );
  const c = tx.raw_data?.contract;
  demand(
    c?.length === 1 && c[0].type === "TriggerSmartContract",
    "Не найден вызов платёжного контракта",
  );
  const toHex = (v: string) => `41${tronToEvm(v).slice(2)}`.toLowerCase();
  demand(
    c![0].parameter.value.owner_address.toLowerCase() ===
      toHex(order.buyer_wallet) &&
      c![0].parameter.value.contract_address.toLowerCase() ===
        toHex(order.router!),
    "Неверный плательщик или контракт TRON",
  );
  demand(
    receipt.blockTimeStamp &&
      receipt.blockTimeStamp >= Date.parse(order.created_at) - 30000 &&
      receipt.blockTimeStamp <= Date.parse(order.expires_at),
    "Платёж вне срока заказа",
  );
  const logs = (receipt.log || []).filter(
    (l) =>
      l.address.toLowerCase() ===
      tronToEvm(order.router!).slice(2).toLowerCase(),
  );
  const events = logs.flatMap((l) => {
    try {
      return [
        decodeEventLog({
          abi: routerAbi,
          eventName: "Paid",
          data: `0x${l.data}`,
          topics: l.topics.map((t) => `0x${t}`) as [
            `0x${string}`,
            ...`0x${string}`[],
          ],
        }),
      ];
    } catch {
      return [];
    }
  });
  demand(events.length === 1, "Платёжное событие TRON не найдено");
  const e = events[0].args;
  demand(
    e.orderId === orderReference(order.id) &&
      getAddress(e.buyer) === getAddress(tronToEvm(order.buyer_wallet)) &&
      getAddress(e.seller) === getAddress(tronToEvm(order.seller_wallet)) &&
      getAddress(e.token) ===
        getAddress(tronToEvm(ASSETS[order.asset].address)),
    "Событие TRON не соответствует заказу",
  );
  demand(
    e.amount === BigInt(order.amount) &&
      e.fee === BigInt(order.fee) &&
      e.affiliateAmount === BigInt(order.affiliate_amount) &&
      getAddress(e.affiliate) ===
        getAddress(
          order.affiliate_wallet
            ? tronToEvm(order.affiliate_wallet)
            : zeroAddress,
        ),
    "Неверная сумма или комиссия TRON",
  );
  demand(Number.isSafeInteger(receipt.blockNumber), "Отсутствует блок TRON");
  return {
    block: String(receipt.blockNumber),
    paidAt: new Date(receipt.blockTimeStamp!).toISOString(),
  };
}
export async function verifyTronPayment(order: Sale, hash: string) {
  await assertTronNetwork();
  const [receipt, tx] = await Promise.all([
    tronRpc<TronReceipt>("walletsolidity/gettransactioninfobyid", {
      value: hash,
    }),
    tronRpc<TronChainTx>("walletsolidity/gettransactionbyid", { value: hash }),
  ]);
  if (!receipt.id || !tx.txID)
    throw new PaymentPending("Ожидаем подтверждённый блок TRON");
  return verifyTronReceipt(order, hash, receipt, tx);
}
