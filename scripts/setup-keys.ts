import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
const path = ".env.local";
let content = readFileSync(existsSync(path) ? path : ".env.example", "utf8");
for (const name of [
  "CRON_SECRET",
  "REFERRAL_SECRET",
  "QUOTE_SIGNER_PRIVATE_KEY",
  "INVENTORY_ENCRYPTION_KEY",
]) {
  const expression = new RegExp(`^${name}=(.*)$`, "m");
  const existing = content.match(expression)?.[1].trim();
  if (existing) continue;
  const value =
    name === "QUOTE_SIGNER_PRIVATE_KEY"
      ? generatePrivateKey()
      : randomBytes(32).toString("hex");
  content = expression.test(content)
    ? content.replace(expression, `${name}=${value}`)
    : `${content}\n${name}=${value}\n`;
}
writeFileSync(path, content, { mode: 0o600 });
const key = content
  .match(/^QUOTE_SIGNER_PRIVATE_KEY=(.*)$/m)![1]
  .trim() as `0x${string}`;
console.log("Secrets saved locally in .env.local. Existing values preserved.");
console.log(`Public quote signer address: ${privateKeyToAccount(key).address}`);
