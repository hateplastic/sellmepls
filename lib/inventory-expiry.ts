import "server-only";
import { PublicKey } from "@solana/web3.js";
import { encodeAbiParameters, keccak256, getAddress } from "viem";
import { adminDb } from "@/lib/supabase/server";
import { settlementEnv, serverEvmRpc } from "@/lib/env";
import { tronToEvm } from "./tron-address";
import { assertTronNetwork, tronRead, tronRpc } from "./tron-rpc";
import {
  evmClient,
  routerAbi,
  solanaConnection,
  SOLANA_GENESIS,
} from "@/lib/web3";
import { orderReference, type Sale } from "@/lib/catalog";
import { settle } from "@/lib/settlement";
import { InvalidPayment } from "@/lib/verify";
import { CHAIN_ENV } from "@/lib/network";

// A timer alone cannot establish that a wallet did not broadcast a payment.
// Release only after chain finality and a complete, bounded history check.
export async function inventoryCanExpire(order: Sale): Promise<boolean> {
  if (
    order.status !== "pending" ||
    order.reservation_released_at ||
    Date.parse(order.expires_at) > Date.now()
  )
    return false;
  if (!order.payment_started_at) return true;
  const env = settlementEnv();
  if (order.network === "tron") {
    if (!order.router) return false;
    await assertTronNetwork();
    const block = await tronRpc<{
      block_header: { raw_data: { timestamp: number } };
    }>("walletsolidity/getnowblock");
    if (block.block_header.raw_data.timestamp <= Date.parse(order.expires_at))
      return false;
    const key = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "bytes32" }],
        [tronToEvm(order.buyer_wallet), orderReference(order.id)],
      ),
    );
    return (
      BigInt(
        await tronRead(order.router, "paid(bytes32)", key.slice(2), true),
      ) === 0n
    );
  }
  if (order.network !== "solana") {
    if (!order.router) return false;
    const client = evmClient(order.network, serverEvmRpc(order.network));
    if ((await client.getChainId()) !== client.chain.id)
      throw new Error("RPC chain mismatch");
    const block = await client.getBlock({ blockTag: "finalized" });
    if (block.timestamp * 1000n <= BigInt(Date.parse(order.expires_at)))
      return false;
    const paymentKey = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "bytes32" }],
        [order.buyer_wallet as `0x${string}`, orderReference(order.id)],
      ),
    );
    const paid = await client.readContract({
      address: getAddress(order.router),
      abi: routerAbi,
      functionName: "paid",
      args: [paymentKey],
      blockNumber: block.number,
    });
    // A paid quote is never released, including when the browser lost its hash.
    // The buyer can recover that hash from their wallet and submit it for delivery.
    return !paid;
  }
  if (!order.solana_last_valid_height || !order.solana_first_slot) return false;
  const connection = solanaConnection(env.SOLANA_RPC_URL);
  if ((await connection.getGenesisHash()) !== SOLANA_GENESIS)
    throw new Error("RPC chain mismatch");
  const height = await connection.getBlockHeight("finalized");
  if (height <= order.solana_last_valid_height) return false;
  if ((await connection.getFirstAvailableBlock()) > order.solana_first_slot)
    return false;
  const slot = await connection.getSlot("finalized");
  const signatures = await connection.getSignaturesForAddress(
    new PublicKey(order.buyer_wallet),
    { limit: 101, minContextSlot: slot },
    "finalized",
  );
  let inspected = 0;
  for (const signature of signatures) {
    if (signature.slot < order.solana_first_slot) return true;
    if (++inspected > 100) return false;
    if (signature.err) continue;
    try {
      await settle(order, signature.signature);
      return false;
    } catch (error) {
      if (!(error instanceof InvalidPayment)) throw error;
    }
  }
  return signatures.length < 101;
}

export async function expireInventory() {
  const db = adminDb();
  const { data, error } = await db
    .from("sales")
    .select("*")
    .eq("delivery_mode", "stock")
    .eq("status", "pending")
    .eq("chain_environment", CHAIN_ENV)
    .is("reservation_released_at", null)
    .lt("expires_at", new Date(Date.now() - 30_000).toISOString())
    .or(
      `inventory_checked_at.is.null,inventory_checked_at.lt.${new Date(Date.now() - 60_000).toISOString()}`,
    )
    .order("inventory_checked_at", { ascending: true, nullsFirst: true })
    .limit(5);
  if (error) throw error;
  let released = 0;
  for (const sale of data as Sale[]) {
    try {
      if (await inventoryCanExpire(sale)) {
        const result = await db.rpc("release_inventory", {
          p_id: sale.id,
          p_expected_started: sale.payment_started_at,
          p_expected_height: sale.solana_last_valid_height,
        });
        if (result.error) throw result.error;
        if (result.data) released++;
      }
    } catch {
      console.error("Inventory reservation check deferred", sale.id);
    }
    const updated = await db
      .from("sales")
      .update({ inventory_checked_at: new Date().toISOString() })
      .eq("id", sale.id)
      .eq("status", "pending");
    if (updated.error) throw updated.error;
  }
  return released;
}
