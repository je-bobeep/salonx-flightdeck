import { NextResponse } from "next/server";
import { getToken } from "@flightdeck/auth/db";
import { getTelemetryRollup } from "@/lib/scoping-telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!getToken()) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days") ?? "30");
  const daysBack = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30;
  return NextResponse.json({ ok: true, rollup: getTelemetryRollup(daysBack) });
}
