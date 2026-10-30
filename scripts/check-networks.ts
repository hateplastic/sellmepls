import { config } from "dotenv";
import { erc20Abi, getAddress } from "viem";
config({ path: ".env.local", quiet: true });
async function main() {
  const [
    { EVM_NETWORKS },
    { evmClient },
    { serverEvmRpc },
    { ASSETS, isAssetEnabled },
    { assertTronNetwork, tronRead },
  ] = await Promise.all([
    import("../lib/network"),
    import("../lib/web3"),
    import("../lib/env"),
    import("../lib/catalog"),
    import("../lib/tron-rpc"),
  ]);
  for (const network of EVM_NETWORKS) {
    try {
      const client = evmClient(network, serverEvmRpc(network));
      if ((await client.getChainId()) !== client.chain.id)
        throw new Error("chain mismatch");
      for (const [id, asset] of Object.entries(ASSETS)) {
        if (
          asset.network !== network ||
          asset.symbol === "ETH" ||
          !isAssetEnabled(id)
        )
          continue;
        const decimals = await client.readContract({
          address: getAddress(asset.address),
          abi: erc20Abi,
          functionName: "decimals",
        });
        if (decimals !== asset.decimals) throw new Error("decimals mismatch");
        console.log(
          `PASS ${id}: chain ${client.chain.id}, token decimals ${decimals}`,
        );
      }
    } catch {
      console.error(
        `FAIL ${network}: RPC or token metadata unavailable/mismatched`,
      );
      process.exitCode = 1;
    }
  }
  try {
    await assertTronNetwork();
    const decimals = BigInt(
      await tronRead(ASSETS["tron:USDT"].address, "decimals()"),
    );
    if (decimals !== 6n) throw new Error();
    console.log("PASS tron:USDT network and token decimals 6");
  } catch {
    console.error("FAIL tron: RPC or token metadata unavailable/mismatched");
    process.exitCode = 1;
  }
  console.log("Read-only checks; no transaction was signed or broadcast.");
}
main().catch(() => {
  console.error("Network checks failed");
  process.exitCode = 1;
});
