import { z } from "zod";
import { requireUser, rateLimit } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/server";
import { sameOrigin, readJson, json, failure } from "@/lib/http";
import { payoutWallets } from "@/lib/profile";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    await rateLimit(`profile:${user.id}`, 10);
    const input = z
      .object({
        displayName: z.string().trim().min(2).max(60),
        bio: z.string().trim().max(1000),
        evmWallet: z.string().max(42),
        solanaWallet: z.string().max(44),
        tronWallet: z.string().max(34).default(""),
      })
      .parse(await readJson(request));
    const { error } = await adminDb()
      .from("users")
      .update({
        display_name: input.displayName,
        bio: input.bio,
        ...payoutWallets(input.evmWallet, input.solanaWallet, input.tronWallet),
      })
      .eq("id", user.id);
    if (error) throw error;
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
