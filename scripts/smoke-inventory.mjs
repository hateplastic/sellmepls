import { config } from "dotenv";
import { generateKeyPairSync, sign, randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
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
    signal: AbortSignal.timeout(90000),
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
    signal: AbortSignal.timeout(90000),
  });
  return { response, body: await response.json() };
}
const { storage } = await import("../lib/storage.ts");
const { inventoryDownload, inventoryCounts } = await import("../lib/inventory.ts");
const { inventoryCanExpire } = await import("../lib/inventory-expiry.ts");
const s3 = storage(), keys = new Set();
let stockId;
async function upload(user, filename, bytes, kind = "file") {
  const result = await post("/api/uploads", user, { kind, filename, bytes: bytes.length, contentType:kind === "preview" ? "image/png" : "application/octet-stream", checksum:createHash("sha256").update(bytes).digest("base64") });
  check(result.response.ok,"Upload ticket failed");
  const response = await fetch(result.body.url, {method:"PUT",headers:{"Content-Type":result.body.contentType},body:bytes});
  check(response.ok,"R2 PUT failed");
  return result.body.id;
}
async function action(user, name, payload) {
  const manifest = JSON.parse(readFileSync(".next/dev/server/server-reference-manifest.json","utf8"));
  const entry = Object.entries(manifest.node).find(([,value])=>value.exportedName === name);
  check(entry,`Action ${name} not compiled`);
  const response = await fetch(origin+"/dashboard", {method:"POST",headers:{Origin:origin,Cookie:user.cookie,"Next-Action":entry[0],Accept:"text/x-component","Content-Type":"text/plain;charset=UTF-8"},body:JSON.stringify([payload]),signal:AbortSignal.timeout(90000)});
  const flight = await response.text(); check(response.ok,`Action ${name} transport failed`);
  for (const line of flight.split("\n")) {
    if (!/^[0-9a-f]+:\{/.test(line)) continue;
    try { const data = JSON.parse(line.slice(line.indexOf(":")+1)); if (["id","error","added"].some(k=>Object.hasOwn(data,k))) return data; } catch {}
  }
  throw new Error(`Action ${name} did not return data`);
}
try {
  const seller = await identity("solana"), buyer = await identity("solana"), other = await identity("solana");
  const page = await fetch(origin+"/dashboard",{headers:{Cookie:seller.cookie},signal:AbortSignal.timeout(90000)});
  check(page.ok && (await page.text()).includes("Поштучно"),"Seller mode selector absent");
  const png = await sharp({create:{width:8,height:8,channels:4,background:"#caff68"}}).png().toBuffer();
  const lines = Array.from({length:40},(_,i)=>`DIAGNOSTIC-NOT-A-REAL-LICENSE-${i}`);
  const fileId = await upload(seller,"temporary-stock.txt",Buffer.from(lines.join("\r\n")));
  const previewId = await upload(seller,"temporary-cover.png",png,"preview");
  const listing = { title:"Temporary stock integration check",description:"Disposable test inventory, no usable credentials or keys.",category:"licenses",deliveryMode:"stock",fileId,previewId,prices:[{asset:"solana:USDC",amount:"0.10"}],evmWallet:"",solanaWallet:seller.address,affiliateEnabled:false,affiliateBps:1000,galleryKeep:[],galleryUploadIds:[],youtubeUrl:"" };
  const published = await action(seller,"publishProduct",listing);
  check(published.id,`Stock publish failed: ${published.error || "unknown"}`); stockId=published.id;
  const product = checked(await admin.from("products").select("*").eq("id",stockId).single()); keys.add(product.preview_key);
  check(product.delivery_mode === "stock","Wrong product mode");
  check(checked(await admin.from("product_files").select("*").eq("product_id",stockId)).length===0,"Whole batch exposed as a product file");
  check((await inventoryCounts(stockId)).available===40,"Wrong imported quantity");
  if (process.argv.includes("--preview")) {
    console.log(`PREVIEW ${origin}/p/${stockId} (temporary fixture; cleanup resumes in 60 seconds)`);
    await new Promise(resolve => setTimeout(resolve,60000));
  }
  check(Boolean((await buyer.client.from("inventory_units").select("*").eq("product_id",stockId)).error),"Inventory visible through browser role");
  const editPage = await fetch(origin+`/dashboard/products/${stockId}/edit`,{headers:{Cookie:seller.cookie},signal:AbortSignal.timeout(90000)});
  check(editPage.ok && (await editPage.text()).includes("Пополнить склад"),"Stock management UI absent");
  const refill = await upload(seller,"refill.txt",Buffer.from(`${lines[0]}\nNEW-DIAGNOSTIC-ONLY`));
  const foreign = await action(other,"restockProduct",{productId:stockId,uploadId:refill}); check(Boolean(foreign.error),"Foreign stock mutation accepted");
  const restocked = await action(seller,"restockProduct",{productId:stockId,uploadId:refill}); check(restocked.added===1,`Restock failed: ${restocked.error || "wrong count"}`);
  const requests = await Promise.all([buyer,other].map(u=>post("/api/orders",u,{productId:stockId,asset:"solana:USDC",quantity:30,checkoutKey:randomUUID()})));
  check(requests.filter(r=>r.response.ok).length===1,"Concurrent checkout oversold stock");
  check(requests.filter(r=>r.response.status===409).length===1,"Missing insufficient inventory response");
  const winnerIndex=requests.findIndex(r=>r.response.ok), purchaser=[buyer,other][winnerIndex], outsider=[buyer,other][1-winnerIndex], sale=requests[winnerIndex].body;
  check(sale.quantity===30 && sale.amount==="3000000" && sale.fee==="650000","Aggregate commission incorrect");
  const retry = await post("/api/orders",purchaser,{productId:stockId,asset:"solana:USDC",quantity:30,checkoutKey:randomUUID()}); check(retry.body.id===sale.id,"Retry reserved a second batch");
  const prepare = await post("/api/solana/transaction",purchaser,{action:"prepare",orderId:sale.id}); check(prepare.response.ok,"Stock payment preparation failed");
  const prepared = checked(await admin.from("sales").select("*").eq("id",sale.id).single());
  check(prepared.solana_blockhashes.length===1 && prepared.solana_last_valid_height>0,"Payment lifetime not persisted");
  const denied = await post("/api/verify-tx",outsider,{orderId:sale.id,txHash:"1".repeat(64)}); check(denied.response.status===404 && !denied.body.downloadUrl,"Foreign download allowed");
  const unpaid = await post("/api/verify-tx",purchaser,{orderId:sale.id,txHash:"1".repeat(64)}); check([202,422].includes(unpaid.response.status) && !unpaid.body.downloadUrl,"Unpaid download allowed");
  console.log("PASS live TXT import, encryption/private RLS, owner-only refill, cross-batch deduplication, concurrent quantity reservation, aggregate fee, Helius preparation and unpaid/foreign download denial.");
  // Exercise fulfillment with an explicitly simulated settlement of this
  // disposable fixture. No real wallet is charged and no chain tx is sent.
  const paid = checked(await admin.rpc("complete_sale",{p_id:sale.id,p_hash:`diagnostic-${randomUUID()}`,p_block:"1",p_paid_at:new Date().toISOString()}));
  const url = await inventoryDownload(paid); keys.add(`deliveries/${purchaser.id}/${sale.id}.txt`);
  const download = await fetch(url), delivered=(await download.text()).trimEnd().split("\r\n");
  check(download.ok && delivered.length===30 && new Set(delivered).size===30,"Wrong delivery count");
  check(delivered.every(line=>lines.includes(line)),"Delivery includes unrelated units");
  check(download.headers.get("content-disposition")?.includes("attachment"),"Download not an attachment");
  const again = await fetch(await inventoryDownload(paid)); check((await again.text()).trimEnd().split("\r\n").join("\n")===delivered.join("\n"),"Re-download changed assignment");
  const repeat = await post("/api/orders",purchaser,{productId:stockId,asset:"solana:USDC",quantity:2,checkoutKey:randomUUID()}); check(repeat.response.ok && repeat.body.id!==sale.id,"Repeat purchase failed");
  checked(await admin.from("sales").update({created_at:new Date(Date.now()-720000).toISOString(),expires_at:new Date(Date.now()-120000).toISOString()}).eq("id",repeat.body.id));
  const expired=checked(await admin.from("sales").select("*").eq("id",repeat.body.id).single()); check(await inventoryCanExpire(expired),"Unprepared expiry proof failed");
  check(checked(await admin.rpc("release_inventory",{p_id:expired.id})),"Release failed");
  check((await inventoryCounts(stockId)).available===11,"Released units did not return to stock");
  console.log("PASS simulated settlement delivers exactly 30 assigned lines through R2, repeat download is identical, repeat purchase works, unprepared expired reserve returns to stock. No blockchain transaction broadcast.");
} catch (error) {
  console.error("FAIL",error instanceof Error ? error.message : "Inventory integration failed"); process.exitCode=1;
} finally {
  const ownerIds=users.map(u=>u.id);
  if (ownerIds.length) {
    const products=checked(await admin.from("products").select("id,preview_key").in("seller_id",ownerIds));
    for (const product of products) {
      keys.add(product.preview_key);
      checked(await admin.from("inventory_units").delete().eq("product_id",product.id));
      checked(await admin.from("sales").delete().eq("product_id",product.id));
      checked(await admin.from("product_files").delete().eq("product_id",product.id));
      checked(await admin.from("products").delete().eq("id",product.id));
    }
    const uploads=checked(await admin.from("uploads").select("object_key").in("user_id",ownerIds)); uploads.forEach(u=>keys.add(u.object_key));
    checked(await admin.from("uploads").delete().in("user_id",ownerIds));
    for (const user of users) {
      for (const prefix of ["order","verify","solana","upload","publish","restock","edit"]) checked(await admin.from("rate_limits").delete().eq("key",`${prefix}:${user.id}`));
      checked(await admin.from("users").delete().eq("id",user.id)); await user.client.auth.signOut(); checked(await admin.auth.admin.deleteUser(user.id));
    }
    for (const Key of keys) await s3.send(new DeleteObjectCommand({Bucket:process.env.S3_BUCKET,Key}));
  }
  console.log("PASS temporary inventory fixtures removed");
}
