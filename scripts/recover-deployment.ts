import { config } from "dotenv";
import { formatEther, type Hex } from "viem";
config({ path: ".env.local", quiet: true });
async function main() {
  const [{ isEvmNetwork }, { verifyEvmDeployment, registerEvmDeployment }] =
    await Promise.all([
      import("../lib/network"),
      import("../lib/evm-deployment"),
    ]);
  const [network, hash, mode] = process.argv.slice(2);
  if (
    !network ||
    !isEvmNetwork(network) ||
    !/^0x[0-9a-fA-F]{64}$/.test(hash || "") ||
    (mode && mode !== "--register")
  )
    throw new Error("Usage: recover-deployment.ts network hash [--register]");
  const result = await verifyEvmDeployment(network, hash as Hex);
  console.log(
    JSON.stringify({
      address: result.address,
      network,
      platform: result.platform,
      feeNative: formatEther(result.gasUsed * result.effectiveGasPrice),
      verified: true,
    }),
  );
  if (mode === "--register")
    console.log(
      JSON.stringify(await registerEvmDeployment(network, hash as Hex, null)),
    );
}
main().catch((error) => {
  console.error(
    error instanceof Error && error.name === "HttpError"
      ? error.message
      : "Deployment verification failed; registration not completed.",
  );
  process.exitCode = 1;
});
