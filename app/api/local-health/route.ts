import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json(
    { app: "sellmepls", status: "running" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
