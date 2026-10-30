import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export const MAX_INVENTORY_BYTES = 8 * 1024 * 1024;
export const MAX_INVENTORY_LINES = 10_000;
export const MAX_ORDER_QUANTITY = 1000;
export type SealedUnit = { fingerprint: string; ciphertext: string };

export function parseInventory(bytes: Uint8Array): string[] {
  if (!bytes.length || bytes.length > MAX_INVENTORY_BYTES)
    throw new Error("TXT должен быть от 1 байта до 8 MB");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Сохраните TXT в кодировке UTF-8");
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(text))
    throw new Error("TXT содержит недопустимые управляющие символы");
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim().length);
  if (!lines.length || lines.length > MAX_INVENTORY_LINES)
    throw new Error("В одной партии должно быть от 1 до 10 000 непустых строк");
  if (lines.some((line) => Buffer.byteLength(line, "utf8") > 4096))
    throw new Error(
      "Одна единица товара должна занимать одну строку, не длиннее 4096 байт",
    );
  if (new Set(lines).size !== lines.length)
    throw new Error(
      "В TXT есть одинаковые строки. Удалите дубликаты перед загрузкой",
    );
  return lines;
}

function key(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error("INVENTORY_ENCRYPTION_KEY must be 32 bytes in hex");
  return Buffer.from(value, "hex");
}
export function sealUnit(
  line: string,
  product: string,
  secret: string,
): SealedUnit {
  const fingerprint = createHash("sha256").update(line).digest("hex");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(`${product}:${fingerprint}`));
  const body = Buffer.concat([cipher.update(line, "utf8"), cipher.final()]);
  return {
    fingerprint,
    ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]).toString(
      "base64",
    ),
  };
}
export function openUnit(
  unit: SealedUnit,
  product: string,
  secret: string,
): string {
  const data = Buffer.from(unit.ciphertext, "base64");
  if (data.length < 29) throw new Error("Invalid inventory ciphertext");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(secret),
    data.subarray(0, 12),
  );
  cipher.setAuthTag(data.subarray(12, 28));
  cipher.setAAD(Buffer.from(`${product}:${unit.fingerprint}`));
  return Buffer.concat([
    cipher.update(data.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
