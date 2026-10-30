import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(), rateLimit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ adminDb: vi.fn() }));
vi.mock("@/lib/env", () => ({
  appEnv: () => ({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }),
}));
import { requireUser, rateLimit } from "../lib/auth";
import { adminDb } from "../lib/supabase/server";
import { HttpError } from "../lib/http";
import { POST } from "../app/api/affiliate-links/route";

const userId = "11111111-1111-4111-8111-111111111111";
const sellerId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
function builder(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error: null }),
    single: vi.fn().mockResolvedValue({ data, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
}
let products: ReturnType<typeof builder>, links: ReturnType<typeof builder>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue({
    id: userId,
    chain: "ethereum",
    address: "0x1111111111111111111111111111111111111111",
  });
  vi.mocked(rateLimit).mockResolvedValue(undefined);
  products = builder([{ prices: [{ asset: "base:USDC", amount: "1" }] }]);
  links = builder({ code: "existing-link" });
  const profile = builder({
    evm_wallet: "0x1111111111111111111111111111111111111111",
    solana_wallet: null,
  });
  vi.mocked(adminDb).mockReturnValue({
    from: (table: string) =>
      table === "products" ? products : table === "users" ? profile : links,
  } as unknown as ReturnType<typeof adminDb>);
});
function request() {
  return POST(
    new Request("http://localhost:3000/api/affiliate-links", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sellerId, productId, campaign: "Основная" }),
    }),
  );
}
describe("quick affiliate link retrieval", () => {
  it("reuses the same personal link without consuming the creation quota", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect((await response.json()).url).toBe(
      "http://localhost:3000/r/existing-link",
    );
    expect(links.eq).toHaveBeenCalledWith("user_id", userId);
    expect(links.eq).toHaveBeenCalledWith("product_id", productId);
    expect(links.insert).not.toHaveBeenCalled();
    expect(rateLimit).not.toHaveBeenCalledWith(`affiliate:${userId}`, 20, 3600);
  });
  it("creates a link bound to the authenticated partner with the creation quota", async () => {
    links.maybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await request();
    expect(response.status).toBe(200);
    expect(rateLimit).toHaveBeenCalledWith(`affiliate:${userId}`, 20, 3600);
    expect(links.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: userId,
        seller_id: sellerId,
        product_id: productId,
        campaign: "Основная",
      }),
    );
  });
  it("requires authentication", async () => {
    vi.mocked(requireUser).mockRejectedValue(
      new HttpError(401, "Войдите кошельком"),
    );
    expect((await request()).status).toBe(401);
    expect(links.insert).not.toHaveBeenCalled();
  });
  it("does not issue links for disabled products", async () => {
    products.limit.mockResolvedValue({ data: [], error: null });
    expect((await request()).status).toBe(400);
    expect(products.eq).toHaveBeenCalledWith("affiliate_enabled", true);
    expect(products.eq).toHaveBeenCalledWith("is_hidden", false);
    expect(links.insert).not.toHaveBeenCalled();
  });
});
