import { NextResponse } from "next/server";
import { getToken } from "@flightdeck/auth/db";
import {
  buildSearchIndex,
  listDecisions,
  readDecision,
} from "@/lib/decisions-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/data/decisions/search-index
 *
 * Pre-builds a MiniSearch index server-side (so the client doesn't have to
 * re-tokenise the entire decisions corpus on each page load) and returns the
 * serialized JSON dump alongside the raw docs. The client hydrates with
 * `MiniSearch.loadJSON(serialized, options)` and renders hits using the
 * adjacent docs payload.
 *
 * Re-built on every request — the corpus is small (≤ 500 files), file-system
 * reads are cheap, and we sidestep any cache-invalidation bugs.
 */
export async function GET() {
  if (!getToken()) {
    return NextResponse.json(
      { ok: false, error: "not signed in" },
      { status: 401 }
    );
  }
  try {
    const items = await listDecisions();
    const { serialized, docs } = await buildSearchIndex(items, async (slug) => {
      const d = await readDecision(slug);
      return d?.body ?? "";
    });
    return NextResponse.json({ ok: true, serialized, docs });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
