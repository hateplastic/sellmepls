import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  appEnv,
  databaseEnv,
  storageEnv,
  paymentRouter,
  env,
} from "../lib/env";

afterEach(() => vi.unstubAllEnvs());
describe("independent service configuration", () => {
  it("auth and storage work before EVM contracts are deployed", () => {
    vi.stubEnv("BASE_PAYMENT_ROUTER", "");
    vi.stubEnv("ARBITRUM_PAYMENT_ROUTER", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "private-test-key");
    vi.stubEnv("S3_REGION", "auto");
    vi.stubEnv("S3_BUCKET", "private-test");
    vi.stubEnv("S3_ACCESS_KEY_ID", "test-id");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret");
    expect(databaseEnv().NEXT_PUBLIC_SUPABASE_URL).toBe(
      "https://example.supabase.co",
    );
    expect(storageEnv().S3_BUCKET).toBe("private-test");
    expect(paymentRouter("base")).toBeNull();
    expect(paymentRouter("arbitrum")).toBeNull();
    expect(() => env()).toThrow(/BASE_PAYMENT_ROUTER/);
  });
  it("validates only the selected EVM router and rejects malformed addresses", () => {
    vi.stubEnv("BASE_PAYMENT_ROUTER", "0x" + "12".repeat(20));
    vi.stubEnv("ARBITRUM_PAYMENT_ROUTER", "invalid");
    expect(paymentRouter("base")).toBe("0x" + "12".repeat(20));
    expect(() => paymentRouter("arbitrum")).toThrow(/ARBITRUM_PAYMENT_ROUTER/);
  });
  it("requires HTTPS for production and never includes secret values in errors", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(() => appEnv()).toThrow(/HTTPS/);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "secret");
    expect(() => databaseEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    try {
      databaseEnv();
    } catch (error) {
      expect(String(error)).not.toContain("secret");
    }
  });
});
