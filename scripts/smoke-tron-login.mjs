import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { Trx, TronWeb } from "tronweb";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local", quiet: true });
const origin = process.env.NEXT_PUBLIC_APP_URL;
if (origin !== "http://localhost:3000")
  throw new Error("This check only runs on localhost:3000");
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const key = randomBytes(32).toString("hex"),
  address = TronWeb.address.fromPrivateKey(key),
  cookies = new Map();
let challengeId;
function assert(ok, message) {
  if (!ok) throw new Error(message);
}
async function post(path, body, cookie) {
  const r = await fetch(origin + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin,
      cookie: cookie ?? [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  for (const c of r.headers.getSetCookie()) {
    const part = c.split(";")[0],
      i = part.indexOf("=");
    cookies.set(part.slice(0, i), part.slice(i + 1));
  }
  return { status: r.status, body: await r.json() };
}
try {
  const challenge = await post("/api/auth/tron", {
    action: "challenge",
    address,
  });
  assert(challenge.status === 200, "Challenge request failed");
  challengeId = challenge.body.id;
  const originalCookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  const wrong = await post("/api/auth/tron", {
    action: "verify",
    id: challengeId,
    signature: Trx.signMessageV2(
      challenge.body.message,
      randomBytes(32).toString("hex"),
    ),
  });
  assert(wrong.status === 403, "Wrong signer accepted");
  const signature = Trx.signMessageV2(challenge.body.message, key);
  const login = await post("/api/auth/tron", {
    action: "verify",
    id: challengeId,
    signature,
  });
  assert(login.status === 200, "Valid TRON login failed");
  const profile = await post("/api/profile", {
    displayName: "Temporary TRON smoke test",
    bio: "",
    evmWallet: "",
    solanaWallet: "",
    tronWallet: address,
  });
  assert(profile.status === 200, "Session/profile verification failed");
  const identity = await admin
    .from("tron_identities")
    .select("user_id")
    .eq("address", address)
    .single();
  assert(!identity.error, "Private identity mapping missing");
  const row = await admin
    .from("users")
    .select("tron_wallet")
    .eq("id", identity.data.user_id)
    .single();
  assert(row.data?.tron_wallet === address, "Profile bound to wrong wallet");
  const replay = await post(
    "/api/auth/tron",
    { action: "verify", id: challengeId, signature },
    originalCookie,
  );
  assert(
    replay.status === 403 || replay.status === 409,
    "Used challenge accepted twice",
  );
  console.log(
    "PASS TRON challenge, wrong-signature rejection, Supabase session, own profile and replay rejection. No blockchain transaction created.",
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "TRON login check failed",
  );
  process.exitCode = 1;
} finally {
  const identity = await admin
    .from("tron_identities")
    .select("user_id")
    .eq("address", address)
    .maybeSingle();
  if (identity.error) {
    console.error("Temporary identity lookup failed");
    process.exitCode = 1;
  }
  if (identity.data) {
    const profile = await admin
      .from("users")
      .delete()
      .eq("id", identity.data.user_id);
    if (profile.error) {
      console.error("Temporary profile cleanup failed");
      process.exitCode = 1;
    } else {
      const deleted = await admin.auth.admin.deleteUser(identity.data.user_id);
      if (deleted.error) {
        console.error("Temporary user cleanup failed");
        process.exitCode = 1;
      }
    }
  }
  if (challengeId) {
    const deleted = await admin
      .from("wallet_challenges")
      .delete()
      .eq("id", challengeId)
      .eq("address", address);
    if (deleted.error) {
      console.error("Temporary challenge cleanup failed");
      process.exitCode = 1;
    }
  }
}
