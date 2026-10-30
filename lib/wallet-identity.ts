import { getAddress, isAddress } from "viem";
import { PublicKey } from "@solana/web3.js";
import { isTronAddress } from "./tron-address";
import type { WalletFamily } from "./network";

type IdentityUser = {
  app_metadata?: Record<string, unknown>;
  identities?: { provider: string; identity_data?: Record<string, unknown> }[];
};

// Call this with a user returned by auth.getUser() on the server. Supabase puts
// verified SIWE/SIWS claims in identity_data.custom_claims, not user_metadata.
export function walletIdentity(user: IdentityUser | null): {
  chain: WalletFamily;
  address: string;
} | null {
  const metadata = user?.app_metadata;
  if (
    metadata?.wallet_provider === "tron" &&
    typeof metadata.wallet_address === "string" &&
    isTronAddress(metadata.wallet_address)
  )
    return { chain: "tron", address: metadata.wallet_address };
  const claims = user?.identities?.find(
    (identity) => identity.provider === "web3",
  )?.identity_data?.custom_claims;
  if (!claims || typeof claims !== "object" || Array.isArray(claims))
    return null;
  const { chain, address } = claims as Record<string, unknown>;
  if (typeof address !== "string") return null;
  try {
    if (chain === "ethereum" && isAddress(address))
      return { chain, address: getAddress(address) };
    if (chain === "solana") {
      const key = new PublicKey(address);
      if (PublicKey.isOnCurve(key.toBytes()))
        return { chain, address: key.toBase58() };
    }
  } catch {
    return null;
  }
  return null;
}
