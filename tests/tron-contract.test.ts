import { beforeEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createVM, type VM } from "@ethereumjs/vm";
import { Common, Mainnet, Hardfork } from "@ethereumjs/common";
import {
  Account,
  createAddressFromString,
  hexToBytes,
  type Address,
} from "@ethereumjs/util";
import {
  encodeDeployData,
  encodeFunctionData,
  erc20Abi,
  zeroAddress,
  type Abi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { quoteDomain, quoteTypes } from "../lib/quote";
import { routerAbi } from "../lib/web3";
const artifact = JSON.parse(
  readFileSync("artifacts/TronPaymentRouterEvmModel.json", "utf8"),
) as { abi: Abi; evm: { bytecode: { object: string } } };
const tokenArtifact = JSON.parse(
  readFileSync("artifacts/PaymentToken.json", "utf8"),
) as typeof artifact;
const signer = privateKeyToAccount(`0x${"a1".repeat(32)}`),
  buyer = createAddressFromString(`0x${"11".repeat(20)}`),
  seller = createAddressFromString(`0x${"22".repeat(20)}`),
  platform = createAddressFromString(`0x${"33".repeat(20)}`),
  affiliate = createAddressFromString(`0x${"44".repeat(20)}`);
let vm: VM, router: Address, token: Address;
beforeEach(async () => {
  vm = await createVM({
    common: new Common({ chain: Mainnet, hardfork: Hardfork.Prague }),
  });
  await vm.stateManager.putAccount(buyer, new Account(0n, 10n ** 20n));
  async function deploy(data: Hex) {
    const r = await vm.evm.runCall({
      caller: buyer,
      data: hexToBytes(data),
      gasLimit: 10000000n,
    });
    expect(r.execResult.exceptionError).toBeUndefined();
    return r.createdAddress!;
  }
  token = await deploy(`0x${tokenArtifact.evm.bytecode.object}`);
  router = await deploy(
    encodeDeployData({
      abi: artifact.abi,
      bytecode: `0x${artifact.evm.bytecode.object}`,
      args: [platform.toString(), signer.address, [token.toString()]],
    }),
  );
  await call(
    token,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [router.toString() as Hex, 10000n],
    }),
  );
});
async function call(to: Address, data: Hex) {
  return vm.evm.runCall({
    caller: buyer,
    to,
    data: hexToBytes(data),
    gasLimit: 5000000n,
  });
}
async function balance(owner: Address) {
  const r = await call(
    token,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner.toString() as Hex],
    }),
  );
  return BigInt(`0x${Buffer.from(r.execResult.returnValue).toString("hex")}`);
}
async function pay({
  chain = 1,
  tamper = false,
  ref = false,
  expired = false,
} = {}) {
  const q = {
    orderId: `0x${"aa".repeat(32)}` as Hex,
    buyer: buyer.toString() as Hex,
    seller: seller.toString() as Hex,
    token: token.toString() as Hex,
    amount: 10000n,
    fee: 1000n,
    affiliate: ref ? (affiliate.toString() as Hex) : zeroAddress,
    affiliateAmount: ref ? 1000n : 0n,
    deadline: expired ? 0n : 2n ** 128n,
  };
  const sig = await signer.signTypedData({
    domain: quoteDomain(chain, router.toString() as Hex),
    types: quoteTypes,
    primaryType: "Quote",
    message: q,
  });
  if (tamper) q.fee++;
  return call(
    router,
    encodeFunctionData({ abi: routerAbi, functionName: "pay", args: [q, sig] }),
  );
}
// EVM model of the same Solidity source. TVM-specific opcodes require a separate TRON integration test.
it("TRON source EVM model splits token payment directly, including affiliate", async () => {
  expect((await pay({ ref: true })).execResult.exceptionError).toBeUndefined();
  expect(await balance(platform)).toBe(1000n);
  expect(await balance(seller)).toBe(8000n);
  expect(await balance(affiliate)).toBe(1000n);
  expect(await balance(router)).toBe(0n);
});
it("TRON source EVM model rejects replay and leaves balances unchanged", async () => {
  expect((await pay()).execResult.exceptionError).toBeUndefined();
  expect((await pay()).execResult.exceptionError).toBeDefined();
  expect(await balance(seller)).toBe(9000n);
});
it.each([{ chain: 2 }, { tamper: true }])(
  "TRON source EVM model rejects invalid signed quote %j",
  async (options) => {
    expect((await pay(options)).execResult.exceptionError).toBeDefined();
    expect(await balance(platform)).toBe(0n);
    expect(await balance(seller)).toBe(0n);
  },
);
