import { config } from "dotenv";
import { formatEther, formatGwei } from "viem";
config({ path: ".env.local", quiet: true });
async function main() {
  const [{ isEvmNetwork }, { deploymentConfig }, { evmClient }, { serverEvmRpc }, { configuredRouter }] = await Promise.all([
    import("../lib/network"), import("../lib/router-deployment"), import("../lib/web3"), import("../lib/env"), import("../lib/payment-routers"),
  ]);
  const network = process.argv[2];
  if (!network || !isEvmNetwork(network)) throw new Error("Choose base, arbitrum, ethereum or bsc");
  const client = evmClient(network, serverEvmRpc(network));
  if (await client.getChainId() !== client.chain.id) throw new Error("RPC chain mismatch");
  const deployment = deploymentConfig(network);
  const [gas, price, existing] = await Promise.all([
    // No transaction is signed or broadcast. Zero gasPrice permits simulation with an unfunded deployer.
    client.estimateGas({ account: deployment.args[0], data: deployment.data, gasPrice: 0n }),
    client.getGasPrice(), configuredRouter(network),
  ]);
  console.log(JSON.stringify({ network: client.chain.name, chainId: client.chain.id, registeredRouter: existing, estimatedGas: gas.toString(), gasPriceGwei: formatGwei(price), estimatedNativeFee: formatEther(gas * price), nativeSymbol: client.chain.nativeCurrency.symbol, estimateWith20PercentGasBuffer: formatEther(((gas * 120n + 99n) / 100n) * price), readOnly: true }, null, 2));
}
main().catch(() => { console.error("Deployment estimate unavailable; no transaction sent."); process.exitCode = 1; });
