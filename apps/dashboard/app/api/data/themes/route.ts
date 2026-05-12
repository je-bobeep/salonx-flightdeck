import { NextResponse } from "next/server";
import {
  computeFreshThemes,
  computeUnavailableNow,
  readThemesCachedOnly,
} from "@flightdeck/themes-server/orchestrate";
import { readLastBlob } from "@flightdeck/themes/cache";

export const runtime = "nodejs";
// Claude clustering with sonnet on ~30 rows takes ~4 min wall-clock. We need
// enough headroom for the slowest realistic payload + a small buffer. Local-
// only deployment so the long ceiling doesn't matter for cost.
export const maxDuration = 600;
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const FROM_SCRATCH_COOLDOWN_MS = 5 * 60 * 1000;
// Module-level state — fine for single-user local. Tracks the last-completed
// from-scratch trigger so back-to-back clicks don't burn Anthropic spend.
const lastFromScratchAt: { value: number } = { value: 0 };

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
    // Cache miss: surface an explicit "unavailable" blob immediately. The
    // user can hit POST (Re-cluster button in the UI) to kick a real Claude
    // run; we don't synthesize fallback Sub-category themes here anymore —
    // that was the regression mode that motivated theme-clustering-v2.
    console.log("[GET /api/data/themes] cache miss — surfacing 'unavailable' blob");
    const unavailable = await computeUnavailableNow();
    return NextResponse.json({ ok: true, ...unavailable });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  // Parse the requested mode if specified. Empty / invalid body falls through
  // to the default-derivation block below.
  let mode: "incremental" | "from-scratch" | undefined;
  try {
    const body = (await req.json()) as { mode?: unknown };
    if (body && typeof body === "object") {
      if (body.mode === "from-scratch") mode = "from-scratch";
      else if (body.mode === "incremental") mode = "incremental";
    }
  } catch {
    // Empty / invalid body — leave mode undefined so default logic runs.
  }

  // Default mode: prefer from-scratch when we have no prior full recompute
  // or it's >24h old. Otherwise keep the legacy incremental default to avoid
  // unnecessary spend on hot-cache POSTs.
  if (!mode) {
    const prev = readLastBlob();
    const lastFullAtMs = prev?.provenance?.lastFullAt
      ? Date.parse(prev.provenance.lastFullAt)
      : null;
    if (
      lastFullAtMs === null ||
      Number.isNaN(lastFullAtMs) ||
      Date.now() - lastFullAtMs > DAY_MS
    ) {
      mode = "from-scratch";
    } else {
      mode = "incremental";
    }
  }

  // 5-min cooldown on from-scratch only — incremental is cheap.
  if (mode === "from-scratch") {
    const elapsed = Date.now() - lastFromScratchAt.value;
    if (elapsed < FROM_SCRATCH_COOLDOWN_MS) {
      const retryAfterSec = Math.ceil(
        (FROM_SCRATCH_COOLDOWN_MS - elapsed) / 1000
      );
      return NextResponse.json(
        {
          ok: false,
          error: `Cluster from scratch is rate-limited (5-min cooldown). Try again in ${retryAfterSec}s.`,
        },
        { status: 429, headers: { "retry-after": String(retryAfterSec) } }
      );
    }
    lastFromScratchAt.value = Date.now();
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
