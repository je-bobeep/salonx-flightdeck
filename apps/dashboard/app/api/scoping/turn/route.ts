import { NextResponse } from "next/server";
import {
  allowedToolsForFlow,
  runClaudeOneShot,
  runClaudeTurn,
} from "@flightdeck/claude/runner";
import { TEAM } from "@flightdeck/claude/team";
import {
  appendMessage,
  getClaudeSessionUuid,
  getSession,
  listMessages,
  setSessionRecap,
} from "@/lib/scoping-db";
import { recordUserTurn } from "@/lib/scoping-telemetry";
import {
  bdToDevSystemPrompt,
} from "@flightdeck/claude/prompts/bd-to-dev";
import {
  pairSanitySystemPrompt,
} from "@flightdeck/claude/prompts/pair-sanity";
import {
  weeklyReviewSystemPrompt,
} from "@flightdeck/claude/prompts/weekly-review";
import { getRecord } from "@flightdeck/lark/bitable";
import { TRACKER } from "@flightdeck/lark/wiki";
import {
  BD_FIELDS,
  FD_FIELDS,
  readMultiSelect,
  readString,
  readUsers,
} from "@flightdeck/lark/schemas";
import {
  fetchAllDev,
  inferCurrentSprint,
  projectDev,
} from "@/lib/data-derive";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/scoping/turn
 * Body: { sessionId, message }
 * Streams NDJSON events back as the model responds.
 */
