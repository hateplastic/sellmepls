import "server-only";
import { encodeDeployData, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import artifact from "@/artifacts/TronPaymentRouter.json";
import { paymentEnv } from "./env";
import { ASSETS } from "./catalog";
import { tronToEvm, evmToTron } from "./tron-address";
import { tronEnv } from "./tron-rpc";
export function tronDeploymentConfig() {
  const platform = tronEnv().platform,
    signer = privateKeyToAccount(
      paymentEnv().QUOTE_SIGNER_PRIVATE_KEY as Hex,
    ).address;
  const abi = artifact.abi as Abi,
    bytecode = `0x${artifact.evm.bytecode.object}` as Hex;
  const args = [
    tronToEvm(platform),
    signer,
    [tronToEvm(ASSETS["tron:USDT"].address)],
  ] as const;
  return {
    abi,
    bytecode,
    args,
    data: encodeDeployData({ abi, bytecode, args }),
    platform,
    signer: evmToTron(signer),
  };
}
