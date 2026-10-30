import { describe, it, expect } from "vitest";
import { youtubeVideoId } from "../lib/media";
import { participantError } from "../lib/payment-participants";
describe("YouTube URLs", () => {
  it.each([
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42",
    "https://youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ])("accepts official video URL %s", (url) =>
    expect(youtubeVideoId(url)).toBe("dQw4w9WgXcQ"),
  );
  it.each([
    "javascript:alert(1)",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://youtube.com@evil.test/watch?v=dQw4w9WgXcQ",
    "http://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://localhost/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=bad",
    "https://youtube.com:8443/watch?v=dQw4w9WgXcQ",
  ])("rejects untrusted or malformed URL %s", (url) =>
    expect(() => youtubeVideoId(url)).toThrow(),
  );
  it("allows clearing a video", () => expect(youtubeVideoId(" ")).toBeNull());
});
describe("Payment participants", () => {
  const input = {
    buyer: "0xBuyer",
    seller: "0xSeller",
    platform: "0xPlatform",
    solana: false,
    ownProduct: false,
  };
  it("accepts distinct addresses on the same device/IP", () =>
    expect(participantError(input)).toBeNull());
  it("identifies seller/platform collision regardless of buyer", () =>
    expect(participantError({ ...input, seller: "0xPLATFORM" })).toMatch(
      /В профиле продавца/,
    ));
  it("identifies platform buyer", () =>
    expect(participantError({ ...input, buyer: "0xPLATFORM" })).toMatch(
      /кошельком платформы/,
    ));
  it("identifies self purchase by identity even with another payout", () =>
    expect(participantError({ ...input, ownProduct: true })).toMatch(
      /аккаунтом продавца/,
    ));
  it("identifies self purchase by case-insensitive EVM address", () =>
    expect(participantError({ ...input, buyer: "0xSELLER" })).toMatch(
      /аккаунтом продавца/,
    ));
  it("keeps Solana addresses case sensitive", () =>
    expect(
      participantError({
        ...input,
        buyer: "Seller",
        seller: "seller",
        solana: true,
      }),
    ).toBeNull());
});
