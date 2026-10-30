import { GetObjectCommand } from "@aws-sdk/client-s3";
import { adminDb } from "@/lib/supabase/server";
import { storage } from "@/lib/storage";
import { storageEnv } from "@/lib/env";
import { failure, HttpError } from "@/lib/http";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = z
      .object({ id: z.string().uuid() })
      .parse(await context.params);
    const { data, error } = await adminDb()
      .from("products")
      .select("preview_key,gallery_keys,active,is_hidden,seller_id")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Товар не найден");
    const requestedImage = new URL(request.url).searchParams.get("image");
    const imageIndex =
      requestedImage === null
        ? null
        : z.coerce.number().int().min(0).max(4).parse(requestedImage);
    const key =
      imageIndex === null ? data.preview_key : data.gallery_keys[imageIndex];
    if (!key) throw new HttpError(404, "Фотография не найдена");
    if (!data.active || data.is_hidden) {
      try {
        const user = await requireUser();
        if (user.id !== data.seller_id && !isAdmin(user)) throw new Error();
      } catch {
        throw new HttpError(404, "Товар не найден");
      }
    }
    const file = await storage().send(
      new GetObjectCommand({
        Bucket: storageEnv().S3_BUCKET,
        Key: key,
      }),
    );
    if (!file.Body) throw new HttpError(404, "Превью не найдено");
    return new Response(file.Body.transformToWebStream(), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": data.active && !data.is_hidden
          ? "public, max-age=300"
          : "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
