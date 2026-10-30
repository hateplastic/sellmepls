import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import { ASSETS, saleParts, type Sale } from "./catalog";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "./spl";
export function buildSolanaTransaction(order: Sale, blockhash: string) {
  if (order.network !== "solana") throw new Error("Not a Solana order");
  const asset = ASSETS[order.asset],
    parts = saleParts(order),
    buyer = new PublicKey(order.buyer_wallet);
  const tx = new Transaction({ feePayer: buyer, recentBlockhash: blockhash });
  const recipients = [
    { wallet: order.seller_wallet, amount: parts.seller },
    { wallet: order.platform_wallet, amount: parts.fee },
    ...(order.affiliate_wallet && parts.affiliate > 0n
      ? [{ wallet: order.affiliate_wallet, amount: parts.affiliate }]
      : []),
  ];
  for (const recipient of recipients) {
    const target = new PublicKey(recipient.wallet);
    if (asset.symbol === "SOL")
      tx.add(
        SystemProgram.transfer({
          fromPubkey: buyer,
          toPubkey: target,
          lamports: recipient.amount,
        }),
      );
    else {
      const mint = new PublicKey(asset.address),
        ata = getAssociatedTokenAddressSync(mint, target);
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          buyer,
          ata,
          target,
          mint,
        ),
        createTransferCheckedInstruction(
          getAssociatedTokenAddressSync(mint, buyer),
          mint,
          ata,
          buyer,
          recipient.amount,
          asset.decimals,
        ),
      );
    }
  }
  tx.add(
    new TransactionInstruction({
      programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      keys: [{ pubkey: buyer, isSigner: true, isWritable: false }],
      data: Buffer.from(`sellmepls:${order.id}`),
    }),
  );
  return tx;
}
