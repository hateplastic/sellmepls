import "server-only";
import { isAddress } from "viem";
import { PublicKey } from "@solana/web3.js";
import { requireUser } from "@/lib/auth";
import { HttpError } from "@/lib/http";

export function isAdmin(user: { chain: string; address: string }) {
  // Only the verified login identity grants access. Editable payout addresses
  // and user_metadata never confer administrative permissions.
  if (user.chain === "ethereum")
    return (process.env.ADMIN_EVM_WALLETS || "")
      .split(",")
      .map((s) => s.trim())
      .some(
        (address) =>
          isAddress(address) &&
          address.toLowerCase() === user.address.toLowerCase(),
      );
  if (user.chain === "solana")
    return (process.env.ADMIN_SOLANA_WALLETS || "")
      .split(",")
      .map((s) => s.trim())
      .some((address) => {
        try {
          return (
            PublicKey.isOnCurve(new PublicKey(address).toBytes()) &&
            address === user.address
          );
        } catch {
          return false;
        }
      });
  return false;
}
export async function requireAdmin() {
  const user = await requireUser();
  if (!isAdmin(user))
    throw new HttpError(403, "Этот кошелёк не имеет доступа к админке");
  return user;
}
