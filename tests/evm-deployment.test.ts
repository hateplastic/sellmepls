import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  getChainId: vi.fn(),
  getTransaction: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getBlockNumber: vi.fn(),
  getCode: vi.fn(),
  readContract: vi.fn(),
  getBlock: vi.fn(),
  configured: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock("../lib/env", () => ({ serverEvmRpc: () => "https://rpc.invalid" }));
vi.mock("../lib/web3", () => ({
  routerAbi: [],
  evmClient: () => ({ ...m, chain: { id: 56 } }),
}));
vi.mock("../lib/payment-routers", () => ({ configuredRouter: m.configured }));
vi.mock("../lib/supabase/server", () => ({
  adminDb: () => ({ from: () => ({ upsert: m.upsert }) }),
}));
vi.mock("../lib/router-deployment", () => ({
  deploymentConfig: () => ({
    data: "0x1234",
    args: [
      `0x${"11".repeat(20)}`,
      `0x${"22".repeat(20)}`,
      [`0x${"33".repeat(20)}`],
    ],
  }),
}));
import { TransactionReceiptNotFoundError } from "viem";
import {
  verifyEvmDeployment,
  registerEvmDeployment,
} from "../lib/evm-deployment";
const hash = `0x${"ab".repeat(32)}` as const,
  blockHash = `0x${"cd".repeat(32)}` as const,
  address = `0x${"44".repeat(20)}` as const;
const receipt = () => ({
  status: "success",
  contractAddress: address,
  transactionHash: hash,
  blockNumber: 100n,
  blockHash,
  gasUsed: 1200000n,
  effectiveGasPrice: 50000000n,
});
beforeEach(() => {
  vi.clearAllMocks();
  m.getChainId.mockResolvedValue(56);
  m.getTransaction.mockResolvedValue({ hash, to: null, input: "0x1234" });
  m.getTransactionReceipt.mockResolvedValue(receipt());
  m.getBlockNumber.mockResolvedValue(102n);
  m.getCode.mockResolvedValue("0x1234");
  m.getBlock.mockResolvedValue({ hash: blockHash });
  m.readContract.mockImplementation(async ({ functionName }) =>
    functionName === "platform"
      ? `0x${"11".repeat(20)}`
      : functionName === "quoteSigner"
        ? `0x${"22".repeat(20)}`
        : true,
  );
  m.configured.mockResolvedValue(address);
  m.upsert.mockResolvedValue({ error: null });
});
it("verifies an already mined contract without another deployment", async () => {
  expect((await verifyEvmDeployment("bsc", hash)).address).toBe(address);
  expect(m.upsert).not.toHaveBeenCalled();
});
it("keeps an unmined transaction pending", async () => {
  m.getTransactionReceipt.mockRejectedValue(
    new TransactionReceiptNotFoundError({ hash }),
  );
  await expect(verifyEvmDeployment("bsc", hash)).rejects.toMatchObject({
    status: 202,
  });
});
it("waits for the second confirmation", async () => {
  m.getBlockNumber.mockResolvedValue(100n);
  await expect(verifyEvmDeployment("bsc", hash)).rejects.toMatchObject({
    status: 202,
  });
});
it("rejects deployment with altered constructor inputs", async () => {
  m.getTransaction.mockResolvedValue({ hash, to: null, input: "0xffff" });
  await expect(registerEvmDeployment("bsc", hash, null)).rejects.toMatchObject({
    status: 400,
  });
  expect(m.upsert).not.toHaveBeenCalled();
});
it("rejects a reverted deployment", async () => {
  m.getTransactionReceipt.mockResolvedValue({
    ...receipt(),
    status: "reverted",
  });
  await expect(verifyEvmDeployment("bsc", hash)).rejects.toMatchObject({
    status: 400,
  });
});
it("rejects a different chain", async () => {
  m.getChainId.mockResolvedValue(1);
  await expect(verifyEvmDeployment("bsc", hash)).rejects.toMatchObject({
    status: 503,
  });
});
it("rejects missing token permission", async () => {
  m.readContract.mockImplementation(async ({ functionName }) =>
    functionName === "platform"
      ? `0x${"11".repeat(20)}`
      : functionName === "quoteSigner"
        ? `0x${"22".repeat(20)}`
        : false,
  );
  await expect(verifyEvmDeployment("bsc", hash)).rejects.toMatchObject({
    status: 400,
  });
});
it("does not register a receipt on a replaced block", async () => {
  m.getBlock.mockResolvedValue({ hash: `0x${"ff".repeat(32)}` });
  await expect(registerEvmDeployment("bsc", hash, null)).rejects.toMatchObject({
    status: 202,
  });
  expect(m.upsert).not.toHaveBeenCalled();
});
it("never replaces another registered router", async () => {
  m.configured.mockResolvedValue(`0x${"55".repeat(20)}`);
  await expect(registerEvmDeployment("bsc", hash, null)).rejects.toMatchObject({
    status: 409,
  });
  expect(m.upsert).not.toHaveBeenCalled();
});
it("registers only the verified address idempotently", async () => {
  await expect(registerEvmDeployment("bsc", hash, null)).resolves.toMatchObject(
    { address, network: "bsc" },
  );
  expect(m.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ address, tx_hash: hash }),
    expect.objectContaining({ ignoreDuplicates: true }),
  );
});
