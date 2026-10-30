import { afterEach, expect, it, vi } from "vitest";
vi.mock("../lib/network", async (original) => ({
  ...(await original<typeof import("../lib/network")>()),
  TESTNET: false,
}));
import { evmClient } from "../lib/web3";
afterEach(() => vi.unstubAllGlobals());
it("recovers a receipt when the primary RPC restricts archive access", async () => {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init),
        body = await request.json();
      urls.push(request.url);
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          ...(urls.length === 1
            ? {
                error: {
                  code: -32602,
                  message: "Archive requests require a personal token",
                },
              }
            : { result: { status: "0x1" } }),
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  const result = await evmClient("bsc", "https://primary.invalid").request({
    method: "eth_getTransactionReceipt",
    params: [`0x${"ab".repeat(32)}`],
  });
  expect(result?.status).toBe("0x1");
  expect(urls).toEqual([
    "https://primary.invalid/",
    "https://bsc-dataseed.bnbchain.org/",
  ]);
});
it("does not disguise an actual contract revert as an RPC outage", async () => {
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init),
        body = await request.json();
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: 3, message: "execution reverted" },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    },
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    evmClient("bsc", "https://primary.invalid").request({
      method: "eth_call",
      params: [{ to: `0x${"11".repeat(20)}`, data: "0x" }, "latest"],
    }),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
