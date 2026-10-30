import { config } from "dotenv";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

config({ path: ".env.local", quiet: true });
const names = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "CRON_SECRET",
  "REFERRAL_SECRET",
  "QUOTE_SIGNER_PRIVATE_KEY",
  "INVENTORY_ENCRYPTION_KEY",
  "TRON_API_KEY",
];
const secrets = names.flatMap((name) =>
  process.env[name] ? [[name, process.env[name]]] : [],
);
if (process.env.SOLANA_RPC_URL) {
  const rpc = new URL(process.env.SOLANA_RPC_URL);
  secrets.push(["SOLANA_RPC_URL", rpc.href]);
  for (const value of rpc.searchParams.values())
    if (value.length >= 8) secrets.push(["Solana RPC credential", value]);
}
let scanned = 0;
const leaks = new Set();
function scan(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (/\.(js|json|map|html)$/.test(entry.name)) {
      const contents = readFileSync(file, "utf8");
      scanned++;
      for (const [name, secret] of secrets)
        if (contents.includes(secret)) leaks.add(name);
    }
  }
}
scan(".next/static");
scan(".next/dev/static");
if (!scanned)
  throw new Error("Build the application before checking client bundles");
if (leaks.size) {
  console.error(
    "FAIL server credentials in client assets:",
    [...leaks].join(", "),
  );
  process.exitCode = 1;
} else
  console.log(
    `PASS ${scanned} client assets checked; configured server credentials and Solana RPC key absent`,
  );
