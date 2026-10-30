import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
const env = existsSync(".env.local") ? parse(readFileSync(".env.local")) : {};
const secrets = Object.entries(env).filter(([name, value]) =>
  !name.startsWith("NEXT_PUBLIC_") && /SECRET|PRIVATE_KEY|SERVICE_ROLE|ENCRYPTION_KEY|ACCESS_KEY|API_KEY/.test(name) && value.length >= 8);
for (const [name, value] of Object.entries(env)) {
  if (!name.endsWith("RPC_URL") || name.startsWith("NEXT_PUBLIC_")) continue;
  try {
    const url = new URL(value);
    for (const [key, token] of url.searchParams) if (/key|token|auth/i.test(key) && token.length >= 8) secrets.push([name, token]);
  } catch {}
}
const files = execFileSync("git", ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"], { encoding: "utf8" }).split("\0").filter(Boolean);
const issues = [];
for (const file of files) {
  if ((/(^|\/)\.env/.test(file) && file !== ".env.example") || /^(\.vercel|node_modules|\.next|artifacts|logs)\//.test(file) || /\.(pem|key|p12|pfx|exe|log)$/.test(file)) issues.push(file + ": private/local file");
  const text = execFileSync("git", ["show", ":" + file], { maxBuffer: 32 * 1024 * 1024 }).toString("utf8");
  for (const [name, secret] of secrets) if (text.includes(secret)) issues.push(file + ": configured " + name);
  if (/sb_secret_[A-Za-z0-9_-]{20,}/.test(text)) issues.push(file + ": Supabase secret token");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) issues.push(file + ": private key block");
  for (const match of text.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try { if (JSON.parse(Buffer.from(match[1], "base64url").toString()).role === "service_role") issues.push(file + ": service role JWT"); } catch {}
  }
}
if (issues.length) { console.error([...new Set(issues)].join("\n")); process.exitCode = 1; }
else console.log("PASS: " + files.length + " staged files checked; configured secrets and private/local files absent.");
