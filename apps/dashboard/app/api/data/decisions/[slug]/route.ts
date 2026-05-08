import { NextResponse } from "next/server";
import { getToken } from "@flightdeck/auth/db";
import { readDecision } from "@/lib/decisions-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/data/decisions/[slug]
 *
 * Returns a single decision (frontmatter + raw markdown body) for the detail
 * view. Slug is the filename without `.md`. `readDecision` returns null on
 * missing file or invalid frontmatter — both surface here as a 404 so the
 * client can render a clean "not found" rather than a stack trace.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> }
) {
  if (!getToken()) {
    return NextResponse.json(
      { ok: false, error: "not signed in" },
      { status: 401 }
    );
  }
  const { slug } = await ctx.params;
  if (!slug) {
    return NextResponse.json(
      { ok: false, error: "slug required" },
      { status: 400 }
    );
  }
  try {
    const decision = await readDecision(slug);
    if (!decision) {
      return NextResponse.json(
        { ok: false, error: "not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, decision });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
