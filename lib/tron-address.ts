import bs58 from "bs58";
import { bytesToHex, hexToBytes, sha256, type Address } from "viem";

export function tronToEvm(value: string): Address {
  const bytes = bs58.decode(value);
  if (bytes.length !== 25 || bytes[0] !== 0x41)
    throw new Error("Invalid TRON address");
  const digest = hexToBytes(sha256(sha256(bytesToHex(bytes.slice(0, 21)))));
  if (!bytes.slice(21).every((b, i) => b === digest[i]))
    throw new Error("Invalid TRON checksum");
  return bytesToHex(bytes.slice(1, 21));
}
export function evmToTron(value: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error("Invalid address");
  const payload = hexToBytes(`0x41${value.slice(2)}`);
  const checksum = hexToBytes(sha256(sha256(bytesToHex(payload)))).slice(0, 4);
  return bs58.encode(new Uint8Array([...payload, ...checksum]));
}
export function isTronAddress(value: string) {
  try {
    return tronToEvm(value) !== "0x0000000000000000000000000000000000000000";
  } catch {
    return false;
  }
}
