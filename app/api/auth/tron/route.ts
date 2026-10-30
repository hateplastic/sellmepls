import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { rateLimit } from "@/lib/auth";
import { adminDb, sessionDb } from "@/lib/supabase/server";
import { sameOrigin, readJson, json, failure, HttpError } from "@/lib/http";
import { appEnv } from "@/lib/env";
import { isTronAddress } from "@/lib/tron-address";
import { tronLoginEmail, verifyTronSignature } from "@/lib/tron-auth";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const input = z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("challenge"),
          address: z.string().refine(isTronAddress),
        }),
        z.object({
          action: z.literal("verify"),
          id: z.string().uuid(),
          signature: z.string().regex(/^(0x)?[a-fA-F0-9]{130}$/),
        }),
      ])
      .parse(await readJson(request));
    const db = adminDb(),
      jar = await cookies();
    if (input.action === "challenge") {
      await rateLimit("tron-login:global", 1000, 3600);
      await rateLimit(`tron-login:${input.address}`, 20, 3600);
      const origin = new URL(appEnv().NEXT_PUBLIC_APP_URL).origin,
        id = crypto.randomUUID(),
        expires = new Date(Date.now() + 300000).toISOString();
      const message = `${origin} requests a TRON wallet sign-in.\nAddress: ${input.address}\nURI: ${origin}\nNonce: ${randomBytes(24).toString("hex")}\nRequest ID: ${id}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${expires}\nSign-in only. This does not authorize payments.`;
      const inserted = await db
        .from("wallet_challenges")
        .insert({ id, address: input.address, message, expires_at: expires });
      if (inserted.error) throw inserted.error;
      jar.set("tron-login", id, {
        httpOnly: true,
        sameSite: "strict",
        secure: origin.startsWith("https:"),
        path: "/",
        maxAge: 300,
      });
      return json({ id, message });
    }
    if (jar.get("tron-login")?.value !== input.id)
      throw new HttpError(403, "Начните вход TRON заново в этой вкладке");
    const challenge = await db
      .from("wallet_challenges")
      .select("*")
      .eq("id", input.id)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (challenge.error) throw challenge.error;
    if (!challenge.data)
      throw new HttpError(403, "Запрос входа истёк или уже использован");
    await rateLimit(`tron-verify:${challenge.data.address}`, 30);
    await verifyTronSignature(
      challenge.data.message,
      input.signature,
      challenge.data.address,
    );
    const consumed = await db
      .from("wallet_challenges")
      .update({ used: true })
      .eq("id", input.id)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .select("id");
    if (consumed.error) throw consumed.error;
    if (!consumed.data?.length)
      throw new HttpError(409, "Подпись входа уже использована");
    const email = await tronLoginEmail(challenge.data.address);
    const link = await db.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) throw link.error;
    const session = await sessionDb();
    const verified = await session.auth.verifyOtp({
      token_hash: link.data.properties.hashed_token,
      type: "email",
    });
    if (verified.error) throw verified.error;
    jar.delete("tron-login");
    return json({ ok: true, address: challenge.data.address });
  } catch (error) {
    return failure(error);
  }
}
