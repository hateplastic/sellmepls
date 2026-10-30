import { beforeEach, describe, expect, it } from "vitest";
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
  parseAbi,
  zeroAddress,
  type Abi,
  type Hex,
} from "viem";
import { routerAbi } from "../lib/web3";
import { orderReference } from "../lib/catalog";
import { privateKeyToAccount } from "viem/accounts";
import { quoteDomain, quoteTypes } from "../lib/quote";
const signer = privateKeyToAccount(`0x${"a1".repeat(32)}`);
const artifact = JSON.parse(
  readFileSync("artifacts/PaymentRouter.json", "utf8"),
) as { abi: Abi; evm: { bytecode: { object: string } } };
const payer = createAddressFromString(`0x${"11".repeat(20)}`),
  seller = createAddressFromString(`0x${"22".repeat(20)}`),
  platform = createAddressFromString(`0x${"33".repeat(20)}`),
  attacker = createAddressFromString(`0x${"44".repeat(20)}`);
const tokenArtifact = JSON.parse(
  readFileSync("artifacts/PaymentToken.json", "utf8"),
) as typeof artifact;
let vm: VM, router: Address, tokenAddress: Address;
const reference = orderReference("11111111-1111-4111-8111-111111111111");
beforeEach(async () => {
  vm = await createVM({
    common: new Common({ chain: Mainnet, hardfork: Hardfork.Prague }),
  });
  for (const owner of [payer, attacker])
    await vm.stateManager.putAccount(owner, new Account(0n, 10n ** 20n));
  const tokenDeployment = await vm.evm.runCall({
    caller: payer,
    data: hexToBytes(`0x${tokenArtifact.evm.bytecode.object}`),
    gasLimit: 5_000_000n,
  });
  expect(tokenDeployment.execResult.exceptionError).toBeUndefined();
  tokenAddress = tokenDeployment.createdAddress!;
  const bytecode = encodeDeployData({
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
    args: [platform.toString(), signer.address, [tokenAddress.toString()]],
  });
  const deployment = await vm.evm.runCall({
    caller: payer,
    data: hexToBytes(bytecode),
    gasLimit: 5_000_000n,
  });
  expect(deployment.execResult.exceptionError).toBeUndefined();
  router = deployment.createdAddress!;
});
async function pay({
  amount = 10000n,
  value = 10000n,
  recipient = seller,
  caller = payer,
  token = zeroAddress as Hex,
  deadline = 2n ** 128n,
  fee = 600n,
  affiliate = zeroAddress as Hex,
  affiliateAmount = 0n,
  tamperFee = false,
  signatureChain = 1,
  signedBuyer = payer,
} = {}) {
  const quote = {
    orderId: reference,
    buyer: signedBuyer.toString() as Hex,
    seller: recipient.toString() as Hex,
    token,
    amount,
    fee,
    affiliate,
    affiliateAmount,
    deadline,
  };
  const signature = await signer.signTypedData({
    domain: quoteDomain(signatureChain, router.toString() as Hex),
    types: quoteTypes,
    primaryType: "Quote",
    message: quote,
  });
  if (tamperFee) quote.fee++;
  const data = encodeFunctionData({
    abi: routerAbi,
    functionName: "pay",
    args: [quote, signature],
  });
  return vm.evm.runCall({
    caller,
    to: router,
    data: hexToBytes(data),
    value,
    gasLimit: 1_000_000n,
  });
}
async function balance(address: Address) {
  return (await vm.stateManager.getAccount(address))?.balance || 0n;
}
describe("compiled PaymentRouter on local EVM", () => {
  it("supports a signed 10% micro fee with no fixed component", async () => {
    const result = await pay({ fee: 1000n });
    expect(result.execResult.exceptionError).toBeUndefined();
    expect(await balance(platform)).toBe(1000n);
    expect(await balance(seller)).toBe(9000n);
    expect(await balance(router)).toBe(0n);
  });
  async function tokenBalance(address: Address) {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address.toString() as Hex],
    });
    const result = await vm.evm.runCall({
      caller: payer,
      to: tokenAddress,
      data: hexToBytes(data),
      gasLimit: 100000n,
    });
    return BigInt(
      `0x${Buffer.from(result.execResult.returnValue).toString("hex")}`,
    );
  }
  async function approve() {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [router.toString() as Hex, 10000n],
    });
    await vm.evm.runCall({
      caller: payer,
      to: tokenAddress,
      data: hexToBytes(data),
      gasLimit: 100000n,
    });
  }
  it("splits an allowed ERC-20 with no token custody", async () => {
    await approve();
    const result = await pay({
      token: tokenAddress.toString() as Hex,
      value: 0n,
    });
    expect(result.execResult.exceptionError).toBeUndefined();
    expect(await tokenBalance(seller)).toBe(9400n);
    expect(await tokenBalance(platform)).toBe(600n);
    expect(await tokenBalance(router)).toBe(0n);
  });
  it("rolls back both ERC-20 legs when the platform transfer fails", async () => {
    await approve();
    const data = encodeFunctionData({
      abi: parseAbi(["function setBlocked(address)"]),
      functionName: "setBlocked",
      args: [platform.toString() as Hex],
    });
    await vm.evm.runCall({
      caller: payer,
      to: tokenAddress,
      data: hexToBytes(data),
      gasLimit: 100000n,
    });
    const result = await pay({
      token: tokenAddress.toString() as Hex,
      value: 0n,
    });
    expect(result.execResult.exceptionError).toBeDefined();
    expect(await tokenBalance(seller)).toBe(0n);
    expect(await tokenBalance(payer)).toBe(1000000000n);
  });
  it("transfers the signed fee atomically and retains no funds", async () => {
    const result = await pay();
    expect(result.execResult.exceptionError).toBeUndefined();
    expect(await balance(seller)).toBe(9400n);
    expect(await balance(platform)).toBe(600n);
    expect(await balance(router)).toBe(0n);
  });
  it("rejects duplicate payment by the same buyer", async () => {
    await pay();
    const again = await pay();
    expect(again.execResult.exceptionError).toBeDefined();
    expect(await balance(seller)).toBe(9400n);
  });
  it("does not let another buyer consume the victim's reference", async () => {
    const attack = await pay({ caller: attacker });
    expect(attack.execResult.exceptionError).toBeDefined();
    const valid = await pay();
    expect(valid.execResult.exceptionError).toBeUndefined();
    expect(await balance(seller)).toBe(9400n);
  });
  it("reverts incorrect msg.value without moving funds", async () => {
    const result = await pay({ value: 9999n });
    expect(result.execResult.exceptionError).toBeDefined();
    expect(await balance(seller)).toBe(0n);
    expect(await balance(platform)).toBe(0n);
  });
  it("rejects self payment", async () =>
    expect(
      (await pay({ recipient: payer })).execResult.exceptionError,
    ).toBeDefined());
  it("rejects a non-allowlisted token", async () =>
    expect(
      (await pay({ token: seller.toString() as Hex, value: 0n })).execResult
        .exceptionError,
    ).toBeDefined());
  it("rolls back the seller transfer when the platform rejects ETH", async () => {
    await vm.stateManager.putCode(platform, hexToBytes("0x60006000fd"));
    const result = await pay();
    expect(result.execResult.exceptionError).toBeDefined();
    expect(await balance(seller)).toBe(0n);
    expect(await balance(router)).toBe(0n);
  });
  it("sends the affiliate share directly in the same payment", async () => {
    const result = await pay({
      affiliate: attacker.toString() as Hex,
      affiliateAmount: 2000n,
    });
    expect(result.execResult.exceptionError).toBeUndefined();
    expect(await balance(seller)).toBe(7400n);
    expect(await balance(platform)).toBe(600n);
    expect(await balance(attacker)).toBe(10n ** 20n + 2000n);
  });
  it("sends an ERC20 affiliate share directly", async () => {
    await approve();
    const result = await pay({
      token: tokenAddress.toString() as Hex,
      value: 0n,
      affiliate: attacker.toString() as Hex,
      affiliateAmount: 2000n,
    });
    expect(result.execResult.exceptionError).toBeUndefined();
    expect(await tokenBalance(seller)).toBe(7400n);
    expect(await tokenBalance(attacker)).toBe(2000n);
  });
  it("rolls back all legs when the affiliate rejects ETH", async () => {
    await vm.stateManager.putCode(attacker, hexToBytes("0x60006000fd"));
    const result = await pay({
      affiliate: attacker.toString() as Hex,
      affiliateAmount: 2000n,
    });
    expect(result.execResult.exceptionError).toBeDefined();
    expect(await balance(seller)).toBe(0n);
    expect(await balance(platform)).toBe(0n);
  });
  it("rejects changed quote amounts after signing", async () =>
    expect(
      (await pay({ tamperFee: true })).execResult.exceptionError,
    ).toBeDefined());
  it("rejects a signature from another chain domain", async () =>
    expect(
      (await pay({ signatureChain: 84532 })).execResult.exceptionError,
    ).toBeDefined());
  it("rejects self referral", async () =>
    expect(
      (
        await pay({
          affiliate: payer.toString() as Hex,
          affiliateAmount: 1000n,
        })
      ).execResult.exceptionError,
    ).toBeDefined());
  it("rejects the old 2 percent fee", async () =>
    expect((await pay({ fee: 200n })).execResult.exceptionError).toBeDefined());
});
