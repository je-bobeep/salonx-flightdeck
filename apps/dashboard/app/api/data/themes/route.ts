import { NextResponse } from "next/server";
import {
  computeFallbackThemesNow,
  computeFreshThemes,
  readThemesCachedOnly,
} from "@/lib/themes-server";

export const runtime = "nodejs";
// Claude clustering with sonnet on ~30 rows takes ~4 min wall-clock. We need
// enough headroom for the slowest realistic payload + a small buffer. Local-
// only deployment so the long ceiling doesn't matter for cost.
export const maxDuration = 600;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cached = readThemesCachedOnly();
    if (cached) {
      console.log(
        "[GET /api/data/themes] cache hit (fresh=%s, themes=%d)",
        cached.fresh,
        cached.blob.themes.length
      );
      return NextResponse.json({ ok: true, ...cached });
    }
    // Cache miss: never wait on Claude here — clustering takes minutes and
    // we'd hang the page. Compute the deterministic fallback synchronously
    // (fast) so the UI gets a usable starting point. POST is the explicit
    // trigger for the slow Claude path.
    console.log("[GET /api/data/themes] cache miss — using fallback");
    const fallback = await computeFallbackThemesNow();
    return NextResponse.json({ ok: true, ...fallback });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  let mode: "incremental" | "from-scratch" = "incremental";
  try {
    const body = (await req.json()) as { mode?: unknown };
    if (body && typeof body === "object") {
      if (body.mode === "from-scratch") mode = "from-scratch";
      else if (body.mode === "incremental") mode = "incremental";
    }
  } catch {
    // Empty / invalid body — keep default.
  }
  try {
    const fresh = await computeFreshThemes({ mode });
    return NextResponse.json({ ok: true, ...fresh });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
