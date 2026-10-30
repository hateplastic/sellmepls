import { createSiweMessage } from "viem/siwe";
import type { Address } from "viem";

// SIWE/SIWS statements use the ASCII URI grammar. Strict wallets reject
// localized Unicode statements even when more permissive wallets sign them.
export const LOGIN_STATEMENT =
  "Sign in to Sellmepls. This signature does not transfer funds.";
export function loginFields(origin: string) {
  const url = new URL(origin);
  return {
    domain: url.host,
    uri: url.origin,
    version: "1" as const,
    nonce: crypto.randomUUID().replaceAll("-", ""),
    issuedAt: new Date().toISOString(),
    statement: LOGIN_STATEMENT,
  };
}
export function ethereumLoginMessage(
  address: Address,
  chainId: number,
  origin: string,
) {
  if (!Number.isSafeInteger(chainId) || chainId <= 0)
    throw new Error("Кошелёк вернул неверную сеть. Переподключите его.");
  const fields = loginFields(origin);
  return createSiweMessage({
    ...fields,
    address,
    chainId,
    issuedAt: new Date(fields.issuedAt),
  });
}
export function solanaLoginMessage(address: string, origin: string) {
  const f = loginFields(origin);
  return `${f.domain} wants you to sign in with your Solana account:\n${address}\n\n${f.statement}\n\nURI: ${f.uri}\nVersion: 1\nNonce: ${f.nonce}\nIssued At: ${f.issuedAt}`;
}
