import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { checkDatabaseSchema } from "../lib/database-check";

function database(status: number, body: object) {
  return createClient("https://test.supabase.co", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (_url, init) =>
        new Response(init?.method === "HEAD" ? null : JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
    },
  });
}
describe("database readiness with real PostgREST client", () => {
  it("rejects missing tables even though HEAD 404 has no JSON error body", async () => {
    await expect(
      checkDatabaseSchema(
        database(404, { code: "PGRST205", message: "relation missing" }),
      ),
    ).rejects.toThrow(/products \(PGRST205\)/);
  });
  it("rejects an old schema missing affiliate fields", async () => {
    await expect(
      checkDatabaseSchema(
        database(400, { code: "42703", message: "column missing" }),
      ),
    ).rejects.toThrow(/sales \(42703\)/);
  });
  it("accepts a valid empty database", async () => {
    await expect(
      checkDatabaseSchema(database(200, [])),
    ).resolves.toBeUndefined();
  });
});
