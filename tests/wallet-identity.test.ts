import { describe, expect, it } from "vitest";
import { walletIdentity } from "../lib/wallet-identity";

const ethereum = "0x7957680a67BD2c16E78413fBbC6c4710580a0071";
const solana = "AQ5QJxQXgQtmd6XDyAau5WntLuX98TrAL97TM8UAxaeU";
const user = (chain: string, address: string, provider = "web3") => ({
  identities: [
    {
      provider,
      identity_data: {
        sub: `web3:${chain}:${address}`,
        email_verified: false,
        phone_verified: false,
        custom_claims: {
          chain,
          address,
          domain: "localhost:3000",
          network: "",
        },
      },
    },
  ],
});

describe("Supabase verified Web3 identity", () => {
  it("reads the actual nested SIWE response", () => {
    expect(walletIdentity(user("ethereum", ethereum))).toEqual({
      chain: "ethereum",
      address: ethereum,
    });
  });
  it("reads the actual nested SIWS response", () => {
    expect(walletIdentity(user("solana", solana))).toEqual({
      chain: "solana",
      address: solana,
    });
  });
  it("does not trust user-editable metadata or another provider", () => {
    const forged = {
      identities: [],
      user_metadata: {
        custom_claims: { chain: "ethereum", address: ethereum },
      },
    };
    expect(walletIdentity(forged)).toBeNull();
    expect(walletIdentity(user("ethereum", ethereum, "email"))).toBeNull();
  });
  it("rejects missing, flat, malformed and unsupported identities", () => {
    expect(walletIdentity(null)).toBeNull();
    expect(
      walletIdentity({
        identities: [
          {
            provider: "web3",
            identity_data: { chain: "ethereum", address: ethereum },
          },
        ],
      }),
    ).toBeNull();
    expect(walletIdentity(user("bitcoin", ethereum))).toBeNull();
    expect(walletIdentity(user("ethereum", "invalid"))).toBeNull();
    expect(walletIdentity(user("solana", "invalid"))).toBeNull();
  });
});
