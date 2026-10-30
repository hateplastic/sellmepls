import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { storageEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { validateFileHeader } from "@/lib/file-policy";
export function storage() {
  const e = storageEnv();
  return new S3Client({
    region: e.S3_REGION,
    endpoint: e.S3_ENDPOINT || undefined,
    forcePathStyle: e.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}
export type Upload = {
  id: string;
  user_id: string;
  object_key: string;
  filename: string;
  bytes: number;
  checksum: string;
  content_type: string;
  kind: string;
  used: boolean;
};
export async function uploadUrl(upload: Upload) {
  return getSignedUrl(
    storage(),
    new PutObjectCommand({
      Bucket: storageEnv().S3_BUCKET,
      Key: upload.object_key,
      ContentLength: upload.bytes,
      ContentType: upload.content_type,
    }),
    {
      expiresIn: 600,
      signableHeaders: new Set(["content-type", "content-length"]),
    },
  );
}
export async function sealUpload(upload: Upload, key: string) {
  const s3 = storage(),
    Bucket = storageEnv().S3_BUCKET;
  const head = await s3.send(
    new HeadObjectCommand({ Bucket, Key: upload.object_key }),
  );
  if (
    head.ContentLength !== Number(upload.bytes) ||
    head.ContentType !== upload.content_type ||
    !head.ETag
  )
    throw new HttpError(400, "Размер или тип файла не совпадают");
  const input = await s3.send(
    new GetObjectCommand({
      Bucket,
      Key: upload.object_key,
      IfMatch: head.ETag,
    }),
  );
  if (!input.Body) throw new HttpError(400, "Пустой файл");
  const reader = input.Body.transformToWebStream().getReader(),
    digest = createHash("sha256"),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  let header = Buffer.alloc(0);
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > Number(upload.bytes)) {
        await reader.cancel();
        throw new HttpError(400, "Размер файла изменился");
      }
      digest.update(part.value);
      if (header.length < 8192) header = Buffer.concat([header, Buffer.from(part.value.subarray(0, 8192 - header.length))]);
      if (upload.kind === "preview") chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (
    bytes !== Number(upload.bytes) ||
    digest.digest("base64") !== upload.checksum
  )
    throw new HttpError(400, "Контрольная сумма файла не совпадает");
  if (upload.kind === "file") {
    try { validateFileHeader(upload.filename, header); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Недопустимое содержимое файла"); }
  }
  if (upload.kind === "preview") {
    const image = sharp(Buffer.concat(chunks), {
      limitInputPixels: 40_000_000,
    });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format || ""))
      throw new HttpError(400, "Неподдерживаемый формат превью");
    const webp = await image
      .rotate()
      .resize(1600, 1200, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    await s3.send(
      new PutObjectCommand({
        Bucket,
        Key: key,
        Body: webp,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  } else {
    await s3.send(
      new CopyObjectCommand({
        Bucket,
        Key: key,
        CopySource: `${Bucket}/${upload.object_key.split("/").map(encodeURIComponent).join("/")}`,
        CopySourceIfMatch: head.ETag,
        MetadataDirective: "REPLACE",
        ContentType: "application/octet-stream",
        ContentDisposition: "attachment",
      }),
    );
  }
}
export async function downloadUrl(key: string, name: string) {
  const safe =
    name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "download";
  return getSignedUrl(
    storage(),
    new GetObjectCommand({
      Bucket: storageEnv().S3_BUCKET,
      Key: key,
      ResponseContentType: "application/octet-stream",
      ResponseContentDisposition: `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
    }),
    { expiresIn: 900 },
  );
}
