import { config } from "dotenv";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { PublicKey, Transaction, Keypair } from "@solana/web3.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import {
  ethereumLoginMessage,
  solanaLoginMessage,
} from "../lib/login-message.ts";
config({ path: ".env.local", quiet: true });
const origin = process.env.NEXT_PUBLIC_APP_URL;
if (origin !== "http://localhost:3000")
  throw new Error("This diagnostic only runs against localhost:3000");
const options = {
  auth: { autoRefreshToken: false, persistSession: false },
  global: {
    fetch: (url, init) =>
      fetch(url, { ...init, signal: AbortSignal.timeout(30000) }),
  },
};
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  options,
);
const users = [],
  productId = randomUUID();
function check(condition, message) {
  if (!condition) throw new Error(message);
}
function checked(result) {
  check(
    !result.error,
    `Database operation failed (${result.error?.code || "unknown"})`,
  );
  return result.data;
}
async function identity(chain) {
  const cookies = new Map();
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      ...options,
      cookies: {
        getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
        setAll: (items) =>
          items.forEach(({ name, value }) => cookies.set(name, value)),
      },
    },
  );
  let address, message, signature, signPayment;
  if (chain === "ethereum") {
    const account = privateKeyToAccount(generatePrivateKey());
    address = account.address;
    message = ethereumLoginMessage(
      address,
      process.env.NEXT_PUBLIC_CHAIN_ENV === "mainnet" ? 8453 : 84532,
      origin,
    );
    signature = await account.signMessage({ message });
  } else {
    const pair = generateKeyPairSync("ed25519");
    address = new PublicKey(
      pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
    ).toBase58();
    message = solanaLoginMessage(address, origin);
    signature = new Uint8Array(
      sign(null, Buffer.from(message), pair.privateKey),
    );
    signPayment = (tx) =>
      tx.addSignature(
        new PublicKey(address),
        sign(null, tx.serializeMessage(), pair.privateKey),
      );
  }
  const result = await client.auth.signInWithWeb3({
    chain,
    message,
    signature,
  });
  check(!result.error && result.data.user, "Wallet sign-in failed");
  const user = {
    id: result.data.user.id,
    address,
    client,
    signPayment,
    cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
  };
  users.push(user);
  checked(
    await admin.from("users").upsert({
      id: user.id,
      ...(chain === "solana"
        ? { solana_wallet: address }
        : { evm_wallet: address }),
    }),
  );
  return user;
}
async function order(user, asset = "solana:USDC") {
  const response = await fetch(`${origin}/api/orders`, {
    method: "POST",
    headers: {
      Origin: origin,
      Cookie: user.cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ productId, asset }),
    signal: AbortSignal.timeout(45000),
  });
  return { response, body: await response.json() };
}
async function post(path, user, body) {
  const response = await fetch(origin + path, {
    method: "POST",
    headers: {
      Origin: origin,
      Cookie: user?.cookie || "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  return { response, body: await response.json() };
}
try {
  const seller = await identity("solana"),
    buyer = await identity("solana"),
    evm = await identity("ethereum");
  checked(
    await admin.from("products").insert({
      id: productId,
      seller_id: seller.id,
      title: "Temporary checkout diagnostic",
      description:
        "Temporary fixture for payment validation without transferring funds.",
      prices: [{ asset: "solana:USDC", amount: "0.60" }],
      preview_key: "diagnostic/no-file",
      file_name: "diagnostic.txt",
      file_size: 1,
      affiliate_enabled: false,
    }),
  );
  let result = await order(evm);
  check(
    result.response.status === 400 && result.body.error.includes("EVM-адресом"),
    "Network mismatch explanation failed",
  );
  result = await order(seller);
  check(
    result.response.status === 400 &&
      result.body.error.includes("аккаунтом продавца"),
    "Self-purchase was not identified",
  );
  checked(
    await admin
      .from("users")
      .update({ solana_wallet: process.env.PLATFORM_SOLANA_WALLET })
      .eq("id", seller.id),
  );
  result = await order(buyer);
  check(
    result.response.status === 400 &&
      result.body.error.includes("В профиле продавца"),
    "Seller/platform collision explanation failed",
  );
  checked(
    await admin
      .from("users")
      .update({ solana_wallet: seller.address })
      .eq("id", seller.id),
  );
  result = await order(buyer);
  check(
    result.response.status === 201,
    "Distinct buyer and seller could not create an order",
  );
  const sale = result.body;
  check(
    sale.chain_environment === process.env.NEXT_PUBLIC_CHAIN_ENV &&
      sale.buyer_wallet === buyer.address &&
      sale.seller_wallet === seller.address &&
      sale.platform_wallet === process.env.PLATFORM_SOLANA_WALLET,
    "Wrong network or payment participants",
  );
  check(
    sale.amount === "600000" &&
      sale.fee === "60000" &&
      sale.fixed_fee === "0" &&
      sale.fee_bps === 1000 &&
      sale.commission_version === 2 &&
      sale.affiliate_amount === "0",
    "Incorrect $0.60 checkout split",
  );
  check(
    (await order(buyer)).body.id === sale.id,
    "Retry created a duplicate order",
  );
  let prepared = await post("/api/solana/transaction", seller, {
    action: "prepare",
    orderId: sale.id,
  });
  check(
    prepared.response.status === 404,
    "Foreign buyer accessed transaction preparation",
  );
  prepared = await post("/api/solana/transaction", buyer, {
    action: "prepare",
    orderId: sale.id,
  });
  check(
    prepared.response.ok && prepared.body.ticket && prepared.body.transaction,
    "Server blockhash/transaction preparation failed",
  );
  const tx = Transaction.from(Buffer.from(prepared.body.transaction, "base64"));
  check(
    tx.feePayer.toBase58() === buyer.address &&
      tx.recentBlockhash &&
      tx.instructions.length === 5,
    "Prepared transaction is incomplete",
  );
  // Sign only an altered payment. The API must refuse it before any broadcast.
  tx.instructions[1].keys[2].pubkey = Keypair.generate().publicKey;
  buyer.signPayment(tx);
  const tampered = await post("/api/solana/transaction", buyer, {
    action: "send",
    orderId: sale.id,
    transaction: tx.serialize().toString("base64"),
    ticket: prepared.body.ticket,
  });
  check(tampered.response.status === 403, "Altered payment was not refused");
  const fakeTx = "1".repeat(64);
  const foreign = await post("/api/verify-tx", seller, {
    orderId: sale.id,
    txHash: fakeTx,
  });
  check(
    foreign.response.status === 404 && !foreign.body.downloadUrl,
    "Foreign user could obtain a download",
  );
  const unpaid = await post("/api/verify-tx", buyer, {
    orderId: sale.id,
    txHash: fakeTx,
  });
  check(
    [202, 422].includes(unpaid.response.status) && !unpaid.body.downloadUrl,
    "Unpaid order could obtain a download",
  );
  const injected = await buyer.client
    .from("sales")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", sale.id);
  check(Boolean(injected.error), "Browser could mark its own order paid");
  console.log(
    "PASS Helius/server blockhash, unsigned transaction preparation, foreign-order rejection, altered signed transfer rejection, direct unpaid download denial and live sales RLS. No transaction broadcast.",
  );
  console.log(
    `PASS ${sale.chain_environment}: Solana checkout creates a 0.60 USDC order, platform 0.06, seller 0.54; same IP accepted; distinct errors and retry verified. Only a deliberately altered transaction was signed by an empty temporary wallet and rejected; no transaction broadcast.`,
  );
} catch (error) {
  console.error(
    "FAIL",
    error instanceof Error ? error.message : "Checkout test failed",
  );
  process.exitCode = 1;
} finally {
  checked(await admin.from("sales").delete().eq("product_id", productId));
  checked(await admin.from("products").delete().eq("id", productId));
  for (const user of users) {
    checked(
      await admin.from("rate_limits").delete().eq("key", `order:${user.id}`),
    );
    for (const kind of ["solana", "verify"])
      checked(
        await admin
          .from("rate_limits")
          .delete()
          .eq("key", `${kind}:${user.id}`),
      );
    checked(await admin.from("users").delete().eq("id", user.id));
    await user.client.auth.signOut();
    checked(await admin.auth.admin.deleteUser(user.id));
  }
  console.log("PASS temporary checkout records and identities removed");
}
