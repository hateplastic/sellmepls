import "server-only";
import { sessionDb, adminDb } from "@/lib/supabase/server";
import { HttpError } from "@/lib/http";
import { walletIdentity } from "@/lib/wallet-identity";
export async function requireUser() {
  const db = await sessionDb();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user)
    throw new HttpError(401, "Подключите и подпишите вход кошельком");
  const identity = walletIdentity(user);
  if (!identity) throw new HttpError(403, "Нужна подтверждённая Web3 identity");
  const { chain, address } = identity;
  const { error: profileError } = await adminDb()
    .from("users")
    .upsert(
      {
        id: user.id,
        ...(chain === "ethereum"
          ? { evm_wallet: address }
          : chain === "tron"
            ? { tron_wallet: address }
            : { solana_wallet: address }),
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (profileError) throw profileError;
  return { id: user.id, address, chain };
}
export async function rateLimit(key: string, limit: number, seconds = 60) {
  const { data, error } = await adminDb().rpc("consume_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_seconds: seconds,
  });
  if (error) throw error;
  if (!data)
    throw new HttpError(429, "Слишком много запросов. Попробуйте позже.");
}
