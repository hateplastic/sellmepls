import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { ethereumLoginMessage } from "../lib/login-message.ts";
import sharp from "sharp";

config({ path: ".env.local", quiet: true });
const origin = process.env.NEXT_PUBLIC_APP_URL;
if (
  origin !== "http://localhost:3000" ||
  (process.env.NEXT_PUBLIC_CHAIN_ENV !== "testnet" &&
    !process.argv.includes("--allow-mainnet-no-payments"))
)
  throw new Error(
    "Smoke test requires localhost:3000 and testnet or --allow-mainnet-no-payments. It only creates and removes temporary fixtures; no blockchain transactions.",
  );
const { storage, downloadUrl } = await import("../lib/storage.ts");
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const users = [],
  objectKeys = new Set();
const bucket = process.env.S3_BUCKET,
  s3 = storage();
function assert(value, message) {
  if (!value) throw new Error(message);
}
function checked(result, message) {
  assert(!result.error, message);
  return result.data;
}
async function request(path, user, options = {}) {
  return fetch(origin + path, {
    ...options,
    headers: { Origin: origin, Cookie: user?.cookie || "", ...options.headers },
    signal: AbortSignal.timeout(90000),
  });
}
async function jsonRequest(path, user, data) {
  const response = await request(
    path,
    user,
    data
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      : {},
  );
  const body = await response.json();
  return { response, body };
}
async function identity() {
  const account = privateKeyToAccount(generatePrivateKey()),
    cookies = new Map();
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { autoRefreshToken: false },
      cookies: {
        getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
        setAll: (values) =>
          values.forEach(({ name, value }) => cookies.set(name, value)),
      },
    },
  );
  const message = ethereumLoginMessage(
    account.address,
    process.env.NEXT_PUBLIC_CHAIN_ENV === "mainnet" ? 8453 : 84532,
    origin,
  );
  const result = await client.auth.signInWithWeb3({
    chain: "ethereum",
    message,
    signature: await account.signMessage({ message }),
  });
  assert(!result.error && result.data.user, "Temporary sign-in failed");
  const user = {
    id: result.data.user.id,
    address: account.address,
    client,
    cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
  };
  users.push(user);
  const page = await request("/dashboard", user);
  const html = await page.text();
  assert(
    page.ok && html.includes("Создать товар"),
    "Authenticated dashboard failed",
  );
  return user;
}
async function upload(user, filename, body, kind = "file") {
  const result = await jsonRequest("/api/uploads", user, {
    filename,
    kind,
    bytes: body.length,
    contentType: kind === "preview" ? "image/png" : "application/octet-stream",
    checksum: createHash("sha256").update(body).digest("base64"),
  });
  assert(result.response.ok, "Upload ticket failed");
  const put = await fetch(result.body.url, {
    method: "PUT",
    headers: { "Content-Type": result.body.contentType },
    body,
    signal: AbortSignal.timeout(20000),
  });
  assert(put.ok, "R2 upload failed");
  return result.body.id;
}
async function action(user, name, payload) {
  const manifest = JSON.parse(
    readFileSync(".next/dev/server/server-reference-manifest.json", "utf8"),
  );
  const entry = Object.entries(manifest.node).find(
    ([, value]) => value.exportedName === name,
  );
  assert(
    entry,
    "Start next dev and visit /dashboard before running the smoke test",
  );
  const response = await request("/dashboard", user, {
    method: "POST",
    headers: {
      "Next-Action": entry[0],
      Accept: "text/x-component",
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body: JSON.stringify([payload]),
  });
  const flight = await response.text();
  assert(response.ok, `Server action ${name} failed at transport`);
  for (const line of flight.split("\n")) {
    if (!/^[0-9a-f]+:\{/.test(line)) continue;
    try {
      const value = JSON.parse(line.slice(line.indexOf(":") + 1));
      if (Object.hasOwn(value, "id") || Object.hasOwn(value, "error"))
        return value;
    } catch {}
  }
  throw new Error(`Server action ${name} returned no result`);
}
async function main() {
  const seller = await identity(),
    buyer = await identity(),
    outsider = await identity();
  console.log("PASS authenticated dashboard and server cookies");
  const zip = Buffer.from(
    "504b0506000000000000000000000000000000000000",
    "hex",
  );
  const png = await sharp({
    create: { width: 8, height: 8, channels: 4, background: "#caff68" },
  })
    .png()
    .toBuffer();
  const file = await upload(seller, "smoke-course.zip", zip),
    preview = await upload(seller, "smoke-cover.png", png, "preview");
  const gallery = await upload(seller, "smoke-gallery.png", png, "preview");
  const payload = {
    title: "Temporary integration test",
    description:
      "Disposable integration fixture; will be removed automatically.",
    category: "courses",
    fileId: file,
    previewId: preview,
    galleryUploadIds: [gallery],
    galleryKeep: [],
    youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
    prices: [{ asset: "base:USDC", amount: "0.10" }],
    evmWallet: seller.address,
    solanaWallet: "",
    affiliateEnabled: true,
    affiliateBps: 1000,
  };
  const blocked = await jsonRequest("/api/uploads", seller, {
    filename: "disallowed.exe",
    kind: "file",
    bytes: 20,
    contentType: "application/octet-stream",
    checksum: createHash("sha256").update("MZ").digest("base64"),
  });
  assert(
    blocked.response.status === 400,
    "Executable upload ticket was accepted",
  );
  const disguised = await upload(
    seller,
    "disguised.pdf",
    Buffer.from("MZ harmless integration-test bytes"),
  );
  const rejected = await action(seller, "publishProduct", {
    ...payload,
    fileId: disguised,
  });
  assert(
    rejected.error && !rejected.id,
    "Executable bytes renamed to PDF were published",
  );
  const beforePublish = checked(
    await admin.from("products").select("id").eq("seller_id", seller.id),
    "Rejected product lookup failed",
  );
  assert(beforePublish.length === 0, "Rejected upload created a product");
  console.log(
    "PASS real upload policy: EXE blocked, renamed executable rejected before publication",
  );
  const published = await action(seller, "publishProduct", payload);
  assert(published.id, "Product publish failed");
  const id = published.id;
  const initial = checked(
    await admin.from("products").select("*").eq("id", id).single(),
    "Read published product failed",
  );
  objectKeys.add(initial.preview_key);
  for (const key of initial.gallery_keys) objectKeys.add(key);
  assert(
    initial.gallery_keys.length === 1 && initial.youtube_id === "dQw4w9WgXcQ",
    "Gallery or YouTube not saved",
  );
  const galleryPreview = await request(`/api/preview/${id}?image=0`);
  assert(
    galleryPreview.ok &&
      galleryPreview.headers.get("content-type")?.includes("image/"),
    "Gallery preview inaccessible",
  );
  assert(
    (await request(`/api/preview/${id}?image=4`)).status === 404,
    "Missing gallery image should return 404",
  );
  console.log("PASS gallery publication, YouTube parsing and preview access");
  checked(
    await admin.from("products").update({ is_hidden: true }).eq("id", id),
    "Hide temporary product failed",
  );
  const hidden = checked(
    await buyer.client.from("products").select("id").eq("id", id),
    "Hidden product RLS query failed",
  );
  assert(
    hidden.length === 0 && (await request(`/p/${id}`, buyer)).status === 404,
    "Hidden product leaked",
  );
  const unhide = await seller.client
    .from("products")
    .update({ is_hidden: false })
    .eq("id", id);
  assert(unhide.error, "Seller could bypass moderation");
  const deniedChat = await jsonRequest("/api/messages", buyer, {
    action: "start",
    productId: id,
  });
  assert(
    !deniedChat.response.ok,
    "New conversation allowed for hidden product",
  );
  checked(
    await admin.from("products").update({ is_hidden: false }).eq("id", id),
    "Restore temporary product failed",
  );
  initial.revision = checked(await admin.from("products").select("revision").eq("id", id).single(), "Read revision after moderation failed").revision;
  console.log(
    "PASS live hidden-product RLS, page visibility and seller moderation bypass denial",
  );
  const originalFile = checked(
    await admin
      .from("product_files")
      .select("object_key")
      .eq("product_id", id)
      .single(),
    "Read delivery file failed",
  );
  objectKeys.add(originalFile.object_key);
  const originalDownload = await fetch(
    await downloadUrl(originalFile.object_key, initial.file_name),
  );
  assert(
    Buffer.from(await originalDownload.arrayBuffer()).equals(zip),
    "ZIP content was altered",
  );
  assert(
    originalDownload.headers.get("content-disposition")?.includes("attachment"),
    "ZIP must download as an attachment",
  );
  console.log(
    "PASS ZIP uploaded, published, sealed and downloaded byte-for-byte",
  );
  const editPage = await request(`/dashboard/products/${id}/edit`, seller);
  assert(
    editPage.ok && (await editPage.text()).includes("smoke-course.zip"),
    "Product editor did not retain current file",
  );
  assert(
    (await request(`/dashboard/products/${id}/edit`, outsider)).status === 404,
    "Foreign editor was accessible",
  );
  const editPayload = {
    ...payload,
    id,
    revision: initial.revision,
    fileId: undefined,
    previewId: undefined,
    galleryUploadIds: [],
    galleryKeep: initial.gallery_keys,
    title: "Updated integration test",
    category: "ebooks",
  };
  assert(
    (await action(outsider, "updateProduct", editPayload)).error,
    "Foreign update was accepted",
  );
  const pdf = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  );
  const replacement = await upload(seller, "smoke-manual.pdf", pdf);
  assert(
    (
      await action(seller, "updateProduct", {
        ...editPayload,
        fileId: replacement,
      })
    ).id === id,
    "File replacement failed",
  );
  assert(
    (await action(seller, "updateProduct", editPayload)).error,
    "Stale update was accepted",
  );
  const current = checked(
    await admin.from("products").select("*").eq("id", id).single(),
    "Read edited product failed",
  );
  assert(
    current.category === "ebooks" && current.file_name === "smoke-manual.pdf",
    "Edited metadata mismatch",
  );
  assert(
    current.gallery_keys[0] === initial.gallery_keys[0] &&
      current.youtube_id === "dQw4w9WgXcQ",
    "Gallery changed during file replacement",
  );
  assert(
    (await jsonRequest("/api/admin/routers?network=base", outsider)).response
      .status === 403,
    "Deployment data leaked to non-admin",
  );
  const delivery = checked(
    await admin
      .from("product_files")
      .select("object_key,product:products!inner(file_name)")
      .eq("product_id", id)
      .single(),
    "Delivery join failed",
  );
  objectKeys.add(delivery.object_key);
  const signed = await downloadUrl(
      delivery.object_key,
      delivery.product.file_name,
    ),
    downloaded = await fetch(signed);
  assert(
    new URL(signed).searchParams.get("X-Amz-Expires") === "900",
    "Download duration mismatch",
  );
  assert(
    downloaded.ok &&
      downloaded.headers
        .get("content-disposition")
        ?.includes("smoke-manual.pdf") &&
      Buffer.from(await downloaded.arrayBuffer()).equals(pdf),
    "PDF download mismatch",
  );
  console.log(
    "PASS seller-only editor, ZIP→PDF replacement, category, stale revision protection and 15-minute attachment",
  );
  const started = await jsonRequest("/api/messages", buyer, {
    action: "start",
    productId: id,
  });
  assert(started.response.ok, "Conversation creation failed");
  const conversationId = started.body.id,
    clientId = crypto.randomUUID();
  const message = {
    action: "send",
    conversationId,
    clientId,
    body: "Temporary test question before purchase",
  };
  assert(
    (await jsonRequest("/api/messages", buyer, message)).response.ok,
    "Message send failed",
  );
  assert(
    (await jsonRequest("/api/messages", buyer, message)).response.ok,
    "Message retry failed",
  );
  const history = await jsonRequest(
    `/api/messages?conversation=${conversationId}&after=0`,
    seller,
  );
  assert(
    history.response.ok && history.body.messages.length === 1,
    "History missing or duplicated",
  );
  assert(
    (
      await jsonRequest(
        `/api/messages?conversation=${conversationId}`,
        outsider,
      )
    ).response.status === 404,
    "Foreign chat read allowed",
  );
  assert(
    (
      await jsonRequest("/api/messages", outsider, {
        ...message,
        clientId: crypto.randomUUID(),
      })
    ).response.status === 404,
    "Foreign chat send allowed",
  );
  const listPage = await request("/messages", buyer);
  assert(
    listPage.ok && (await listPage.text()).includes("Updated integration test"),
    "Conversation list failed",
  );
  const chatPage = await request(`/messages/${conversationId}`, seller);
  assert(
    chatPage.ok && (await chatPage.text()).includes(message.body),
    "Conversation page failed",
  );
  const rls = await outsider.client
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId);
  assert(
    !rls.error && !rls.data.length,
    "Supabase RLS leaked private messages",
  );
  console.log(
    "PASS pre-purchase persistent chat, retry deduplication, route authorization and live RLS",
  );
  const unauthorizedAdmin = await request("/admin", buyer);
  assert(
    (await unauthorizedAdmin.text()).includes("доступ закрыт"),
    "Non-admin received analytics",
  );
  const metrics = checked(
    await admin.rpc("admin_metrics", {
      p_days: 30,
      p_environment: process.env.NEXT_PUBLIC_CHAIN_ENV,
    }),
    "Admin analytics failed",
  );
  assert(
    metrics.daily.length === 30 &&
      Number.isFinite(Number(metrics.turnover_usd)),
    "Metrics data shape invalid",
  );
  const forbiddenMetrics = await buyer.client.rpc("admin_metrics", {
    p_days: 30,
    p_environment: process.env.NEXT_PUBLIC_CHAIN_ENV,
  });
  assert(forbiddenMetrics.error, "Analytics RPC allowed browser user");
  console.log("PASS admin restriction and live 30-day analytics RPC");
}
async function cleanup() {
  for (const user of users) {
    const products = checked(
      await admin
        .from("products")
        .select("id,preview_key,gallery_keys")
        .eq("seller_id", user.id),
      "Cleanup products lookup failed",
    );
    const productIds = products.map((p) => p.id);
    products.forEach((p) => {
      objectKeys.add(p.preview_key);
      p.gallery_keys.forEach((key) => objectKeys.add(key));
    });
    if (productIds.length) {
      const files = checked(
        await admin
          .from("product_files")
          .select("object_key")
          .in("product_id", productIds),
        "Cleanup files lookup failed",
      );
      files.forEach((f) => objectKeys.add(f.object_key));
      const conversations = checked(
        await admin
          .from("conversations")
          .select("id")
          .in("product_id", productIds),
        "Cleanup conversations lookup failed",
      );
      if (conversations.length)
        checked(
          await admin
            .from("messages")
            .delete()
            .in(
              "conversation_id",
              conversations.map((c) => c.id),
            ),
          "Cleanup messages failed",
        );
      checked(
        await admin.from("conversations").delete().in("product_id", productIds),
        "Cleanup conversations failed",
      );
      checked(
        await admin.from("product_files").delete().in("product_id", productIds),
        "Cleanup product files failed",
      );
      checked(
        await admin.from("products").delete().in("id", productIds),
        "Cleanup products failed",
      );
    }
    for (const Prefix of [`staging/${user.id}/`, `products/${user.id}/`]) {
      let continuation;
      do {
        const listing = await s3.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix,
            ContinuationToken: continuation,
          }),
        );
        (listing.Contents || []).forEach((o) => objectKeys.add(o.Key));
        continuation = listing.NextContinuationToken;
      } while (continuation);
    }
    checked(
      await admin.from("uploads").delete().eq("user_id", user.id),
      "Cleanup uploads failed",
    );
    checked(
      await admin.from("users").delete().eq("id", user.id),
      "Cleanup profile failed",
    );
    for (const prefix of [
      "publish",
      "edit",
      "upload",
      "chat:start",
      "chat:send",
      "chat:read",
    ])
      checked(
        await admin
          .from("rate_limits")
          .delete()
          .eq("key", `${prefix}:${user.id}`),
        "Cleanup rate limit failed",
      );
    await user.client.auth.signOut();
    checked(
      await admin.auth.admin.deleteUser(user.id),
      "Cleanup temporary auth user failed",
    );
  }
  for (const Key of objectKeys)
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
  console.log("PASS temporary fixtures removed");
}
try {
  await main();
} catch (error) {
  console.error(
    "FAIL",
    error instanceof Error ? error.message : "Integration test failed",
  );
  process.exitCode = 1;
} finally {
  await cleanup();
}
