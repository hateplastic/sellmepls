import "server-only";
import { settlementEnv, serverEvmRpc } from "@/lib/env";
import { adminDb } from "@/lib/supabase/server";
import { verifyPayment } from "@/lib/verify";
import type { Sale } from "@/lib/catalog";
export async function settle(order: Sale, hash: string) {
  const e = settlementEnv();
  const result = await verifyPayment(order, hash, {
    rpc:
      order.network === "solana"
        ? e.SOLANA_RPC_URL
        : order.network === "tron"
          ? "tron"
          : serverEvmRpc(order.network),
    confirmations: e.EVM_CONFIRMATIONS,
    solanaCommitment: e.SOLANA_COMMITMENT,
  });
  const { data, error } = await adminDb().rpc("complete_sale", {
    p_id: order.id,
    p_hash: hash,
    p_block: result.block,
    p_paid_at: result.paidAt,
  });
  if (error) throw error;
  return data as Sale;
}
