import "server-only";
import { erc20Abi, formatUnits, getAddress, zeroAddress } from "viem";
import { ASSETS, type Sale } from "./catalog";
import { isEvmNetwork } from "./network";
import { evmClient, routerAbi } from "./web3";
import { serverEvmRpc } from "./env";
import { quoteMessage } from "./quote";
export type EvmEstimate = {
  ready: boolean;
  issues: string[];
  step: "pay" | "approve" | "reset";
  nativeSymbol: string;
  nativeBalance: string;
  tokenBalance: string | null;
  maximumFee: string | null;
  tokenSymbol: string;
};
export async function inspectEvmPayment(order: Sale) {
  if (!isEvmNetwork(order.network) || !order.router || !order.quote_signature)
    throw new Error("Invalid EVM order");
  const client = evmClient(order.network, serverEvmRpc(order.network)),
    asset = ASSETS[order.asset],
    buyer = getAddress(order.buyer_wallet),
    router = getAddress(order.router),
    token = getAddress(asset.address);
  if ((await client.getChainId()) !== client.chain.id)
    throw new Error("EVM network mismatch");
  const native = token === zeroAddress;
  const [balance, tokenBalance, allowance] = await Promise.all([
    client.getBalance({ address: buyer }),
    native
      ? Promise.resolve(null)
      : client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [buyer],
        }),
    native
      ? Promise.resolve(BigInt(order.amount))
      : client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [buyer, router],
        }),
  ]);
  const step =
    allowance >= BigInt(order.amount)
      ? "pay"
      : allowance > 0n
        ? "reset"
        : "approve";
  const issues: string[] = [];
  if (tokenBalance !== null && tokenBalance < BigInt(order.amount))
    issues.push(
      `Недостаточно ${asset.symbol} в ${client.chain.name}: доступно ${formatUnits(tokenBalance, asset.decimals)}, нужно ${formatUnits(BigInt(order.amount), asset.decimals)}.`,
    );
  let maximumFee: string | null = null;
  if (!issues.length) {
    try {
      const gas =
        step === "pay"
          ? await client.estimateContractGas({
              account: buyer,
              address: router,
              abi: routerAbi,
              functionName: "pay",
              args: [quoteMessage(order), order.quote_signature],
              value: native ? BigInt(order.amount) : 0n,
            })
          : await client.estimateContractGas({
              account: buyer,
              address: token,
              abi: erc20Abi,
              functionName: "approve",
              args: [router, step === "reset" ? 0n : BigInt(order.amount)],
            });
      const fees = await client.estimateFeesPerGas();
      const price = fees.maxFeePerGas ?? (await client.getGasPrice());
      const budget = ((gas * 120n + 99n) / 100n) * price;
      maximumFee = formatUnits(budget, 18);
      if (balance < budget + (native ? BigInt(order.amount) : 0n))
        issues.push(
          `Недостаточно ${client.chain.nativeCurrency.symbol} на сумму покупки и сетевые расходы текущей операции.`,
        );
    } catch {
      issues.push(
        "Сеть отклонила предварительный расчёт. Проверьте баланс выбранного токена и монеты для комиссии, затем повторите.",
      );
    }
  }
  return {
    ready: !issues.length,
    issues,
    step,
    nativeSymbol: client.chain.nativeCurrency.symbol,
    nativeBalance: formatUnits(balance, 18),
    tokenBalance:
      tokenBalance === null ? null : formatUnits(tokenBalance, asset.decimals),
    maximumFee,
    tokenSymbol: asset.symbol,
  } satisfies EvmEstimate;
}
