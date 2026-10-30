import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const path = new URL("../.env.local", import.meta.url);
const text = readFileSync(path, "utf8");
if (/^INVENTORY_ENCRYPTION_KEY=.+$/m.test(text)) {
  console.log("Inventory encryption key already configured; preserved.");
} else {
  writeFileSync(
    path,
    text.replace(/^INVENTORY_ENCRYPTION_KEY=.*\r?\n?/m, "") +
      `\nINVENTORY_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}\n`,
  );
  console.log(
    "Inventory encryption key generated locally. Back up .env.local securely.",
  );
}
