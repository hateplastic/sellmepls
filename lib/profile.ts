import { getAddress, isAddress, zeroAddress } from "viem";
import { PublicKey } from "@solana/web3.js";
import { HttpError } from "./http";
import { isTronAddress } from "./tron-address";
export function payoutWallets(evm: string, solana: string, tron = "") {
  if (tron && !isTronAddress(tron)) throw new HttpError(400, "Неверный TRON адрес");
  if (evm && (!isAddress(evm) || evm.toLowerCase() === zeroAddress))
    throw new HttpError(400, "Неверный EVM адрес");
  if (solana) {
    try {
      if (!PublicKey.isOnCurve(new PublicKey(solana).toBytes()))
        throw new Error();
    } catch {
      throw new HttpError(400, "Неверный Solana адрес");
    }
  }
  return {
    tron_wallet: tron || null,
    evm_wallet: evm ? getAddress(evm) : null,
    solana_wallet: solana ? new PublicKey(solana).toBase58() : null,
  };
}
