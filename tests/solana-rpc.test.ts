import { afterEach, expect, it, vi } from "vitest";
import { solanaConnection, SolanaRpcHttpError } from "../lib/web3";

afterEach(() => vi.unstubAllGlobals());
it.each([401, 403, 429, 503])(
  "preserves RPC HTTP %i without exposing credentials or response text",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("private provider diagnostics", { status }),
        ),
    );
    const rpc = solanaConnection(
      "https://rpc.example.com/?api-key=private-key",
    );
    const error = await rpc
      .getLatestBlockhashAndContext()
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(SolanaRpcHttpError);
    expect(error).toMatchObject({
      status,
      message: `Solana RPC HTTP ${status}`,
    });
    expect(String(error)).not.toMatch(/private|api-key/);
    const sendError = await rpc.sendRawTransaction(Buffer.from([0])).catch((reason: unknown) => reason);
    expect(sendError).toBeInstanceOf(SolanaRpcHttpError);
    expect(sendError).toMatchObject({ status });
    const wrappedError = await rpc.getLatestBlockhash().catch((reason: unknown) => reason);
    expect(String(wrappedError)).not.toMatch(/private|api-key/);
  },
);
