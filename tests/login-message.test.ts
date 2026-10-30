import { describe, expect, it } from "vitest";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  ethereumLoginMessage,
  solanaLoginMessage,
  LOGIN_STATEMENT,
} from "@/lib/login-message";

describe("wallet login message interoperability", () => {
  it("generates ASCII SIWE with matching domain including localhost port", () => {
    const address = privateKeyToAccount(generatePrivateKey()).address;
    const message = ethereumLoginMessage(
      address,
      84532,
      "http://localhost:3000",
    );
    expect(message).toMatch(/^[\x20-\x7e\n]+$/);
    const parsed = parseSiweMessage(message);
    expect(parsed).toMatchObject({
      domain: "localhost:3000",
      uri: "http://localhost:3000",
      chainId: 84532,
      statement: LOGIN_STATEMENT,
      version: "1",
    });
    expect(
      validateSiweMessage({
        message: parsed,
        address,
        domain: "localhost:3000",
      }),
    ).toBe(true);
    expect(parsed.nonce).toMatch(/^[a-zA-Z0-9]{32}$/);
    expect(message).not.toBe(
      ethereumLoginMessage(address, 84532, "http://localhost:3000"),
    );
  });
  it("uses canonical SIWS field order and UTF-8 bytes without localized statement", () => {
    const message = solanaLoginMessage(
      "AQ5QJxQXgQtmd6XDyAau5WntLuX98TrAL97TM8UAxaeU",
      "http://localhost:3000",
    );
    expect(message).toMatch(
      /^localhost:3000 wants you to sign in with your Solana account:\n[A-Za-z0-9]+\n\n[^\n]+\n\nURI: http:\/\/localhost:3000\nVersion: 1\nNonce: [A-Za-z0-9]{32}\nIssued At: /,
    );
    expect(message).toMatch(/^[\x20-\x7e\n]+$/);
  });
  it("rejects invalid EVM chain parameters before invoking the wallet", () => {
    const address = privateKeyToAccount(generatePrivateKey()).address;
    expect(() =>
      ethereumLoginMessage(address, NaN, "http://localhost:3000"),
    ).toThrow();
    expect(() =>
      ethereumLoginMessage(address, 0, "http://localhost:3000"),
    ).toThrow();
  });
});
