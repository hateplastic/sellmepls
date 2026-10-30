import { z } from "zod";
import { requireUser, rateLimit } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/server";
import { storageEnv } from "@/lib/env";
import { sameOrigin, readJson, json, failure, HttpError } from "@/lib/http";
import { uploadUrl, type Upload } from "@/lib/storage";
import { fileExtension } from "@/lib/file-policy";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    await rateLimit(`upload:${user.id}`, 30, 3600);
    const input = z
      .object({
        kind: z.enum(["file", "preview"]),
        filename: z
          .string()
          .min(1)
          .max(180)
          .regex(/^[^\x00-\x1f/\\]+$/),
        bytes: z.number().int().positive(),
        contentType: z.string().min(1).max(100),
        checksum: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
      })
      .parse(await readJson(request));
    if (
      input.bytes >
      (input.kind === "preview" ? 5_242_880 : storageEnv().MAX_FILE_BYTES)
    )
      throw new HttpError(413, "Превышен лимит размера файла");
    if (
      input.kind === "preview" &&
      !["image/jpeg", "image/png", "image/webp"].includes(input.contentType)
    )
      throw new HttpError(400, "Превью: JPEG, PNG или WebP");
    const id = crypto.randomUUID();
    if (input.kind === "file") {
      try { fileExtension(input.filename); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Неподдерживаемый файл"); }
    }
    const upload: Upload = {
      id,
      user_id: user.id,
      kind: input.kind,
      filename: input.filename,
      bytes: input.bytes,
      checksum: input.checksum,
      content_type:
        input.kind === "file" ? "application/octet-stream" : input.contentType,
      object_key: `staging/${user.id}/${id}`,
      used: false,
    };
    const { error } = await adminDb().from("uploads").insert(upload);
    if (error) throw error;
    return json({
      id,
      url: await uploadUrl(upload),
      contentType: upload.content_type,
      checksum: upload.checksum,
    });
  } catch (error) {
    return failure(error);
  }
}
