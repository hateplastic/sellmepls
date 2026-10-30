import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
import { requireUser } from "@/lib/auth";
import { isAdmin, requireAdmin } from "@/lib/admin";
const address = "0x7957680a67BD2c16E78413fBbC6c4710580a0071";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
describe("admin wallet authorization", () => {
  it("denies everyone with an empty allowlist, including platform wallet", () => {
    vi.stubEnv("ADMIN_EVM_WALLETS", "");
    vi.stubEnv("ADMIN_SOLANA_WALLETS", "");
    vi.stubEnv("PLATFORM_EVM_WALLET", address);
    expect(isAdmin({ chain: "ethereum", address })).toBe(false);
  });
  it("accepts exact verified identity, handles EVM casing and rejects unsupported chains", () => {
    vi.stubEnv("ADMIN_EVM_WALLETS", address);
    expect(isAdmin({ chain: "ethereum", address: address.toLowerCase() })).toBe(
      true,
    );
    expect(isAdmin({ chain: "solana", address })).toBe(false);
    expect(isAdmin({ chain: "other", address })).toBe(false);
  });
  it("cannot be escalated through payout wallet or user metadata", async () => {
    vi.stubEnv("ADMIN_EVM_WALLETS", address);
    vi.mocked(requireUser).mockResolvedValue({
      id: crypto.randomUUID(),
      address: "0x0000000000000000000000000000000000000001",
      chain: "ethereum",
      evm_wallet: address,
      user_metadata: { role: "admin" },
    } as Awaited<ReturnType<typeof requireUser>>);
    await expect(requireAdmin()).rejects.toThrow("не имеет доступа");
  });
});
