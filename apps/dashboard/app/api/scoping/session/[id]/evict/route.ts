import { NextResponse } from "next/server";
import { evict } from "@flightdeck/claude/process-pool";

export const runtime = "nodejs";

/**
 * POST /api/scoping/session/[id]/evict
 *
 * Drops the long-lived `claude` subprocess for this scoping session from the
 * pool (SIGTERMs the child). Called from `ChatShell.tsx`'s unmount cleanup so
 * abandoned panels don't leak processes. The next user turn (if any) will
 * re-spawn with `--resume`, so this is non-destructive — Claude Code's
 * persisted session history is unaffected.
 *
 * Idempotent. No body. Returns `{ ok: true }` even if there was nothing to
 * evict.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  evict(id);
  return NextResponse.json({ ok: true });
}
