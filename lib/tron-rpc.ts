import "server-only";
import { TronWeb } from "tronweb";
import { RPC_DEFAULTS, TESTNET } from "./network";
import { isTronAddress, tronToEvm } from "./tron-address";
export const TRON_CHAIN_ID = TESTNET ? 3448148188 : 728126428;
export function tronEnv() {
  const url = process.env.TRON_RPC_URL || RPC_DEFAULTS.tron;
  if (new URL(url).protocol !== "https:")
    throw new Error("TRON_RPC_URL requires HTTPS");
  const platform = process.env.PLATFORM_TRON_WALLET || "";
  if (!isTronAddress(platform))
    throw new Error("Configure PLATFORM_TRON_WALLET");
  return { url, platform, apiKey: process.env.TRON_API_KEY || "" };
}
export function tronClient() {
  const e = tronEnv();
  return new TronWeb({
    fullHost: e.url,
    headers: e.apiKey ? { "TRON-PRO-API-KEY": e.apiKey } : {},
  });
}
export async function tronRpc<T>(
  method: string,
  body: unknown = {},
): Promise<T> {
  const e = tronEnv();
  const response = await fetch(`${e.url.replace(/\/$/, "")}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(e.apiKey ? { "TRON-PRO-API-KEY": e.apiKey } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`TRON RPC unavailable (HTTP ${response.status})`);
  return response.json();
}
export async function assertTronNetwork() {
  const block = await tronRpc<{ blockID?: string }>("wallet/getblockbynum", {
    num: 0,
  });
  if (!block.blockID || parseInt(block.blockID.slice(-8), 16) !== TRON_CHAIN_ID)
    throw new Error("TRON RPC network mismatch");
}
export async function tronRead(
  address: string,
  selector: string,
  parameter = "",
  solid = false,
) {
  const result = await tronRpc<{
    result?: { result?: boolean };
    constant_result?: string[];
  }>(`${solid ? "walletsolidity" : "wallet"}/triggerconstantcontract`, {
    owner_address: `41${tronToEvm(tronEnv().platform).slice(2)}`,
    contract_address: `41${tronToEvm(address).slice(2)}`,
    function_selector: selector,
    parameter,
  });
  if (!result.result?.result || !result.constant_result?.[0])
    throw new Error("TRON contract read failed");
  return `0x${result.constant_result[0]}` as const;
}
