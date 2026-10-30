import { config } from "dotenv";
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  type Abi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
config({ path: ".env.local", quiet: true });
async function main() {
  const [
    { chains },
    { ASSETS, isAssetEnabled },
    { isEvmNetwork, RPC_DEFAULTS },
  ] = await Promise.all([
    import("../lib/web3"),
    import("../lib/catalog"),
    import("../lib/network"),
  ]);
  const network = process.argv[2];
  if (!network || !isEvmNetwork(network))
    throw new Error(
      "Usage: npm run contracts:deploy -- base|arbitrum|ethereum|bsc",
    );
  if (
    !process.env.DEPLOYER_PRIVATE_KEY ||
    !process.env.PLATFORM_EVM_WALLET ||
    !process.env.QUOTE_SIGNER_PRIVATE_KEY
  )
    throw new Error(
      "Set DEPLOYER_PRIVATE_KEY in the shell; PLATFORM_EVM_WALLET and QUOTE_SIGNER_PRIVATE_KEY in .env.local",
    );
  const rpc =
    process.env[`${network.toUpperCase()}_RPC_URL`] || RPC_DEFAULTS[network];
  if (!rpc) throw new Error("Missing RPC URL");
  const artifact = JSON.parse(
    readFileSync("artifacts/PaymentRouter.json", "utf8"),
  ) as { abi: Abi; evm: { bytecode: { object: string } } };
  const chain = chains[network],
    account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex),
    client = createPublicClient({ chain, transport: http(rpc) });
  if ((await client.getChainId()) !== chain.id)
    throw new Error("RPC chain mismatch");
  const wallet = createWalletClient({ chain, account, transport: http(rpc) }),
    platform = getAddress(process.env.PLATFORM_EVM_WALLET);
  const tokens = Object.entries(ASSETS)
    .filter(
      ([id, asset]) =>
        asset.network === network &&
        asset.symbol !== "ETH" &&
        isAssetEnabled(id),
    )
    .map(([, asset]) => getAddress(asset.address));
  const hash = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
    args: [
      platform,
      privateKeyToAccount(process.env.QUOTE_SIGNER_PRIVATE_KEY as Hex).address,
      tokens,
    ],
  });
  console.log(`Deployment transaction: ${hash}`);
  const receipt = await client.waitForTransactionReceipt({
    hash,
    confirmations: 2,
  });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error("Deployment failed");
  console.log(
    `${network.toUpperCase()}_PAYMENT_ROUTER=${receipt.contractAddress}`,
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Deployment failed");
  process.exitCode = 1;
});