export async function POST(req: Request) {
  const { sessionId, message } = (await req.json()) as {
    sessionId: string;
    message: string;
  };
  if (!sessionId || typeof message !== "string") {
    return NextResponse.json(
      { error: "sessionId + message required" },
      { status: 400 }
    );
  }
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  // Persist the user turn before streaming.
  appendMessage(sessionId, "user", JSON.stringify({ text: message }));
  recordUserTurn(sessionId);

  // Decide whether this is a fresh first turn (need system prompt) or a
  // resume. Resume = there's already at least one user/assistant message
  // beyond the seeded opener.
  const prior = listMessages(sessionId);
  const userTurns = prior.filter((m) => m.role === "user").length;
  const isFirstTurn = userTurns <= 1; // we just appended the user msg
  const claudeUuid = getClaudeSessionUuid(sessionId);
  const systemPrompt = isFirstTurn
    ? await rebuildSystemPrompt(session)
    : undefined;

  // Build a compact CONTEXT block prepended to every user turn (not just the
  // first). On long conversations, Claude can lose grip of session_id /
  // bd_record_id from the system prompt — and resume mode doesn't re-send it.
  // The team table lives here too because Claude has been seen hallucinating
  // open_ids; passing them on every turn keeps the propose_* call grounded.
  const contextBlock = await buildPerTurnContext(session);
  const augmentedMessage = `${contextBlock}\n${message}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const evt of runClaudeTurn({
          scopingSessionId: sessionId,
          systemPrompt: isFirstTurn ? systemPrompt : undefined,
          userMessage: augmentedMessage,
          model: session.model,
          sessionId: isFirstTurn ? claudeUuid ?? undefined : undefined,
          resume: isFirstTurn ? undefined : claudeUuid ?? undefined,
          // Per-flow allowlist locks each flow to the propose_* tools it
          // legitimately needs — weekly-review can't accidentally fire a
          // create_dev_ticket, etc. Unknown flow_type falls back to read
          // tools only (fail-closed), with a server-side warn.
          allowedTools: allowedToolsForFlow(session.flow_type),
          abortSignal: req.signal,
        })) {
          const t = (evt as { type?: unknown }).type;
          // Persist assistant + tool messages.
          if (t === "assistant") {
            appendMessage(sessionId, "assistant", JSON.stringify(evt));
          } else if (t === "user") {
            // Tool results come as `{type:"user", message:{role:"user", content:[{tool_use_id, type:"tool_result", ...}]}}`
            appendMessage(sessionId, "tool_result", JSON.stringify(evt));
          }
          controller.enqueue(encoder.encode(JSON.stringify(evt) + "\n"));
        }
        controller.close();
        // Trigger compaction in the background — doesn't block the response.
        // Limits how often it runs via a per-session "next eligible turn"
        // counter so we don't burn Claude calls on every turn past 20.
        void maybeCompactInBackground(sessionId);
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: "_error",
              message: e instanceof Error ? e.message : String(e),
            }) + "\n"
          )
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

async function rebuildSystemPrompt(
  session: {
    id: string;
    flow_type: string;
    ticket_record_id: string | null;
    investigation_enabled: number;
  }
): Promise<string> {
  const investigationEnabled = session.investigation_enabled === 1;
  if (session.flow_type === "bd-to-dev" && session.ticket_record_id) {
    const rec = await getRecord(
      TRACKER.appToken,
      TRACKER.tables.bdFeedback,
      session.ticket_record_id
    );
    if (!rec) return "";
    let currentSprint: string | null = null;
    try {
      const devRaws = await fetchAllDev();
      const baseDev = devRaws.map((r) => projectDev(r));
      currentSprint = inferCurrentSprint(baseDev, Date.now());
    } catch {
      // Non-blocking.
    }
    return bdToDevSystemPrompt({
      sessionId: session.id,
      bdRecordId: rec.record_id,
      bdNumber: readString(rec.fields[BD_FIELDS.number]),
      bdTitle: readString(rec.fields[BD_FIELDS.item]),
      bdTranslate: readString(rec.fields[BD_FIELDS.translate]),
      bdCategory: readMultiSelect(rec.fields[BD_FIELDS.category]),
      bdSubCategory: readString(rec.fields[BD_FIELDS.subCategory]),
      bdFromPocMerchant: readString(rec.fields[BD_FIELDS.fromThePocMerchant]),
      bdCreatedByName:
        readUsers(rec.fields[BD_FIELDS.createdBy])[0]?.name ?? "",
      currentSprint,
      investigationEnabled,
    });
  }
  if (session.flow_type === "pair-sanity" && session.ticket_record_id) {
    const [bdId, devId] = session.ticket_record_id.split("+");
    if (!bdId || !devId) return "";
    const [bd, dev] = await Promise.all([
      getRecord(TRACKER.appToken, TRACKER.tables.bdFeedback, bdId),
      getRecord(TRACKER.appToken, TRACKER.tables.featureDevelopment, devId),
    ]);
    if (!bd || !dev) return "";
    return pairSanitySystemPrompt({
      sessionId: session.id,
      bdRecordId: bd.record_id,
      bdNumber: readString(bd.fields[BD_FIELDS.number]),
      bdTitle: readString(bd.fields[BD_FIELDS.item]),
      bdTranslate: readString(bd.fields[BD_FIELDS.translate]),
      devRecordId: dev.record_id,
      devTitle: readString(dev.fields[FD_FIELDS.description]),
      devStatus: readString(dev.fields[FD_FIELDS.status]),
      devStoryDescription: readString(dev.fields[FD_FIELDS.storyDescription]),
      investigationEnabled,
    });
  }
  if (session.flow_type === "weekly-review") {
    const todayIso = new Date().toISOString().slice(0, 10);
    return weeklyReviewSystemPrompt({
      sessionId: session.id,
      todayIso,
      pipelineSummary: "(use tools to fetch fresh state)",
      agingDigest: "(use tools to fetch fresh state)",
    });
  }
  return "";
}

// Known team table is sourced from `@flightdeck/claude/team` — single source
// of truth for both the system prompt's TEAM_TABLE and this per-turn CONTEXT
// block.

/**
 * Build a compact CONTEXT block prepended to every user turn. On long-running
 * scoping sessions, Claude can drift from values in the system prompt — and
 * Claude Code resume mode doesn't re-send the system prompt — so re-injecting
 * the load-bearing IDs and lookup tables on every turn keeps propose_* tool
 * calls grounded.
 */
async function buildPerTurnContext(session: {
  id: string;
  flow_type: string;
  ticket_kind: string | null;
  ticket_record_id: string | null;
  investigation_enabled: number;
}): Promise<string> {
  const lines: string[] = [];
  lines.push(
    "[CONTEXT — these are ALREADY KNOWN; pass them straight into propose_* tool calls and do not ask the user for them.]"
  );
  lines.push(`session_id: ${session.id}`);

  if (session.ticket_kind === "bd" && session.ticket_record_id) {
    lines.push(`bd_record_id: ${session.ticket_record_id}`);
  } else if (session.ticket_kind === "pair" && session.ticket_record_id) {
    const [bdId, devId] = session.ticket_record_id.split("+");
    if (bdId) lines.push(`bd_record_id: ${bdId}`);
    if (devId) lines.push(`dev_record_id: ${devId}`);
  }

  // Re-state the investigation flag every turn so Claude can't drift off it
  // mid-conversation (the system prompt's workflow already encodes the
  // mandate, but resume mode doesn't re-send the system prompt).
  if (session.investigation_enabled === 1) {
    lines.push(
      "investigation_required: true — every Background section MUST cite at least one anchor from siblings_code_grep / siblings_read_file / siblings_gh_pr_search."
    );
  }

  // Current sprint label — fetched fresh each turn so Claude always has the
  // right value to put on the propose call without asking the user.
  try {
    const devRaws = await fetchAllDev();
    const baseDev = devRaws.map((r) => projectDev(r));
    const currentSprint = inferCurrentSprint(baseDev, Date.now());
    if (currentSprint) {
      lines.push(`current_sprint: ${currentSprint}`);
    }
  } catch {
    // Don't block the turn on a sprint lookup failure.
  }

  lines.push(`today: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push("known_assignees (NEVER hallucinate — if the user names someone not in this table, ask before proposing):");
  for (const a of TEAM) {
    lines.push(`  ${a.name} -> ${a.openId}`);
  }
  lines.push("");
  // Inject the latest recap so even if Claude's --resume memory drifts on a
  // long session, the rolled-up history is right in front of it on every turn.
  const fullSession = getSession(session.id);
  if (fullSession?.recap_md) {
    lines.push(
      `[CONVERSATION RECAP — earlier turns summarized at message #${fullSession.recap_at_turn}]`
    );
    lines.push(fullSession.recap_md);
    lines.push("");
  }
  return lines.join("\n");
}

