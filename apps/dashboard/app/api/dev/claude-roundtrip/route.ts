import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { runClaudeTurn } from "@flightdeck/claude/runner";
import { evict } from "@flightdeck/claude/process-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Phase D smoke test. Spawns `claude -p` with our MCP server attached and
 * asks it to call one read tool. Returns a summary of events seen.
 *
 * This exercises: subprocess spawn, MCP config, stdio MCP server, NDJSON
 * streaming, tool execution against live Lark.
 *
 * Hit with: curl -sS http://localhost:3000/api/dev/claude-roundtrip
 * Note: takes 10-30s and uses Claude Code subscription credits.
 */
export async function GET() {
  const events: { type: unknown; subtype?: unknown; preview?: string }[] = [];
  let toolUseCount = 0;
  let assistantText = "";
  let stderr = "";
  let exitCode: unknown = null;

  // Synthetic ids — this is a one-off smoke route, not a real scoping session.
  // We evict the pool entry on completion so the dev process doesn't linger.
  const scopingSessionId = `smoke_${randomUUID()}`;
  const claudeSessionUuid = randomUUID();
  try {
    for await (const evt of runClaudeTurn({
      scopingSessionId,
      sessionId: claudeSessionUuid,
      systemPrompt:
        "You're a tiny smoke-test agent. The user will ask you to find Feature Dev tickets. Use the tool mcp__flightdeck__lark_search_feature_dev with keyword='staff' and limit=3, then summarize the results in two short sentences. Don't ask follow-up questions. Don't propose anything.",
      userMessage:
        "Use the search tool to find 3 Feature Dev tickets about staff. Summarize.",
      model: "sonnet", // smoke test — Sonnet is enough and faster than Opus
    })) {
      const t = (evt as { type?: unknown }).type;
      const subtype = (evt as { subtype?: unknown }).subtype;
      // Track tool uses
      if (t === "assistant") {
        const msg = (evt as { message?: { content?: unknown[] } }).message;
        if (msg && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (
              block &&
              typeof block === "object" &&
              "type" in block &&
              (block as { type: unknown }).type === "tool_use"
            ) {
              toolUseCount++;
            }
            if (
              block &&
              typeof block === "object" &&
              "type" in block &&
              (block as { type: unknown }).type === "text" &&
              "text" in block
            ) {
              assistantText += String((block as { text: unknown }).text);
            }
          }
        }
      }
      if (t === "_stderr") {
        stderr = String((evt as { text?: unknown }).text ?? "");
        exitCode = (evt as { exitCode?: unknown }).exitCode;
      }
      events.push({
        type: t,
        subtype,
        preview:
          typeof evt === "object"
            ? JSON.stringify(evt).slice(0, 240)
            : String(evt).slice(0, 240),
      });
    }

    return NextResponse.json({
      ok: true,
      eventCount: events.length,
      toolUseCount,
      assistantTextPreview: assistantText.slice(0, 500),
      firstEvents: events.slice(0, 5),
      lastEvents: events.slice(-3),
      stderr: stderr.slice(0, 500),
      exitCode,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        eventsBeforeError: events.length,
      },
      { status: 500 }
    );
  } finally {
    evict(scopingSessionId);
  }
}
