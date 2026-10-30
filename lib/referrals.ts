import "server-only";
import { cookies } from "next/headers";
import { referralEnv } from "./env";
import { adminDb } from "./supabase/server";
import { readAttributions, selectAttribution } from "./referral-token";
export async function referralFor(product: string, seller: string) {
  const cookie = (await cookies()).get("sellmepls_ref")?.value;
  const ref = selectAttribution(
    readAttributions(cookie, referralEnv().REFERRAL_SECRET),
    product,
    seller,
  );
  if (!ref) return null;
  const { data, error } = await adminDb()
    .from("affiliate_links")
    .select("*")
    .eq("code", ref.code)
    .eq("seller_id", seller)
    .maybeSingle();
  if (error) throw error;
  if (!data || (data.product_id && data.product_id !== product)) return null;
  return data as {
    id: string;
    code: string;
    user_id: string;
    product_id: string | null;
    seller_id: string;
  };
}
