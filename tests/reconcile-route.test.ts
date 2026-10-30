import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  cronEnv: () => ({
    CRON_SECRET: "test-cron-secret-with-at-least-32-characters",
  }),
}));
vi.mock("@/lib/reconcile", () => ({ reconcile: vi.fn() }));
import { reconcile } from "../lib/reconcile";
import { GET, POST } from "../app/api/reconcile/route";
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reconcile).mockResolvedValue({
    paid: 1,
    pending: 0,
    failed: 0,
    released: 0,
  });
});
describe("authenticated reconciliation scheduler", () => {
  for (const [method, handler] of [
    ["GET", GET],
    ["POST", POST],
  ] as const) {
    it(
      method + " rejects missing or incorrect secrets before touching orders",
      async () => {
        for (const token of [
          "",
          "Bearer invalid",
          "Bearer test-cron-secret-with-at-least-32-characterX",
        ]) {
          const response = await handler(
            new Request("https://example.com/api/reconcile", {
              method,
              headers: { authorization: token },
            }),
          );
          expect(response.status).toBe(401);
        }
        expect(reconcile).not.toHaveBeenCalled();
      },
    );
    it(
      method + " accepts the exact scheduler token and disables caching",
      async () => {
        const response = await handler(
          new Request("https://example.com/api/reconcile", {
            method,
            headers: {
              authorization:
                "Bearer test-cron-secret-with-at-least-32-characters",
            },
          }),
        );
        expect(response.status).toBe(200);
        expect((await response.json()).paid).toBe(1);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(reconcile).toHaveBeenCalledTimes(1);
      },
    );
  }
});
