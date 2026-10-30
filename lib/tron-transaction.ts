import { encodeFunctionData, erc20Abi, zeroAddress } from "viem";
import type { TronWeb } from "tronweb";
import { ASSETS, type Sale } from "./catalog";
import { quoteMessage } from "./quote";
import { routerAbi } from "./web3";
import { tronToEvm } from "./tron-address";
export type TronTransaction = Awaited<
  ReturnType<TronWeb["transactionBuilder"]["triggerSmartContract"]>
>["transaction"];
export type TronSignedTransaction = TronTransaction & { signature: string[] };
export type TronStep = "reset" | "approve" | "pay";
export function tronCall(order: Sale, step: TronStep) {
  if (order.network !== "tron" || !order.router || !order.quote_signature)
    throw new Error("Invalid TRON order");
  if (step === "pay")
    return {
      target: order.router,
      data: encodeFunctionData({
        abi: routerAbi,
        functionName: "pay",
        args: [quoteMessage(order), order.quote_signature],
      }),
    };
  return {
    target: ASSETS[order.asset].address,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [
        tronToEvm(order.router),
        step === "reset" ? 0n : BigInt(order.amount),
      ],
    }),
  };
}
export function assertTronTransaction(
  order: Sale,
  step: TronStep,
  transaction: TronTransaction,
) {
  const call = tronCall(order, step),
    contract = transaction.raw_data?.contract;
  if (
    contract?.length !== 1 ||
    contract[0].type !== "TriggerSmartContract" ||
    contract[0].Permission_id
  )
    throw new Error("Unexpected TRON instruction");
  const value = contract[0].parameter.value,
    hex = (s: string) => `41${tronToEvm(s).slice(2)}`.toLowerCase();
  if (
    value.owner_address.toLowerCase() !== hex(order.buyer_wallet) ||
    value.contract_address.toLowerCase() !== hex(call.target) ||
    value.data?.toLowerCase() !== call.data.slice(2).toLowerCase() ||
    value.call_value ||
    value.call_token_value ||
    value.token_id
  )
    throw new Error("TRON payment changed");
  if (
    !Number.isSafeInteger(transaction.raw_data.fee_limit) ||
    transaction.raw_data.fee_limit! <= 0 ||
    transaction.raw_data.fee_limit! > 1_000_000_000 ||
    transaction.raw_data.data ||
    transaction.raw_data.expiration <= Date.now()
  )
    throw new Error("Invalid TRON fee or expiration");
  if (tronToEvm(order.buyer_wallet) === zeroAddress)
    throw new Error("Invalid buyer");
}
