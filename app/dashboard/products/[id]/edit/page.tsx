import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/server";
import { storageEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { WalletAuth } from "@/components/wallet-auth";
import { ProductForm } from "@/components/product-form";
import type { Product } from "@/lib/catalog";
import { inventoryCounts } from "@/lib/inventory";
import { InventoryPanel } from "@/components/inventory-panel";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export default async function EditProduct({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) throw error;
    return (
      <section className="shell py-20">
        <h1 className="text-3xl mb-6">Войдите кошельком продавца</h1>
        <WalletAuth />
      </section>
    );
  }
  const db = adminDb();
  const [product, profile] = await Promise.all([
    db
      .from("products")
      .select("*")
      .eq("id", id)
      .eq("seller_id", user.id)
      .maybeSingle(),
    db
      .from("users")
      .select("evm_wallet,solana_wallet,tron_wallet")
      .eq("id", user.id)
      .single(),
  ]);
  if (product.error || profile.error) throw product.error || profile.error;
  if (!product.data) notFound();
  return (
    <section className="shell max-w-4xl py-12">
      <Link href="/dashboard" className="inline-block text-muted mb-6">
        ← Мои товары
      </Link>
      <ProductForm
        key={`${id}:${product.data.revision}`}
        product={product.data as Product}
        evmWallet={profile.data.evm_wallet || ""}
        tronWallet={profile.data.tron_wallet || ""}
        solanaWallet={profile.data.solana_wallet || ""}
        maxBytes={storageEnv().MAX_FILE_BYTES}
      />
      {product.data.delivery_mode === "stock" && (
        <InventoryPanel productId={id} counts={await inventoryCounts(id)} />
      )}
    </section>
  );
}
