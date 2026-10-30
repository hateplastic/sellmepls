import "server-only";
import { randomBytes } from "node:crypto";
import { Trx } from "tronweb";
import { adminDb } from "./supabase/server";
import { HttpError } from "./http";
export async function verifyTronSignature(
  message: string,
  signature: string,
  address: string,
) {
  try {
    if ((await Trx.verifyMessageV2(message, signature)) !== address)
      throw new Error();
  } catch {
    throw new HttpError(403, "Подпись TRON не совпадает с адресом");
  }
}
export async function tronLoginEmail(address: string) {
  const db = adminDb();
  const existing = await db
    .from("tron_identities")
    .select("login_email,user_id")
    .eq("address", address)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.login_email as string;
  // A random private alias prevents pre-registering a wallet's email/password account.
  const email = `${randomBytes(32).toString("hex")}@wallet.invalid`;
  const created = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { wallet_provider: "tron", wallet_address: address },
  });
  if (created.error || !created.data.user)
    throw created.error || new Error("Wallet account creation failed");
  const id = created.data.user.id;
  const saved = await db
    .from("tron_identities")
    .insert({ address, user_id: id, login_email: email });
  if (!saved.error) return email;
  await db.auth.admin.deleteUser(id);
  if (saved.error.code !== "23505") throw saved.error;
  const winner = await db
    .from("tron_identities")
    .select("login_email")
    .eq("address", address)
    .single();
  if (winner.error) throw winner.error;
  return winner.data.login_email as string;
}
