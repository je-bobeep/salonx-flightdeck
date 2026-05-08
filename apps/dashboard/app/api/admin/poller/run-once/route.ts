import { NextResponse } from "next/server";
import { pollOnce } from "@flightdeck/poller/poll";

export const runtime = "nodejs";
// Classification can take a while if there are many new messages.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const summary = await pollOnce({
      log: (s) => console.log(`[poller] ${s}`),
    });
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
