import "server-only";
import {
  PublicKey,
  VersionedTransaction,
  type Connection,
  type Transaction,
} from "@solana/web3.js";
import { formatUnits } from "viem";
import { ASSETS, saleParts, type Sale } from "@/lib/catalog";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@/lib/spl";

export type SolanaEstimate = {
  ready: boolean;
  issues: string[];
  asset: string;
  buyer: string;
  nativeBalance: string;
  tokenBalance: string | null;
  networkFee: string;
  accountRent: string;
  paymentSol: string;
  totalSolCost: string;
  minimumRemainingSol: string;
};
const sol = (lamports: bigint) => formatUnits(lamports, 9);
export async function inspectSolanaPayment(
  order: Sale,
  tx: Transaction,
  rpc: Connection,
): Promise<SolanaEstimate> {
  const asset = ASSETS[order.asset],
    native = asset.symbol === "SOL",
    parts = saleParts(order);
  const recipients = [
    { label: "продавца", address: order.seller_wallet, amount: parts.seller },
    { label: "платформы", address: order.platform_wallet, amount: parts.fee },
    ...(order.affiliate_wallet && parts.affiliate > 0n
      ? [
          {
            label: "партнёра",
            address: order.affiliate_wallet,
            amount: parts.affiliate,
          },
        ]
      : []),
  ];
  const buyer = new PublicKey(order.buyer_wallet);
  const mint = native ? null : new PublicKey(asset.address);
  const addresses = native
    ? [buyer, ...recipients.map((r) => new PublicKey(r.address))]
    : [
        buyer,
        getAssociatedTokenAddressSync(mint!, buyer),
        ...recipients.map((r) =>
          getAssociatedTokenAddressSync(mint!, new PublicKey(r.address)),
        ),
      ];
  const [accounts, fee, minimum, tokenRent] = await Promise.all([
    rpc.getMultipleAccountsInfo(addresses, "confirmed"),
    rpc.getFeeForMessage(tx.compileMessage(), "confirmed"),
    rpc.getMinimumBalanceForRentExemption(0, "confirmed"),
    native
      ? Promise.resolve(0)
      : rpc.getMinimumBalanceForRentExemption(165, "confirmed"),
  ]);
  const issues: string[] = [],
    balance = BigInt(accounts[0]?.lamports || 0),
    networkFee = BigInt(fee.value || 0);
  if (fee.value === null)
    issues.push(
      "Срок сетевого расчёта истёк. Нажмите «Проверить заказ» ещё раз.",
    );
  let rent = 0n,
    tokens: bigint | null = null;
  if (native) {
    for (let index = 0; index < recipients.length; index++) {
      const info = accounts[index + 1],
        recipient = recipients[index];
      const recipientMinimum = info?.data.length
        ? await rpc.getMinimumBalanceForRentExemption(
            info.data.length,
            "confirmed",
          )
        : minimum;
      const after = BigInt(info?.lamports || 0) + recipient.amount;
      if (after < BigInt(recipientMinimum))
        issues.push(
          `Кошелёк ${recipient.label} ${recipient.address} пока не может принять эту маленькую выплату: после неё будет ${sol(after)} SOL, минимум сети — ${sol(BigInt(recipientMinimum))} SOL. Получателю нужно предварительно пополнить свой адрес.`,
        );
    }
  } else {
    const source = accounts[1];
    tokens = 0n;
    if (source) {
      if (
        !source.owner.equals(TOKEN_PROGRAM_ID) ||
        source.data.length !== 165 ||
        !source.data.subarray(0, 32).equals(mint!.toBuffer()) ||
        !source.data.subarray(32, 64).equals(buyer.toBuffer())
      )
        issues.push(`Счёт ${asset.symbol} покупателя имеет неверный формат.`);
      else {
        tokens = source.data.readBigUInt64LE(64);
        if (source.data[108] !== 1)
          issues.push(
            `Счёт ${asset.symbol} покупателя заморожен или не активирован.`,
          );
      }
    }
    if (tokens < BigInt(order.amount))
      issues.push(
        `Вы выбрали ${asset.symbol} в Solana: нужно ${formatUnits(BigInt(order.amount), asset.decimals)} ${asset.symbol}, доступно ${formatUnits(tokens, asset.decimals)} ${asset.symbol}. Баланс SOL не заменяет ${asset.symbol}. Выберите SOL, если продавец принимает эту валюту.`,
      );
    for (let index = 0; index < recipients.length; index++)
      if (!accounts[index + 2]) rent += BigInt(tokenRent);
  }
  const payment = native ? BigInt(order.amount) : 0n,
    cost = payment + networkFee + rent,
    remaining = balance - cost;
  if (balance < cost)
    issues.unshift(
      `На кошельке покупателя ${order.buyer_wallet} доступно ${sol(balance)} SOL. Для этой операции нужно ${sol(cost)} SOL: ${sol(payment)} за товар, ${sol(networkFee)} комиссия сети, ${sol(rent)} создание счетов токена. Не хватает ${sol(cost - balance)} SOL.`,
    );
  else if (remaining > 0n && remaining < BigInt(minimum))
    issues.push(
      `После оплаты останется ${sol(remaining)} SOL — меньше минимального остатка сети ${sol(BigInt(minimum))} SOL. Добавьте хотя бы ${sol(BigInt(minimum) - remaining)} SOL или уменьшите сумму покупки.`,
    );
  if (!issues.length) {
    const simulation = await rpc.simulateTransaction(
      new VersionedTransaction(tx.compileMessage()),
      { sigVerify: false, commitment: "confirmed" },
    );
    if (simulation.value.err) {
      const error = simulation.value.err;
      if (typeof error === "object" && "InsufficientFundsForRent" in error)
        issues.push(
          "Сеть требует дополнительный остаток SOL на одном из счетов. Обновите проверку балансов и проверьте адреса получателей.",
        );
      else if (error === "BlockhashNotFound")
        issues.push("Сетевой расчёт устарел. Проверьте заказ ещё раз.");
      else
        issues.push(
          `Симуляция ${asset.symbol} в Solana отклонена сетью (${typeof error === "string" ? error : "ошибка инструкции"}). Деньги не отправлены. Проверьте состояние счетов и повторите проверку.`,
        );
    }
  }
  return {
    ready: issues.length === 0,
    issues,
    asset: asset.symbol,
    buyer: order.buyer_wallet,
    nativeBalance: sol(balance),
    tokenBalance: tokens === null ? null : formatUnits(tokens, asset.decimals),
    networkFee: sol(networkFee),
    accountRent: sol(rent),
    paymentSol: sol(payment),
    totalSolCost: sol(cost),
    minimumRemainingSol: sol(BigInt(minimum)),
  };
}
