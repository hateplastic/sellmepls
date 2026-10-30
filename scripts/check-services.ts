import { config } from "dotenv";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ethereumLoginMessage, solanaLoginMessage } from "../lib/login-message";
import { PublicKey } from "@solana/web3.js";
import { DeleteObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { checkDatabaseSchema } from "../lib/database-check";
import { walletIdentity } from "../lib/wallet-identity";

config({ path: ".env.local", quiet: true });

async function main() {
  const { appEnv, databaseEnv, storageEnv } = await import("../lib/env");
  const { storage, uploadUrl, sealUpload, downloadUrl } =
    await import("../lib/storage");
  const { NEXT_PUBLIC_APP_URL: appUrl } = appEnv();
  const dbEnv = databaseEnv(),
    s3Env = storageEnv();
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(20000) }),
    },
  };
  const admin = createClient(
    dbEnv.NEXT_PUBLIC_SUPABASE_URL,
    dbEnv.SUPABASE_SERVICE_ROLE_KEY,
    options,
  );
  async function check(name: string, run: () => Promise<string>) {
    try {
      console.log(`PASS ${name}: ${await run()}`);
    } catch (error) {
      // Do not print URLs, HTTP headers, signatures, session tokens or SDK errors.
      console.error(
        `FAIL ${name}: ${error instanceof CheckError ? error.message : "connection or configuration error"}`,
      );
      process.exitCode = 1;
    }
  }
  await check("Supabase schema", async () => {
    try {
      await checkDatabaseSchema(admin);
    } catch (error) {
      throw new CheckError(
        error instanceof Error ? error.message : "database check failed",
      );
    }
    return "all application tables are accessible";
  });
  for (const chain of ["ethereum", "solana"] as const) {
    await check(`Wallet sign-in ${chain}`, async () => {
      const client = createClient(
        dbEnv.NEXT_PUBLIC_SUPABASE_URL,
        dbEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        options,
      );
      let createdUser: string | undefined;
      try {
        let credentials;
        if (chain === "ethereum") {
          const account = privateKeyToAccount(generatePrivateKey());
          const message = ethereumLoginMessage(account.address, 84532, appUrl);
          credentials = {
            chain,
            message,
            signature: await account.signMessage({ message }),
          };
        } else {
          const key = generateKeyPairSync("ed25519");
          const publicKey = new PublicKey(
            key.publicKey.export({ type: "spki", format: "der" }).subarray(-32),
          );
          const message = solanaLoginMessage(publicKey.toBase58(), appUrl);
          credentials = {
            chain,
            message,
            signature: new Uint8Array(
              sign(null, Buffer.from(message), key.privateKey),
            ),
          };
        }
        const { data, error } = await client.auth.signInWithWeb3(credentials);
        createdUser = data.user?.id;
        if (error)
          throw new CheckError(`${error.code || error.name}: ${error.message}`);
        if (!data.session || walletIdentity(data.user)?.chain !== chain)
          throw new CheckError("missing authenticated Web3 identity");
        return "signed message accepted; temporary account removed";
      } finally {
        if (createdUser) {
          await client.auth.signOut();
          const { error } = await admin.auth.admin.deleteUser(createdUser);
          if (error) throw new CheckError("temporary account cleanup failed");
        }
      }
    });
  }
  await check("R2 signed upload, sealing and download", async () => {
    const s3 = storage(),
      Bucket = s3Env.S3_BUCKET;
    const id = randomUUID(),
      source = `_connection-check/${id}/upload.txt`,
      sealed = `_connection-check/${id}/sealed.txt`;
    const body = Buffer.from(`Sellmepls storage connection test ${id}\n`);
    try {
      await s3.send(new HeadBucketCommand({ Bucket }));
      const upload = {
        id,
        user_id: id,
        object_key: source,
        filename: "test.txt",
        bytes: body.length,
        checksum: createHash("sha256").update(body).digest("base64"),
        content_type: "text/plain",
        kind: "file",
        used: false,
      };
      const putUrl = await uploadUrl(upload);
      const response = await fetch(putUrl, {
        method: "PUT",
        headers: { "Content-Type": upload.content_type },
        body,
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok)
        throw new CheckError(`signed upload returned HTTP ${response.status}`);
      await sealUpload(upload, sealed);
      const signed = await downloadUrl(sealed, "test.txt");
      if (new URL(signed).searchParams.get("X-Amz-Expires") !== "900")
        throw new CheckError("incorrect download expiry");
      const download = await fetch(signed, {
        signal: AbortSignal.timeout(20000),
      });
      if (
        !download.ok ||
        !Buffer.from(await download.arrayBuffer()).equals(body)
      )
        throw new CheckError("download contents mismatch");
      const unsigned = new URL(signed);
      unsigned.search = "";
      const anonymous = await fetch(unsigned, {
        signal: AbortSignal.timeout(20000),
      });
      const rejectedByR2 =
        anonymous.status === 400 &&
        /<Code>InvalidArgument<\/Code><Message>Authorization<\/Message>/.test(
          await anonymous.text(),
        );
      if (!rejectedByR2 && ![401, 403].includes(anonymous.status))
        throw new CheckError(
          `unsigned S3 download returned HTTP ${anonymous.status}`,
        );
      const cors = await fetch(putUrl, {
        method: "OPTIONS",
        headers: {
          Origin: new URL(appUrl).origin,
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers": "content-type",
        },
        signal: AbortSignal.timeout(20000),
      });
      const origin = cors.headers.get("access-control-allow-origin");
      if (!cors.ok || ![new URL(appUrl).origin, "*"].includes(origin || ""))
        throw new CheckError(
          "upload/download work, but browser uploads require a bucket CORS rule",
        );
      return "private file round-trip, 15-minute URL and browser CORS verified; test files removed";
    } finally {
      const cleanup = await Promise.allSettled(
        [source, sealed].map((Key) =>
          s3.send(new DeleteObjectCommand({ Bucket, Key })),
        ),
      );
      if (cleanup.some((result) => result.status === "rejected"))
        throw new CheckError("temporary file cleanup failed");
      s3.destroy();
    }
  });
}
class CheckError extends Error {}
main().catch(() => {
  console.error(
    "Service check could not start: check .env.local configuration",
  );
  process.exitCode = 1;
});
