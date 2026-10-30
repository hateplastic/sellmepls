import "server-only";
import { paymentRouter } from "./env";
import { adminDb } from "./supabase/server";
import {
  CHAIN_ENV,
  EVM_NETWORKS,
  isNetworkOffered,
  type EvmNetwork,
  type PaymentAvailability,
} from "./network";
import { isTronAddress } from "./tron-address";
export async function configuredRouter(network: EvmNetwork | "tron") {
  const explicit =
    network === "tron"
      ? process.env.TRON_PAYMENT_ROUTER
      : paymentRouter(network);
  if (network === "tron" && explicit && !isTronAddress(explicit))
    throw new Error("Invalid TRON_PAYMENT_ROUTER");
  if (explicit) return explicit;
  const { data, error } = await adminDb()
    .from("payment_routers")
    .select("address")
    .eq("network", network)
    .eq("chain_environment", CHAIN_ENV)
    .maybeSingle();
  if (error) throw error;
  return (data?.address as string | undefined) || null;
}
export async function paymentAvailability(): Promise<PaymentAvailability> {
  const routers = await Promise.all(
    EVM_NETWORKS.map((network) =>
      isNetworkOffered(network) ? configuredRouter(network) : null,
    ),
  );
  return {
    base: Boolean(routers[0]),
    arbitrum: Boolean(routers[1]),
    ethereum: Boolean(routers[2]),
    bsc: Boolean(routers[3]),
    tron: false,
    solana: Boolean(
      process.env.PLATFORM_SOLANA_WALLET && process.env.SOLANA_RPC_URL,
    ),
  };
}
