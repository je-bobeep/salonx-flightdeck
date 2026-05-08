import { NextResponse } from "next/server";
import { getToken } from "@flightdeck/auth/db";
import { listDecisions } from "@/lib/decisions-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/data/decisions
 *
 * Returns the parsed list of decisions (frontmatter + summary, no body) for
 * the index view + filter chips. Decisions live as markdown files in the
 * sibling `salon-x-business/decisions/` repo; this route is a thin wrapper
 * over `listDecisions()` with auth gating + standard error envelope.
 */
export async function GET() {
  if (!getToken()) {
    return NextResponse.json(
      { ok: false, error: "not signed in" },
      { status: 401 }
    );
  }
  try {
    const decisions = await listDecisions();
    return NextResponse.json({ ok: true, decisions });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
