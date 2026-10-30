import { timingSafeEqual } from "node:crypto";
import { cronEnv } from "@/lib/env";
import { reconcile } from "@/lib/reconcile";
import { json, failure, HttpError } from "@/lib/http";
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return POST(request);
}
export async function POST(request: Request) {
  try {
    const actual = Buffer.from(request.headers.get("authorization") || ""),
      expected = Buffer.from(`Bearer ${cronEnv().CRON_SECRET}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new HttpError(401, "Unauthorized");
    return json(await reconcile());
  } catch (error) {
    return failure(error);
  }
}
