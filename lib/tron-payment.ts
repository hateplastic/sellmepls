import "server-only";
import {
  encodeAbiParameters,
  formatUnits,
  erc20Abi,
  decodeFunctionData,
} from "viem";
import { ASSETS, type Sale } from "./catalog";
import {
  assertTronNetwork,
  tronClient,
  tronEnv,
  tronRead,
  tronRpc,
} from "./tron-rpc";
import { tronToEvm } from "./tron-address";
import {
  assertTronTransaction,
  tronCall,
  type TronStep,
} from "./tron-transaction";
import { HttpError } from "./http";
import { tronResourceBudget, type TronResources } from "./tron-resources";
export async function tronAllowance(order: Sale) {
  return BigInt(
    await tronRead(
      ASSETS[order.asset].address,
      "allowance(address,address)",
      encodeAbiParameters(
        [{ type: "address" }, { type: "address" }],
        [tronToEvm(order.buyer_wallet), tronToEvm(order.router!)],
      ).slice(2),
    ),
  );
}
export async function prepareTronStep(order: Sale) {
  await assertTronNetwork();
  const client = tronClient(),
    token = ASSETS[order.asset],
    allowance = await tronAllowance(order);
  const step: TronStep =
    allowance >= BigInt(order.amount)
      ? "pay"
      : allowance > 0n
        ? "reset"
        : "approve";
  const call = tronCall(order, step),
    owner = `41${tronToEvm(order.buyer_wallet).slice(2)}`;
  const [balance, account, parameters, resources] = await Promise.all([
    tronRead(
      token.address,
      "balanceOf(address)",
      encodeAbiParameters(
        [{ type: "address" }],
        [tronToEvm(order.buyer_wallet)],
      ).slice(2),
    ),
    tronRpc<{ balance?: number }>("wallet/getaccount", { address: owner }),
    tronRpc<{ chainParameter: { key: string; value?: number }[] }>(
      "wallet/getchainparameters",
    ),
    tronRpc<TronResources>("wallet/getaccountresource", { address: owner }),
  ]);
  if (BigInt(balance) < BigInt(order.amount))
    throw new HttpError(
      422,
      `Недостаточно ${token.symbol} в TRON: доступно ${formatUnits(BigInt(balance), token.decimals)}, нужно ${formatUnits(BigInt(order.amount), token.decimals)}. Баланс в другой сети сюда не переносится.`,
    );
  const selector =
    step === "pay"
      ? "pay((bytes32,address,address,address,uint256,uint256,address,uint256,uint256),bytes)"
      : "approve(address,uint256)";
  const simulation = await tronRpc<{
    result?: { result?: boolean };
    energy_used?: number;
  }>("wallet/triggerconstantcontract", {
    owner_address: owner,
    contract_address: `41${tronToEvm(call.target).slice(2)}`,
    function_selector: selector,
    parameter: call.data.slice(10),
  });
  if (!simulation.result?.result || !simulation.energy_used)
    throw new HttpError(
      422,
      "TRON отклонил симуляцию операции. Проверьте баланс, срок заказа и состояние токена.",
    );
  const price = parameters.chainParameter.find(
    (p) => p.key === "getEnergyFee",
  )?.value;
  const bandwidthPrice = parameters.chainParameter.find(
    (p) => p.key === "getTransactionFee",
  )?.value;
  if (!price || !bandwidthPrice)
    throw new Error("TRON resource prices unavailable");
  const energyLimit = Math.ceil(simulation.energy_used * 1.3),
    feeLimit = energyLimit * price;
  if (feeLimit > 1_000_000_000)
    throw new HttpError(
      422,
      "Расчётный лимит TRON превышает 1000 TRX. Повторите позже.",
    );
  const built = await client.transactionBuilder.triggerSmartContract(
    call.target,
    selector,
    { feeLimit, rawParameter: call.data.slice(10) },
    [],
    order.buyer_wallet,
  );
  if (!built.result.result)
    throw new Error("TRON transaction preparation failed");
  const tx = built.transaction;
  assertTronTransaction(order, step, tx);
  const maximum = tronResourceBudget(
    energyLimit,
    Math.ceil(tx.raw_data_hex.length / 2) + 128,
    price,
    bandwidthPrice,
    resources,
  );
  if (BigInt(account.balance || 0) < maximum)
    throw new HttpError(
      422,
      `Для покрытия этой операции с запасом нужно до ${formatUnits(maximum, 6)} TRX с учётом доступных ресурсов; доступно ${formatUnits(BigInt(account.balance || 0), 6)} TRX.`,
    );
  return {
    step,
    transaction: tx,
    estimate: {
      asset: token.symbol,
      tokenBalance: formatUnits(BigInt(balance), token.decimals),
      nativeBalance: formatUnits(BigInt(account.balance || 0), 6),
      feeLimit: formatUnits(BigInt(feeLimit), 6),
      maximumFee: formatUnits(maximum, 6),
      needsApproval: step !== "pay",
    },
  };
}