// --- Compaction ----------------------------------------------------------

/** Trigger compaction at this many user turns. After the first compaction,
 * re-compact every COMPACT_INTERVAL turns past the previous threshold. */
const COMPACT_AFTER_TURNS = 20;
const COMPACT_INTERVAL = 10;

/**
 * Generate a markdown recap of the conversation so far if the session is past
 * the compaction threshold. Stores in scoping_sessions.recap_md so it can be
 * re-injected into per-turn CONTEXT and surfaced in the timeline view. Runs
 * fire-and-forget — never blocks a response.
 *
 * Caveat: this does NOT shrink Claude Code's actual prompt size — that
 * machinery owns the conversation history under --resume. To bound prompt
 * growth strictly, a follow-up change would break --resume after compaction
 * and restart with a synthesized system prompt that includes the recap.
 */
async function maybeCompactInBackground(sessionId: string): Promise<void> {
  try {
    const session = getSession(sessionId);
    if (!session) return;
    const messages = listMessages(sessionId);
    const userTurns = messages.filter((m) => m.role === "user").length;
    const lastRecapAt = session.recap_at_turn ?? 0;

    const shouldCompact =
      (lastRecapAt === 0 && userTurns >= COMPACT_AFTER_TURNS) ||
      (lastRecapAt > 0 && userTurns - lastRecapAt >= COMPACT_INTERVAL);
    if (!shouldCompact) return;

    // Build a compact transcript for the summarizer. Just user + assistant
    // text; skip tool_use / tool_result envelopes.
    const transcript = messages
      .map((m) => {
        if (m.role === "user") {
          try {
            const parsed = JSON.parse(m.contentJson) as { text?: string };
            return `USER: ${parsed.text ?? ""}`;
          } catch {
            return `USER: ${m.contentJson.slice(0, 500)}`;
          }
        }
        if (m.role === "assistant") {
          try {
            const parsed = JSON.parse(m.contentJson) as {
              message?: { content?: { type?: string; text?: string }[] };
            };
            const texts = (parsed.message?.content ?? [])
              .filter((c) => c.type === "text" && c.text)
              .map((c) => c.text!.slice(0, 800));
            if (texts.length > 0) return `CLAUDE: ${texts.join(" ")}`;
          } catch {
            /* fall through */
          }
          return null;
        }
        return null;
      })
      .filter((s): s is string => !!s)
      .join("\n");

    const result = await runClaudeOneShot({
      systemPrompt: `You are summarizing a scoping conversation between a PM and an AI assistant. Output a tight markdown recap (200-400 words) covering:
- The decision made or the question still open
- Key constraints surfaced
- Any proposed_actions filed (and their state)
- The agreed next step (if any)

Use plain prose, no headings deeper than ##. Output ONLY the markdown — no fences, no commentary.`,
      userMessage: transcript,
      model: "sonnet",
      disableMcp: true,
    });
    const recap = (result.resultText ?? "").trim();
    if (!recap) return;
    setSessionRecap(sessionId, recap, userTurns);
    console.log(
      `[scoping] compacted session=${sessionId} at turn=${userTurns} recap_len=${recap.length}`
    );
  } catch (e) {
    console.warn(
      `[scoping] compaction failed for session=${sessionId}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
