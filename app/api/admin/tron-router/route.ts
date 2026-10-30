import { z } from "zod";
import { decodeAbiParameters, getAddress } from "viem";
import { requireAdmin } from "@/lib/admin";
import { rateLimit } from "@/lib/auth";
import { sameOrigin, readJson, json, failure, HttpError } from "@/lib/http";
import { tronDeploymentConfig } from "@/lib/tron-deployment";
import {
  assertTronNetwork,
  tronClient,
  tronRead,
  tronRpc,
} from "@/lib/tron-rpc";
import { configuredRouter } from "@/lib/payment-routers";
import { tronToEvm, evmToTron, isTronAddress } from "@/lib/tron-address";
import { CHAIN_ENV, TESTNET } from "@/lib/network";
import { adminDb } from "@/lib/supabase/server";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireAdmin();
    await rateLimit(`tron-deploy:${user.id}`, 20);
    const input = z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("prepare"),
          address: z.string().refine(isTronAddress),
        }),
        z.object({
          action: z.literal("register"),
          hash: z.string().regex(/^[0-9a-fA-F]{64}$/),
        }),
      ])
      .parse(await readJson(request));
    if (TESTNET)
      throw new HttpError(
        409,
        "TRC20 USDT настроен для mainnet; для тестового развёртывания требуется отдельный тестовый токен",
      );
    await assertTronNetwork();
    const config = tronDeploymentConfig(),
      existing = await configuredRouter("tron");
    if (input.action === "prepare") {
      if (existing)
        throw new HttpError(409, "TRON-контракт уже зарегистрирован");
      const transaction =
        await tronClient().transactionBuilder.createSmartContract(
          {
            abi: JSON.stringify(config.abi),
            bytecode: config.bytecode.slice(2),
            rawParameter: config.data.slice(config.bytecode.length),
            feeLimit: 200_000_000,
            userFeePercentage: 100,
            originEnergyLimit: 1,
            name: "Sellmepls",
            callValue: 0,
          },
          input.address,
        );
      return json({
        transaction,
        platform: config.platform,
        signer: config.signer,
        data: config.data,
        feeLimitTrx: 200,
        environment: CHAIN_ENV,
      });
    }
    const [tx, receipt] = await Promise.all([
      tronRpc<{
        txID?: string;
        raw_data?: {
          contract: {
            type: string;
            parameter: {
              value: {
                new_contract: {
                  bytecode: string;
                  consume_user_resource_percent: number;
                  call_value?: number;
                };
              };
            };
          }[];
        };
      }>("walletsolidity/gettransactionbyid", {
        value: input.hash.toLowerCase(),
      }),
      tronRpc<{
        id?: string;
        contract_address?: string;
        receipt?: { result?: string };
        result?: string;
      }>("walletsolidity/gettransactioninfobyid", { value: input.hash }),
    ]);
    if (!receipt.id)
      throw new HttpError(
        409,
        "Дождитесь подтверждённого блока TRON и повторите сохранение",
      );
    if (
      receipt.id !== input.hash.toLowerCase() ||
      tx.txID !== input.hash.toLowerCase()
    )
      throw new HttpError(400, "Хеш развёртывания TRON не совпадает");
    const c = tx.raw_data?.contract;
    if (
      receipt.receipt?.result !== "SUCCESS" ||
      receipt.result ||
      !receipt.contract_address ||
      c?.length !== 1 ||
      c[0].type !== "CreateSmartContract" ||
      c[0].parameter.value.new_contract.bytecode.toLowerCase() !==
        config.data.slice(2).toLowerCase() ||
      c[0].parameter.value.new_contract.consume_user_resource_percent !== 100 ||
      c[0].parameter.value.new_contract.call_value
    )
      throw new HttpError(
        400,
        "Код, параметры или результат развёртывания TRON не совпадают",
      );
    const address = evmToTron(`0x${receipt.contract_address.slice(-40)}`);
    const [platform, signer] = await Promise.all([
      tronRead(address, "platform()"),
      tronRead(address, "quoteSigner()"),
    ]);
    if (
      getAddress(decodeAbiParameters([{ type: "address" }], platform)[0]) !==
        getAddress(tronToEvm(config.platform)) ||
      getAddress(decodeAbiParameters([{ type: "address" }], signer)[0]) !==
        getAddress(tronToEvm(config.signer))
    )
      throw new HttpError(400, "Получатели TRON-контракта не прошли проверку");
    if (existing && existing !== address)
      throw new HttpError(409, "Уже зарегистрирован другой контракт TRON");
    const saved = await adminDb()
      .from("payment_routers")
      .upsert(
        {
          network: "tron",
          chain_environment: CHAIN_ENV,
          address,
          tx_hash: input.hash.toLowerCase(),
          registered_by: user.id,
        },
        { onConflict: "network,chain_environment", ignoreDuplicates: true },
      );
    if (saved.error) throw saved.error;
    if ((await configuredRouter("tron")) !== address)
      throw new HttpError(409, "Другой контракт уже зарегистрирован");
    return json({ address });
  } catch (error) {
    return failure(error);
  }
}
