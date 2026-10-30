import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
async function main() {
  const { adminDb } = await import("../lib/supabase/server");
  const { settlementEnv } = await import("../lib/env");
  const { solanaConnection, SOLANA_GENESIS } = await import("../lib/web3");
  const { buildSolanaTransaction } = await import("../lib/solana-transaction");
  const { inspectSolanaPayment } = await import("../lib/solana-preflight");
  const { PublicKey, VersionedTransaction } = await import("@solana/web3.js");
  const { ASSETS } = await import("../lib/catalog");
  const { getAssociatedTokenAddressSync } = await import("../lib/spl");
  const db = adminDb(),
    rpc = solanaConnection(settlementEnv().SOLANA_RPC_URL);
  if ((await rpc.getGenesisHash()) !== SOLANA_GENESIS)
    throw new Error("Chain mismatch");
  console.log(
    "Configured environment:",
    process.env.NEXT_PUBLIC_CHAIN_ENV,
    "; RPC genesis verified",
  );
  const result = await db
    .from("sales")
    .select("*")
    .eq("network", "solana")
    .eq("chain_environment", process.env.NEXT_PUBLIC_CHAIN_ENV)
    .order("created_at", { ascending: false })
    .limit(5);
  if (result.error) throw new Error("Order read failed");
  const rent = await rpc.getMinimumBalanceForRentExemption(0, "confirmed");
  console.log("Minimum native recipient account balance (SOL):", rent / 1e9);
  const addresses = new Set<string>();
  for (const row of result.data) {
    console.log(
      "Order:",
      row.id,
      row.asset,
      "atomic amount:",
      row.amount,
      "status:",
      row.status,
      "created:",
      row.created_at,
    );
    [
      row.buyer_wallet,
      row.seller_wallet,
      row.platform_wallet,
      row.affiliate_wallet,
    ]
      .filter(Boolean)
      .forEach((address) => addresses.add(address));
  }
  for (const address of addresses) {
    const key = new PublicKey(address),
      account = await rpc.getAccountInfo(key, "confirmed");
    const balances: Record<string, string> = {
      SOL: String((account?.lamports || 0) / 1e9),
    };
    for (const asset of ["solana:USDC", "solana:USDT"] as const) {
      try {
        const balance = await rpc.getTokenAccountBalance(
          getAssociatedTokenAddressSync(
            new PublicKey(ASSETS[asset].address),
            key,
          ),
          "confirmed",
        );
        balances[asset] = balance.value.uiAmountString || "0";
      } catch {
        balances[asset] = "no token account / RPC unavailable";
      }
    }
    console.log("Wallet", address, JSON.stringify(balances));
  }
  const latest = (await rpc.getLatestBlockhashAndContext("confirmed")).value;
  for (const row of result.data.slice(0, 2)) {
    const product = await db
      .from("products")
      .select("id,title,prices")
      .eq("id", row.product_id)
      .single();
    if (product.error) throw new Error("Product read failed");
    console.log("Listing", JSON.stringify(product.data));
    const tx = buildSolanaTransaction(row, latest.blockhash);
    console.log(
      "Current readiness",
      JSON.stringify(await inspectSolanaPayment(row, tx, rpc)),
    );
    const simulation = await rpc.simulateTransaction(
      new VersionedTransaction(tx.compileMessage()),
      { sigVerify: false, commitment: "confirmed" },
    );
    console.log(
      "Simulation only",
      row.id,
      JSON.stringify(simulation.value.err),
      JSON.stringify(
        simulation.value.logs
          ?.filter((line) => /insufficient|error|failed|rent/i.test(line))
          .slice(-5),
      ),
    );
    const native = {
      ...row,
      asset: "solana:SOL" as const,
      amount: "1000000",
      fee: "100000",
      fixed_fee: "0",
      affiliate_wallet: null,
      affiliate_amount: "0",
    };
    const nativeTx = buildSolanaTransaction(native, latest.blockhash);
    const nativeSimulation = await rpc.simulateTransaction(
      new VersionedTransaction(nativeTx.compileMessage()),
      { sigVerify: false, commitment: "confirmed" },
    );
    console.log(
      "Hypothetical 0.001 SOL simulation (no signature/broadcast)",
      row.id,
      JSON.stringify(nativeSimulation.value.err),
      JSON.stringify(
        nativeSimulation.value.logs
          ?.filter((line) => /insufficient|error|failed|rent/i.test(line))
          .slice(-5),
      ),
    );
  }
}
main().catch((error) => {
  console.error(
    "Diagnostic failed",
    error instanceof Error ? error.name : "RPC error",
  );
  process.exitCode = 1;
});
