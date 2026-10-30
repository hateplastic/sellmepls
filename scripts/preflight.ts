import { config } from "dotenv";
import { checkDatabaseSchema } from "../lib/database-check";
import { readFileSync } from "node:fs";
import { getAddress, zeroAddress } from "viem";
import { PublicKey } from "@solana/web3.js";
import { privateKeyToAccount } from "viem/accounts";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
config({ path: ".env.local", quiet: true });
async function main() {
  const [
    { paymentEnv, storageEnv, databaseEnv, serverEvmRpc },
    { evmClient, solanaConnection, routerAbi, SOLANA_GENESIS },
    { adminDb },
    { storage },
  ] = await Promise.all([
    import("../lib/env"),
    import("../lib/web3"),
    import("../lib/supabase/server"),
    import("../lib/storage"),
  ]);
  const { configuredRouter } = await import("../lib/payment-routers");
  const { EVM_NETWORKS } = await import("../lib/network");
  const only = process.argv[2];
  if (only && ![...EVM_NETWORKS, "solana", "tron"].includes(only))
    throw new Error(
      "Usage: npm run preflight -- [base|arbitrum|ethereum|bsc|solana|tron]",
    );
  databaseEnv();
  const e = { ...paymentEnv(), ...storageEnv() },
    artifact = JSON.parse(readFileSync("artifacts/PaymentRouter.json", "utf8"));
  if (
    getAddress(e.PLATFORM_EVM_WALLET) === zeroAddress ||
    !PublicKey.isOnCurve(new PublicKey(e.PLATFORM_SOLANA_WALLET).toBytes())
  )
    throw new Error("Invalid platform wallet");
  for (const network of EVM_NETWORKS) {
    if (only && only !== network) continue;
    const configured = await configuredRouter(network);
    if (!configured) {
      console.error(
        `${network}: payment router is not deployed; use /admin to deploy through your wallet`,
      );
      process.exitCode = 1;
      continue;
    }
    const client = evmClient(network, serverEvmRpc(network)),
      address = getAddress(configured);
    const [id, code, platform, signer] = await Promise.all([
      client.getChainId(),
      client.getCode({ address }),
      client.readContract({
        address,
        abi: routerAbi,
        functionName: "platform",
      }),
      client.readContract({
        address,
        abi: routerAbi,
        functionName: "quoteSigner",
      }),
    ]);
    if (
      id !== client.chain.id ||
      getAddress(platform) !== getAddress(e.PLATFORM_EVM_WALLET) ||
      getAddress(signer) !==
        privateKeyToAccount(e.QUOTE_SIGNER_PRIVATE_KEY as `0x${string}`)
          .address ||
      !code
    )
      throw new Error(`${network}: incorrect deployment`);
    const normalize = (hex: string) => {
      const data = Buffer.from(hex.replace(/^0x/, ""), "hex");
      for (const refs of Object.values(
        artifact.evm.deployedBytecode.immutableReferences,
      ) as { start: number; length: number }[][])
        for (const ref of refs) data.fill(0, ref.start, ref.start + ref.length);
      return data.toString("hex");
    };
    if (normalize(code) !== normalize(artifact.evm.deployedBytecode.object))
      throw new Error(
        `${network}: deployed bytecode differs from compiled source`,
      );
    console.log(`${network}: chain, router bytecode and fee wallet verified`);
  }
  if (!only || only === "tron") {
    const { assertTronNetwork, tronRead, tronEnv } =
      await import("../lib/tron-rpc");
    const { tronToEvm } = await import("../lib/tron-address");
    await assertTronNetwork();
    const router = await configuredRouter("tron");
    if (!router) {
      console.error("tron: router not deployed; use /admin and TronLink");
      process.exitCode = 1;
    } else {
      const [platform, signer] = await Promise.all([
        tronRead(router, "platform()"),
        tronRead(router, "quoteSigner()"),
      ]);
      if (
        platform.slice(-40).toLowerCase() !==
          tronToEvm(tronEnv().platform).slice(2).toLowerCase() ||
        signer.slice(-40).toLowerCase() !==
          privateKeyToAccount(e.QUOTE_SIGNER_PRIVATE_KEY as `0x${string}`)
            .address.slice(2)
            .toLowerCase()
      )
        throw new Error("tron: router configuration mismatch");
      console.log("tron: network and immutable payout configuration verified");
    }
  }
  if (
    (await solanaConnection(e.SOLANA_RPC_URL).getGenesisHash()) !==
    SOLANA_GENESIS
  )
    throw new Error("Solana RPC does not match NEXT_PUBLIC_CHAIN_ENV");
  const latest = await solanaConnection(e.SOLANA_RPC_URL).getLatestBlockhash(
    "confirmed",
  );
  if (!latest.blockhash || latest.lastValidBlockHeight <= 0)
    throw new Error("Solana RPC did not return a recent blockhash");
  await checkDatabaseSchema(adminDb());
  await storage().send(new HeadBucketCommand({ Bucket: e.S3_BUCKET }));
  console.log(
    "Supabase schema, configured Solana network and private storage credentials verified",
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Preflight failed");
  process.exitCode = 1;
});
