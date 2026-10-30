"use server";
import { isEvmNetwork } from "@/lib/network";
import { isTronAddress } from "@/lib/tron-address";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getAddress, isAddress, zeroAddress } from "viem";
import { PublicKey } from "@solana/web3.js";
import { requireUser, rateLimit } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/server";
import {
  ASSETS,
  atomicPrice,
  isAssetOffered,
  split,
  type Price,
} from "@/lib/catalog";
import { feeQuote, platformFee } from "@/lib/pricing";
import { sealUpload, type Upload } from "@/lib/storage";
import { HttpError } from "@/lib/http";
import { isCategory } from "@/lib/categories";
import { MAX_GALLERY_IMAGES, youtubeVideoId } from "@/lib/media";
import { readInventory, removeInventorySource } from "@/lib/inventory";
const listing = z.object({
  deliveryMode: z.enum(["file", "stock"]).default("file"),
  galleryUploadIds: z
    .array(z.string().uuid())
    .max(MAX_GALLERY_IMAGES)
    .default([]),
  galleryKeep: z.array(z.string().max(500)).max(MAX_GALLERY_IMAGES).default([]),
  youtubeUrl: z
    .string()
    .max(500)
    .default("")
    .transform((value, ctx) => {
      try {
        return youtubeVideoId(value);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            error instanceof Error ? error.message : "Неверная ссылка YouTube",
        });
        return z.NEVER;
      }
    }),
  category: z.string().refine(isCategory),
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().min(10).max(5000),
  fileId: z.string().uuid(),
  previewId: z.string().uuid(),
  prices: z
    .array(
      z.object({
        asset: z.string().refine(isAssetOffered),
        amount: z.string().max(32),
      }),
    )
    .min(1)
    .max(Object.keys(ASSETS).length),
  evmWallet: z.string().max(42),
  solanaWallet: z.string().max(44),
  tronWallet: z.string().max(34).default(""),
  affiliateEnabled: z.boolean(),
  affiliateBps: z.number().int().min(100).max(9000),
});
const editing = listing.omit({ fileId: true, previewId: true }).extend({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  fileId: z.string().uuid().optional(),
  previewId: z.string().uuid().optional(),
});
async function validateListing(
  input: z.infer<typeof listing> | z.infer<typeof editing>,
) {
  const prices = input.prices as Price[];
  if (
    input.galleryKeep.length + input.galleryUploadIds.length >
      MAX_GALLERY_IMAGES ||
    new Set(input.galleryUploadIds).size !== input.galleryUploadIds.length
  )
    throw new HttpError(
      400,
      "Добавьте не больше пяти дополнительных изображений без повторов",
    );
  if (new Set(prices.map((p) => p.asset)).size !== prices.length)
    throw new HttpError(400, "Валюта указана дважды");
  for (const price of prices) {
    let amount;
    try {
      amount = atomicPrice(price);
    } catch {
      throw new HttpError(
        400,
        `Проверьте сумму и количество знаков после точки: ${price.asset}`,
      );
    }
    let quote;
    try {
      quote = await feeQuote(price.asset);
    } catch {
      throw new HttpError(
        503,
        "Не удалось получить свежий курс для проверки цены. Попробуйте позже.",
      );
    }
    try {
      const commission = platformFee(amount, price.asset, quote.rate);
      split(
        amount,
        commission.fixedFee,
        input.affiliateEnabled ? input.affiliateBps : 0,
        commission.feeBps,
      );
    } catch {
      throw new HttpError(
        400,
        `Цена ${price.asset} не покрывает комиссии. Увеличьте её.`,
      );
    }
  }
  const needsEvm = prices.some((p) => isEvmNetwork(ASSETS[p.asset].network)),
    needsSol = prices.some((p) => ASSETS[p.asset].network === "solana");
  if (
    needsEvm &&
    (!isAddress(input.evmWallet) ||
      input.evmWallet.toLowerCase() === zeroAddress)
  )
    throw new HttpError(400, "Укажите EVM кошелёк для выплат");
  if (needsSol) {
    try {
      if (!PublicKey.isOnCurve(new PublicKey(input.solanaWallet).toBytes()))
        throw new Error();
    } catch {
      throw new HttpError(400, "Укажите Solana кошелёк для выплат");
    }
  }
  if (
    prices.some((p) => ASSETS[p.asset].network === "tron") &&
    !isTronAddress(input.tronWallet)
  )
    throw new HttpError(400, "Укажите TRON кошелёк для выплат");
  return {
    prices,
    wallets: {
      ...(prices.some((p) => ASSETS[p.asset].network === "tron")
        ? { tron_wallet: input.tronWallet }
        : {}),
      ...(needsEvm ? { evm_wallet: getAddress(input.evmWallet) } : {}),
      ...(needsSol
        ? { solana_wallet: new PublicKey(input.solanaWallet).toBase58() }
        : {}),
    },
  };
}
function revalidateProduct(id: string, seller: string) {
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/products/${id}/edit`);
  revalidatePath(`/p/${id}`);
  revalidatePath(`/s/${seller}`);
  revalidatePath("/");
}
export async function updateProduct(
  raw: unknown,
): Promise<{ id?: string; error?: string }> {
  try {
    const user = await requireUser();
    await rateLimit(`edit:${user.id}`, 30, 3600);
    const input = editing.parse(raw),
      db = adminDb();
    const current = await db
      .from("products")
      .select("id,revision,delivery_mode")
      .eq("id", input.id)
      .eq("seller_id", user.id)
      .maybeSingle();
    if (current.error) throw current.error;
    if (!current.data)
      throw new HttpError(
        404,
        "Товар не найден или принадлежит другому продавцу",
      );
    if (
      input.deliveryMode !== current.data.delivery_mode ||
      (current.data.delivery_mode === "stock" && input.fileId)
    )
      throw new HttpError(
        400,
        "Тип выдачи нельзя менять. Пополняйте поштучный товар через раздел «Склад»",
      );
    if (current.data.revision !== input.revision)
      throw new HttpError(
        409,
        "Товар уже изменён в другой вкладке. Обновите страницу и повторите изменения.",
      );
    // Payout wallets are account settings. Editing a listing never changes them.
    const profile = await db
      .from("users")
      .select("evm_wallet,solana_wallet,tron_wallet")
      .eq("id", user.id)
      .single();
    if (profile.error) throw profile.error;
    const { prices } = await validateListing({
      ...input,
      evmWallet: profile.data.evm_wallet || "",
      solanaWallet: profile.data.solana_wallet || "",
      tronWallet: profile.data.tron_wallet || "",
    });
    const ids = [
      input.fileId,
      input.previewId,
      ...input.galleryUploadIds,
    ].filter((id): id is string => !!id);
    let uploads: Upload[] = [];
    if (ids.length) {
      const result = await db
        .from("uploads")
        .select("*")
        .eq("user_id", user.id)
        .eq("used", false)
        .in("id", ids);
      if (result.error) throw result.error;
      uploads = result.data as Upload[];
    }
    const file = uploads.find(
        (u) => u.id === input.fileId && u.kind === "file",
      ),
      preview = uploads.find(
        (u) => u.id === input.previewId && u.kind === "preview",
      );
    if ((input.fileId && !file) || (input.previewId && !preview))
      throw new HttpError(
        400,
        "Новый файл или превью недоступны. Выберите и загрузите их снова.",
      );
    const gallery = input.galleryUploadIds.map((id) =>
      uploads.find((u) => u.id === id && u.kind === "preview"),
    );
    if (
      gallery.some((u) => !u) ||
      input.galleryUploadIds.includes(input.previewId || "")
    )
      throw new HttpError(
        400,
        "Загрузите отдельные изображения галереи заново",
      );
    const version = crypto.randomUUID(),
      fileKey = file
        ? `products/${user.id}/${input.id}/versions/${version}/download`
        : null,
      previewKey = preview ? `previews/${input.id}/${version}.webp` : null;
    const galleryKeys = gallery.map(
      (_u, index) => `previews/${input.id}/${version}-gallery-${index}.webp`,
    );
    await Promise.all([
      ...(file && fileKey ? [sealUpload(file, fileKey)] : []),
      ...(preview && previewKey ? [sealUpload(preview, previewKey)] : []),
      ...gallery.map((u, index) => sealUpload(u!, galleryKeys[index])),
    ]);
    const result = await db.rpc("edit_product_v2", {
      p_gallery_keep: input.galleryKeep,
      p_gallery_uploads: input.galleryUploadIds,
      p_gallery_keys: galleryKeys,
      p_youtube: input.youtubeUrl,
      p_user: user.id,
      p_product: input.id,
      p_revision: input.revision,
      p_title: input.title,
      p_description: input.description,
      p_prices: prices,
      p_category: input.category,
      p_affiliate_enabled: input.affiliateEnabled,
      p_affiliate_bps: input.affiliateBps,
      p_file: file?.id || null,
      p_preview: preview?.id || null,
      p_file_key: fileKey,
      p_preview_key: previewKey,
    });
    if (result.error) {
      if (result.error.message.includes("product_edit_conflict"))
        throw new HttpError(
          409,
          "Товар уже изменён в другой вкладке. Обновите страницу и повторите изменения.",
        );
      if (/invalid_.*upload/.test(result.error.message))
        throw new HttpError(
          400,
          "Файл уже использован. Выберите и загрузите его снова.",
        );
      throw result.error;
    }
    revalidateProduct(input.id, user.id);
    return { id: input.id };
  } catch (error) {
    if (error instanceof HttpError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: error.issues[0].message };
    console.error(
      "Product edit failed",
      error instanceof Error ? error.name : "Database error",
    );
    return {
      error:
        "Не удалось сохранить товар. Проверьте данные и повторите попытку.",
    };
  }
}
export async function publishProduct(
  raw: unknown,
): Promise<{ id?: string; error?: string }> {
  try {
    const user = await requireUser();
    await rateLimit(`publish:${user.id}`, 15, 3600);
    const input = listing.parse(raw);
    const { prices, wallets } = await validateListing(input);
    const db = adminDb();
    const { error: profileError } = await db
      .from("users")
      .update(wallets)
      .eq("id", user.id);
    if (profileError) throw profileError;
    const { data: uploads, error } = await db
      .from("uploads")
      .select("*")
      .eq("user_id", user.id)
      .eq("used", false)
      .in("id", [input.fileId, input.previewId, ...input.galleryUploadIds]);
    if (error) throw error;
    const file = uploads.find(
        (u) => u.id === input.fileId && u.kind === "file",
      ) as Upload | undefined,
      preview = uploads.find(
        (u) => u.id === input.previewId && u.kind === "preview",
      ) as Upload | undefined;
    if (!file || !preview) throw new HttpError(400, "Загрузите файл и превью");
    const gallery = input.galleryUploadIds.map(
      (id) =>
        uploads.find((u) => u.id === id && u.kind === "preview") as
          Upload | undefined,
    );
    if (
      input.galleryKeep.length ||
      gallery.some((u) => !u) ||
      input.galleryUploadIds.includes(input.previewId)
    )
      throw new HttpError(
        400,
        "Загрузите отдельные изображения галереи заново",
      );
    const id = crypto.randomUUID(),
      fileKey = `products/${user.id}/${id}/download`,
      previewKey = `previews/${id}.webp`;
    const galleryKeys = gallery.map(
      (_u, index) => `previews/${id}/gallery-${index}.webp`,
    );
    const items =
      input.deliveryMode === "stock" ? await readInventory(file, id) : null;
    await Promise.all([
      ...(items ? [] : [sealUpload(file, fileKey)]),
      sealUpload(preview, previewKey),
      ...gallery.map((u, index) => sealUpload(u!, galleryKeys[index])),
    ]);
    const { error: publishError } = await db.rpc("publish_product_v4", {
      p_items: items,
      p_fields: {
        p_gallery_uploads: input.galleryUploadIds,
        p_gallery_keys: galleryKeys,
        p_youtube: input.youtubeUrl,
        p_category: input.category,
        p_user: user.id,
        p_product: id,
        p_title: input.title,
        p_description: input.description,
        p_prices: prices,
        p_file: file.id,
        p_preview: preview.id,
        p_file_key: items ? file.object_key : fileKey,
        p_preview_key: previewKey,
        p_affiliate_enabled: input.affiliateEnabled,
        p_affiliate_bps: input.affiliateBps,
      },
    });
    if (publishError) throw publishError;
    if (items) await removeInventorySource(file);
    revalidateProduct(id, user.id);
    return { id };
  } catch (error) {
    if (error instanceof HttpError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: error.issues[0].message };
    console.error(
      "Publish failed",
      error instanceof Error ? error.name : "Database error",
    );
    return {
      error:
        "Не удалось опубликовать товар. Проверьте цену, файлы и настройки сервиса.",
    };
  }
}
export async function restockProduct(
  raw: unknown,
): Promise<{ added?: number; error?: string }> {
  try {
    const user = await requireUser();
    await rateLimit(`restock:${user.id}`, 20, 3600);
    const input = z
      .object({ productId: z.string().uuid(), uploadId: z.string().uuid() })
      .parse(raw);
    const db = adminDb();
    const product = await db
      .from("products")
      .select("id")
      .eq("id", input.productId)
      .eq("seller_id", user.id)
      .eq("delivery_mode", "stock")
      .maybeSingle();
    if (product.error) throw product.error;
    if (!product.data) throw new HttpError(404, "Поштучный товар не найден");
    const file = await db
      .from("uploads")
      .select("*")
      .eq("id", input.uploadId)
      .eq("user_id", user.id)
      .eq("used", false)
      .single();
    if (file.error) throw new HttpError(400, "Загрузите TXT повторно");
    const items = await readInventory(file.data as Upload, input.productId);
    const result = await db.rpc("restock_product", {
      p_user: user.id,
      p_product: input.productId,
      p_upload: input.uploadId,
      p_items: items,
    });
    if (result.error) {
      if (result.error.message.includes("inventory_duplicates"))
        throw new HttpError(
          400,
          "Все эти строки уже загружены. Проданные единицы повторно не добавляются",
        );
      throw result.error;
    }
    await removeInventorySource(file.data as Upload);
    revalidateProduct(input.productId, user.id);
    return { added: Number(result.data) };
  } catch (error) {
    return {
      error:
        error instanceof HttpError
          ? error.message
          : "Не удалось пополнить склад. Проверьте TXT и повторите попытку",
    };
  }
}
export async function setAffiliateProgram(
  id: string,
  enabled: boolean,
  bps: number,
) {
  const user = await requireUser();
  await rateLimit(`program:${user.id}`, 20);
  z.string().uuid().parse(id);
  z.boolean().parse(enabled);
  z.number().int().min(100).max(9000).parse(bps);
  const db = adminDb();
  const product = await db
    .from("products")
    .select("prices,revision")
    .eq("id", id)
    .eq("seller_id", user.id)
    .single();
  if (product.error) throw new Error("Товар не найден");
  for (const price of product.data.prices as Price[]) {
    const quote = await feeQuote(price.asset);
    const amount = atomicPrice(price),
      commission = platformFee(amount, price.asset, quote.rate);
    split(amount, commission.fixedFee, enabled ? bps : 0, commission.feeBps);
  }
  const { data: updated, error } = await db
    .from("products")
    .update({ affiliate_enabled: enabled, affiliate_bps: bps })
    .eq("id", id)
    .eq("seller_id", user.id)
    .eq("revision", product.data.revision)
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Не удалось сохранить условия программы");
  if (!updated)
    throw new Error(
      "Товар изменён в другой вкладке. Обновите страницу и повторите.",
    );
  revalidateProduct(id, user.id);
}
export async function setProductActive(id: string, active: boolean) {
  const user = await requireUser();
  await rateLimit(`visibility:${user.id}`, 30);
  z.string().uuid().parse(id);
  z.boolean().parse(active);
  const { error } = await adminDb()
    .from("products")
    .update({ active })
    .eq("id", id)
    .eq("seller_id", user.id);
  if (error) throw new Error("Не удалось обновить товар");
  revalidatePath("/dashboard");
  revalidatePath(`/p/${id}`);
  revalidatePath("/");
}
