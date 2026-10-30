import "server-only";
import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { storage, downloadUrl, type Upload } from "@/lib/storage";
import { storageEnv } from "@/lib/env";
import { adminDb } from "@/lib/supabase/server";
import { HttpError } from "@/lib/http";
import {
  parseInventory,
  sealUnit,
  openUnit,
  MAX_INVENTORY_BYTES,
  type SealedUnit,
} from "@/lib/inventory-format";
import type { Sale } from "@/lib/catalog";

function secret() {
  const value = process.env.INVENTORY_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new Error("INVENTORY_ENCRYPTION_KEY missing/invalid");
  return value;
}
export async function readInventory(upload: Upload, product: string) {
  if (
    upload.kind !== "file" ||
    !/\.txt$/i.test(upload.filename) ||
    Number(upload.bytes) > MAX_INVENTORY_BYTES
  )
    throw new HttpError(
      400,
      "Для поштучной продажи загрузите TXT до 8 MB: одна строка — одна единица",
    );
  const object = await storage().send(
    new GetObjectCommand({
      Bucket: storageEnv().S3_BUCKET,
      Key: upload.object_key,
    }),
  );
  if (!object.Body || object.ContentLength !== Number(upload.bytes))
    throw new HttpError(400, "Размер TXT изменился");
  const reader = object.Body.transformToWebStream().getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > Number(upload.bytes) || length > MAX_INVENTORY_BYTES) {
        await reader.cancel();
        throw new HttpError(400, "TXT слишком большой");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  if (
    length !== Number(upload.bytes) ||
    createHash("sha256").update(bytes).digest("base64") !== upload.checksum
  )
    throw new HttpError(400, "Контрольная сумма TXT не совпадает");
  let lines: string[];
  try {
    lines = parseInventory(bytes);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  const encryptionKey = secret();
  return lines.map((line) => sealUnit(line, product, encryptionKey));
}
export async function removeInventorySource(upload: Upload) {
  // The signed PUT can be reused until expiry. A bucket lifecycle for staging/
  // remains necessary even after this best-effort deletion.
  try {
    await storage().send(
      new DeleteObjectCommand({
        Bucket: storageEnv().S3_BUCKET,
        Key: upload.object_key,
      }),
    );
  } catch {
    console.error("Inventory staging cleanup failed");
  }
}
export async function inventoryDownload(sale: Sale) {
  if (sale.status !== "paid" || sale.delivery_mode !== "stock" || !sale.tx_hash)
    throw new HttpError(403, "Нужна подтверждённая оплата");
  const { data, error } = await adminDb()
    .from("inventory_units")
    .select("fingerprint,ciphertext")
    .eq("sale_id", sale.id)
    .order("id");
  if (error) throw error;
  if (data.length !== sale.quantity)
    throw new Error("Inventory fulfillment mismatch");
  const encryptionKey = secret();
  const body =
    (data as SealedUnit[])
      .map((unit) => openUnit(unit, sale.product_id, encryptionKey))
      .join("\r\n") + "\r\n";
  const objectKey = `deliveries/${sale.buyer_id}/${sale.id}.txt`;
  await storage().send(
    new PutObjectCommand({
      Bucket: storageEnv().S3_BUCKET,
      Key: objectKey,
      Body: body,
      ContentType: "application/octet-stream",
      ContentDisposition: "attachment",
      CacheControl: "private, no-store",
    }),
  );
  return downloadUrl(objectKey, `order-${sale.id}-${sale.quantity}-items.txt`);
}
export async function inventoryCounts(product: string) {
  const { data, error } = await adminDb().rpc("inventory_counts", {
    p_product: product,
  });
  if (error) throw error;
  return data as { available: number; reserved: number; sold: number };
}
