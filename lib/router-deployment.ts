import "server-only";
import { encodeDeployData, getAddress, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import artifact from "@/artifacts/PaymentRouter.json";
import { paymentEnv } from "./env";
import { ASSETS, isAssetEnabled } from "./catalog";
import type { EvmNetwork } from "./network";
export function deploymentConfig(network: EvmNetwork) {
  const e = paymentEnv();
  const abi = artifact.abi as Abi,
    bytecode = `0x${artifact.evm.bytecode.object}` as Hex;
  const args = [
    getAddress(e.PLATFORM_EVM_WALLET),
    privateKeyToAccount(e.QUOTE_SIGNER_PRIVATE_KEY as Hex).address,
    Object.entries(ASSETS)
      .filter(
        ([id, a]) =>
          isAssetEnabled(id) && a.network === network && a.symbol !== "ETH",
      )
      .map(([, a]) => getAddress(a.address)),
  ] as const;
  return {
    abi,
    bytecode,
    args,
    data: encodeDeployData({ abi, bytecode, args }),
  };
}
