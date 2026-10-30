import { createHmac, timingSafeEqual } from "node:crypto";
export const REFERRAL_TTL = 30 * 24 * 60 * 60;
export type Attribution = { code: string; target: string; at: number };
export function signValue(value: unknown, secret: string) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
export function readValue(token: string | undefined, secret: string): unknown {
  if (!token || token.length > 3800) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const actual = Buffer.from(signature, "base64url"),
    expected = createHmac("sha256", secret).update(payload).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
}
export function readAttributions(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): Attribution[] {
  const data = readValue(token, secret);
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (v): v is Attribution =>
        v &&
        typeof v.code === "string" &&
        /^[A-Za-z0-9_-]{16,32}$/.test(v.code) &&
        typeof v.target === "string" &&
        /^(p|s):[a-f0-9-]{36}$/.test(v.target) &&
        Number.isSafeInteger(v.at) &&
        v.at <= now &&
        now - v.at < REFERRAL_TTL * 1000,
    )
    .slice(-10);
}
export function selectAttribution(
  values: Attribution[],
  product: string,
  seller: string,
) {
  return values
    .filter((v) => v.target === `p:${product}` || v.target === `s:${seller}`)
    .sort((a, b) => b.at - a.at)[0];
}
