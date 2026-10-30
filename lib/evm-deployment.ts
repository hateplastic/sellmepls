import "server-only";
import {
  getAddress,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Hex,
} from "viem";
import { HttpError } from "./http";
import { evmClient, routerAbi } from "./web3";
import { serverEvmRpc } from "./env";
import { deploymentConfig } from "./router-deployment";
import { configuredRouter } from "./payment-routers";
import { CHAIN_ENV, type EvmNetwork } from "./network";
import { adminDb } from "./supabase/server";
export async function verifyEvmDeployment(network: EvmNetwork, hash: Hex) {
  const client = evmClient(network, serverEvmRpc(network));
  if ((await client.getChainId()) !== client.chain.id)
    throw new HttpError(503, "RPC подключён к другой сети");
  let observed;
  try {
    observed = await Promise.all([
      client.getTransaction({ hash }),
      client.getTransactionReceipt({ hash }),
      client.getBlockNumber({ cacheTime: 0 }),
    ]);
  } catch (error) {
    if (
      error instanceof TransactionNotFoundError ||
      error instanceof TransactionReceiptNotFoundError
    )
      throw new HttpError(202, "Ожидаем включение транзакции в блок");
    throw error;
  }
  const [tx, receipt, head] = observed;
  if (
    receipt.status !== "success" ||
    !receipt.contractAddress ||
    tx.to !== null ||
    tx.hash.toLowerCase() !== hash.toLowerCase() ||
    receipt.transactionHash.toLowerCase() !== hash.toLowerCase()
  )
    throw new HttpError(400, "Это не успешная транзакция создания контракта");
  if (head - receipt.blockNumber + 1n < 2n)
    throw new HttpError(202, "Ожидаем два подтверждения транзакции");
  const config = deploymentConfig(network);
  if (tx.input.toLowerCase() !== config.data.toLowerCase())
    throw new HttpError(
      400,
      "Код контракта или адреса выплат не совпадают с конфигурацией платформы",
    );
  const address = getAddress(receipt.contractAddress);
  const [code, platform, signer, block, tokens] = await Promise.all([
    client.getCode({ address }),
    client.readContract({ address, abi: routerAbi, functionName: "platform" }),
    client.readContract({
      address,
      abi: routerAbi,
      functionName: "quoteSigner",
    }),
    client.getBlock({ blockNumber: receipt.blockNumber }),
    Promise.all(
      config.args[2].map((token) =>
        client.readContract({
          address,
          abi: routerAbi,
          functionName: "allowedToken",
          args: [token],
        }),
      ),
    ),
  ]);
  if (
    !code ||
    code === "0x" ||
    getAddress(platform) !== config.args[0] ||
    getAddress(signer) !== config.args[1] ||
    tokens.some((allowed) => !allowed)
  )
    throw new HttpError(400, "Развёрнутый контракт не прошёл проверку");
  if (block.hash !== receipt.blockHash)
    throw new HttpError(
      202,
      "Блок изменился. Повторяем проверку подтверждений",
    );
  return {
    address,
    network,
    environment: CHAIN_ENV,
    hash,
    platform,
    gasUsed: receipt.gasUsed,
    effectiveGasPrice: receipt.effectiveGasPrice,
  };
}
export async function registerEvmDeployment(
  network: EvmNetwork,
  hash: Hex,
  registeredBy: string | null,
) {
  const verified = await verifyEvmDeployment(network, hash);
  const existing = await configuredRouter(network);
  if (existing && getAddress(existing) !== verified.address)
    throw new HttpError(
      409,
      "В этой сети уже настроен другой платёжный контракт",
    );
  const saved = await adminDb()
    .from("payment_routers")
    .upsert(
      {
        network,
        chain_environment: CHAIN_ENV,
        address: verified.address,
        tx_hash: hash.toLowerCase(),
        registered_by: registeredBy,
      },
      { onConflict: "network,chain_environment", ignoreDuplicates: true },
    );
  if (saved.error) throw saved.error;
  const registered = await configuredRouter(network);
  if (!registered || getAddress(registered) !== verified.address)
    throw new HttpError(409, "Другой контракт уже зарегистрирован");
  return { address: verified.address, network, environment: CHAIN_ENV };
}
