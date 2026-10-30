import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomUUID } from "node:crypto";
import { adminDb } from "@/lib/supabase/server";
import { referralEnv } from "@/lib/env";
import { rateLimit } from "@/lib/auth";
import { failure, HttpError } from "@/lib/http";
import {
  readValue,
  readAttributions,
  signValue,
  REFERRAL_TTL,
} from "@/lib/referral-token";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    if (!/^[A-Za-z0-9_-]{16,32}$/.test(code))
      throw new HttpError(404, "Ссылка не найдена");
    const e = referralEnv(),
      db = adminDb();
    const hash = (value: string) =>
      createHmac("sha256", e.REFERRAL_SECRET).update(value).digest("hex");
    await rateLimit(
      `ref:${hash(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown")}`,
      120,
    );
    const { data: link, error } = await db
      .from("affiliate_links")
      .select("*")
      .eq("code", code)
      .maybeSingle();
    if (error) throw error;
    if (!link) throw new HttpError(404, "Ссылка не найдена");
    let products = db
      .from("products")
      .select("id")
      .eq("seller_id", link.seller_id)
      .eq("active", true).eq("is_hidden", false)
      .eq("affiliate_enabled", true)
      .limit(1);
    if (link.product_id) products = products.eq("id", link.product_id);
    const available = await products;
    if (available.error) throw available.error;
    const response = NextResponse.redirect(
      new URL(
        link.product_id ? `/p/${link.product_id}` : `/s/${link.seller_id}`,
        e.NEXT_PUBLIC_APP_URL,
      ),
      302,
    );
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    if (!available.data.length) return response;
    let visitor = readValue(
      request.cookies.get("sellmepls_visitor")?.value,
      e.REFERRAL_SECRET,
    );
    if (typeof visitor !== "string" || !/^[a-f0-9-]{36}$/.test(visitor))
      visitor = randomUUID();
    const target = link.product_id
      ? `p:${link.product_id}`
      : `s:${link.seller_id}`;
    const refs = readAttributions(
      request.cookies.get("sellmepls_ref")?.value,
      e.REFERRAL_SECRET,
    )
      .filter((v) => v.target !== target)
      .slice(-9);
    refs.push({ code, target, at: Date.now() });
    const options = {
      httpOnly: true,
      secure: e.NEXT_PUBLIC_APP_URL.startsWith("https:"),
      sameSite: "lax" as const,
      path: "/",
      maxAge: REFERRAL_TTL,
    };
    response.cookies.set(
      "sellmepls_ref",
      signValue(refs, e.REFERRAL_SECRET),
      options,
    );
    response.cookies.set(
      "sellmepls_visitor",
      signValue(visitor, e.REFERRAL_SECRET),
      options,
    );
    const click = await db
      .from("affiliate_clicks")
      .upsert(
        { link_id: link.id, visitor_hash: hash(visitor as string) },
        { onConflict: "link_id,visitor_hash,day", ignoreDuplicates: true },
      );
    if (click.error) throw click.error;
    return response;
  } catch (error) {
    return failure(error);
  }
}
