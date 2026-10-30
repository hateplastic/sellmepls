import "server-only";
import { adminDb } from "@/lib/supabase/server";
import { settle } from "@/lib/settlement";
import { InvalidPayment, PaymentPending } from "@/lib/verify";
import type { Sale } from "@/lib/catalog";
import { CHAIN_ENV } from "@/lib/network";
import { expireInventory } from "@/lib/inventory-expiry";
export async function reconcile() {
  const db = adminDb();
  const released = await expireInventory();
  const { data, error } = await db
    .from("sales")
    .select("*")
    .eq("status", "pending")
    .eq("chain_environment", CHAIN_ENV)
    .is("reservation_released_at", null)
    .not("tx_hash", "is", null)
    .or(
      `checked_at.is.null,checked_at.lt.${new Date(Date.now() - 15_000).toISOString()}`,
    )
    .order("checked_at", { ascending: true, nullsFirst: true })
    .limit(10);
  if (error) throw error;
  let paid = 0,
    pending = 0,
    failed = 0;
  async function check(sale: Sale) {
    try {
      await settle(sale, sale.tx_hash!);
      paid++;
    } catch (error) {
      const invalid = error instanceof InvalidPayment;
      if (error instanceof PaymentPending) pending++;
      else failed++;
      const { error: writeError } = await db
        .from("sales")
        .update({
          checked_at: new Date().toISOString(),
          verification_error: invalid ? error.message : null,
          ...(invalid ? { tx_hash: null } : {}),
        })
        .eq("id", sale.id)
        .eq("status", "pending")
        .eq("tx_hash", sale.tx_hash);
      if (writeError) throw writeError;
    }
  }
  const orders = data as Sale[];
  for (let i = 0; i < orders.length; i += 5)
    await Promise.all(orders.slice(i, i + 5).map(check));
  const { error: cleanupError } = await db
    .from("rate_limits")
    .delete()
    .lt("expires_at", new Date(Date.now() - 86_400_000).toISOString());
  if (cleanupError) throw cleanupError;
  return { paid, pending, failed, released };
}
