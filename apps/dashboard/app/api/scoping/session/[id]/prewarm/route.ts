import { NextResponse } from "next/server";
import { warmUp } from "@flightdeck/claude/process-pool";
import { allowedToolsForFlow } from "@flightdeck/claude/runner";
import { getSession, listMessages } from "@/lib/scoping-db";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/scoping/session/[id]/prewarm
 *
 * Re-warm a long-lived `claude` subprocess for this scoping session. ChatShell
 * hits this on mount when the user re-opens an existing session whose pool
 * entry has been evicted (panel previously closed, idle timeout, server
 * restart, etc.).
 *
 * Spawns with `--resume <claudeUuid>` so Claude Code reloads the persisted
 * conversation state. NO system prompt — the persisted state already has it.
 *
 * For BRAND NEW sessions, the warm-up happens inside `POST /api/scoping/session`
 * directly (where we still hold the freshly-built system prompt). This route
 * is only useful for already-started sessions.
 *
 * Idempotent. Best-effort: a failure here just means the next user turn
 * pays the normal spawn cost.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  if (!session.claude_session_uuid) {
    return NextResponse.json({ ok: false, reason: "no_claude_uuid" });
  }
  // Pre-warm only makes sense for sessions that already have at least one
  // recorded turn — for brand-new sessions Claude Code's persisted state
  // doesn't exist yet, so --resume would fail. The session-create route
  // handles first-time warm-up directly.
  const userTurns = listMessages(id).filter((m) => m.role === "user").length;
  if (userTurns === 0) {
    return NextResponse.json({ ok: true, warmed: false, reason: "no_prior_turns" });
  }
  try {
    warmUp({
      sessionId: id,
      claudeSessionUuid: session.claude_session_uuid,
      // No systemPrompt — we want --resume, not a fresh --session-id spawn.
      model: session.model,
      allowedTools: allowedToolsForFlow(session.flow_type),
    });
    return NextResponse.json({ ok: true, warmed: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
