import { NextResponse } from "next/server";
import { getRecord } from "@flightdeck/lark/bitable";
import { TRACKER } from "@flightdeck/lark/wiki";
import { projectDev } from "@/lib/data-derive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const recordId = url.searchParams.get("recordId");
  if (!recordId) {
    return NextResponse.json({ error: "recordId required" }, { status: 400 });
  }
  const raw = await getRecord(
    TRACKER.appToken,
    TRACKER.tables.featureDevelopment,
    recordId
  );
  if (!raw) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ row: projectDev(raw) });
}
