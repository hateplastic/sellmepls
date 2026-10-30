import { zeroAddress, type Address } from "viem";
import { ASSETS, orderReference, type Sale } from "./catalog";
import { tronToEvm } from "./tron-address";
export const quoteTypes = {
  Quote: [
    { name: "orderId", type: "bytes32" },
    { name: "buyer", type: "address" },
    { name: "seller", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "fee", type: "uint256" },
    { name: "affiliate", type: "address" },
    { name: "affiliateAmount", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
export function quoteMessage(sale: Sale) {
  const address = (value: string) =>
    sale.network === "tron" ? tronToEvm(value) : (value as Address);
  return {
    orderId: orderReference(sale.id),
    buyer: address(sale.buyer_wallet),
    seller: address(sale.seller_wallet),
    token: address(ASSETS[sale.asset].address),
    amount: BigInt(sale.amount),
    fee: BigInt(sale.fee),
    affiliate: sale.affiliate_wallet
      ? address(sale.affiliate_wallet)
      : zeroAddress,
    affiliateAmount: BigInt(sale.affiliate_amount),
    deadline: BigInt(Math.floor(Date.parse(sale.expires_at) / 1000)),
  };
}
export const quoteDomain = (chainId: number, router: Address) => ({
  name: "Sellmepls",
  version: "2",
  chainId,
  verifyingContract: router,
});
