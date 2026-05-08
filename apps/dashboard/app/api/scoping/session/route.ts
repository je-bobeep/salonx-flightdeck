import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
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
  bdToDevSystemPrompt,
  bdToDevOpener,
} from "@flightdeck/claude/prompts/bd-to-dev";
import {
  pairSanitySystemPrompt,
  pairSanityOpener,
} from "@flightdeck/claude/prompts/pair-sanity";
import {
  weeklyReviewSystemPrompt,
  weeklyReviewOpener,
} from "@flightdeck/claude/prompts/weekly-review";
import {
  fetchAllDev,
  fetchAllBd,
  projectDev,
  projectBd,
  inferCurrentSprint,
} from "@/lib/data-derive";
import { isActive } from "@/lib/status";
import { appendMessage, createSession, mintSessionId } from "@/lib/scoping-db";
import { recordSessionStart } from "@/lib/scoping-telemetry";
import type { CreateSessionRequest } from "@/lib/scoping-shapes";
import { warmUp } from "@flightdeck/claude/process-pool";
import { allowedToolsForFlow } from "@flightdeck/claude/runner";

export const runtime = "nodejs";

type SessionResponse = {
  sessionId: string;
  systemPrompt: string;
  opener: string;
};

export async function POST(req: Request) {
  const body = (await req.json()) as CreateSessionRequest;
  if (!body.flowType) {
    return NextResponse.json({ error: "flowType required" }, { status: 400 });
  }

  const claudeSessionUuid = randomUUID();
  // Mint the session id up front so we can bake it into the system prompt.
  // Without this Claude has no way to know the session_id and every propose_*
  // tool call fails with "session_id required".
  const sessionId = mintSessionId();
  let systemPrompt = "";
  let opener = "";
  let ticketKind: string | null = null;
  let ticketRecordId: string | null = null;
  let ticketNumber: number | null = null;
  let ticketTitle: string | null = null;

  if (body.flowType === "bd-to-dev") {
    if (!body.ticketRecordId) {
      return NextResponse.json(
        { error: "ticketRecordId required for bd-to-dev" },
        { status: 400 }
      );
    }
    const rec = await getRecord(
      TRACKER.appToken,
      TRACKER.tables.bdFeedback,
      body.ticketRecordId
    );
    if (!rec) {
      return NextResponse.json(
        { error: `BD record ${body.ticketRecordId} not found` },
        { status: 404 }
      );
    }
    // Compute current sprint label so propose_create_dev_ticket can fill the
    // Sprint field automatically without asking the user.
    let currentSprint: string | null = null;
    try {
      const devRaws = await fetchAllDev();
      const baseDev = devRaws.map((r) => projectDev(r));
      currentSprint = inferCurrentSprint(baseDev, Date.now());
    } catch {
      // Non-blocking — Claude will fall back to asking if it can't infer.
    }
    const ctx = {
      sessionId,
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
      investigationEnabled: body.investigationEnabled === true,
    };
    systemPrompt = bdToDevSystemPrompt(ctx);
    opener = bdToDevOpener(ctx);
    ticketKind = "bd";
    ticketRecordId = rec.record_id;
    const num = Number(ctx.bdNumber);
    ticketNumber = Number.isFinite(num) ? num : null;
    ticketTitle = ctx.bdTranslate || ctx.bdTitle;
  } else if (body.flowType === "pair-sanity") {
    if (!body.pairBdRecordId || !body.pairDevRecordId) {
      return NextResponse.json(
        { error: "pairBdRecordId + pairDevRecordId required for pair-sanity" },
        { status: 400 }
      );
    }
    const [bd, dev] = await Promise.all([
      getRecord(
        TRACKER.appToken,
        TRACKER.tables.bdFeedback,
        body.pairBdRecordId
      ),
      getRecord(
        TRACKER.appToken,
        TRACKER.tables.featureDevelopment,
        body.pairDevRecordId
      ),
    ]);
    if (!bd || !dev) {
      return NextResponse.json(
        { error: "BD or Dev record not found" },
        { status: 404 }
      );
    }
    const ctx = {
      sessionId,
      bdRecordId: bd.record_id,
      bdNumber: readString(bd.fields[BD_FIELDS.number]),
      bdTitle: readString(bd.fields[BD_FIELDS.item]),
      bdTranslate: readString(bd.fields[BD_FIELDS.translate]),
      devRecordId: dev.record_id,
      devTitle: readString(dev.fields[FD_FIELDS.description]),
      devStatus: readString(dev.fields[FD_FIELDS.status]),
      devStoryDescription: readString(dev.fields[FD_FIELDS.storyDescription]),
      investigationEnabled: body.investigationEnabled === true,
    };
    systemPrompt = pairSanitySystemPrompt(ctx);
    opener = pairSanityOpener(ctx);
    ticketKind = "pair";
    ticketRecordId = `${bd.record_id}+${dev.record_id}`;
    const num = Number(ctx.bdNumber);
    ticketNumber = Number.isFinite(num) ? num : null;
    ticketTitle = `BD #${ctx.bdNumber} ↔ ${ctx.devTitle}`;
  } else if (body.flowType === "weekly-review") {
    const todayIso = new Date().toISOString().slice(0, 10);
    // Build a compact pipeline summary the system prompt can ground on.
    const [bdRaws, devRaws] = await Promise.all([fetchAllBd(), fetchAllDev()]);
    const allBd = bdRaws.map((r) => projectBd(r));
    const baseDev = devRaws.map((r) => projectDev(r));
    const currentSprint = inferCurrentSprint(baseDev);
    const allDev = devRaws.map((r) =>
      projectDev(r, { currentSprintLabel: currentSprint ?? undefined })
    );
    const sprintRows = allDev.filter((r) => r.sprint === currentSprint);
    const sprintActive = sprintRows.filter((r) => isActive(r.status));
    const pipelineSummary = [
      `Current sprint: ${currentSprint ?? "(none detected)"} — ${sprintRows.length} total, ${sprintActive.length} active.`,
      `Active by assignee: ${[
        ...new Set(sprintActive.flatMap((r) => r.assignees.map((a) => a.name ?? "?"))),
      ]
        .map(
          (n) =>
            `${n}: ${sprintActive.filter((r) => r.assignees.some((a) => (a.name ?? "?") === n)).length}`
        )
        .join(", ")}`,
      `BD Feedback: ${allBd.filter((r) => r.status === "Logged" && !r.hasLinkedDev).length} unaddressed, ${allBd.filter((r) => r.fromPocMerchant && r.status === "Logged" && !r.hasLinkedDev).length} from POC merchant.`,
    ].join("\n");
    const agingDigest = sprintActive
      .filter((r) => r.aging.length > 0)
      .slice(0, 10)
      .map(
        (r) =>
          `- ${r.description.slice(0, 80)} — ${r.aging.map((s) => s.kind).join(", ")}`
      )
      .join("\n") || "(none)";
    systemPrompt = weeklyReviewSystemPrompt({
      sessionId,
      todayIso,
      pipelineSummary,
      agingDigest,
    });
    opener = weeklyReviewOpener({
      sessionId,
      todayIso,
      pipelineSummary,
      agingDigest,
    });
    ticketKind = null;
    ticketRecordId = null;
    ticketTitle = `Weekly stakeholder update — ${todayIso}`;
  } else {
    return NextResponse.json(
      { error: `unknown flowType: ${body.flowType}` },
      { status: 400 }
    );
  }

  createSession({
    id: sessionId,
    flowType: body.flowType,
    ticketKind,
    ticketRecordId,
    ticketNumber,
    ticketTitle,
    model: body.model ?? "opus",
    claudeSessionUuid,
    investigationEnabled: body.investigationEnabled === true,
  });
  recordSessionStart(sessionId, body.flowType);

  // Persist the system prompt + opener into messages so the chat UI can
  // render them as the first turn.
  appendMessage(sessionId, "assistant", JSON.stringify({ text: opener }));

  // Pre-warm the long-lived `claude` subprocess RIGHT NOW. The user just
  // clicked "Scope this for dev" — by the time they read the opener and
  // type their first reply, the subprocess + Claude Code init + MCP
  // toolserver boot are already done. First turn lands hot.
  // Best-effort: failures don't propagate (next turn just spawns through
  // the normal path).
  try {
    warmUp({
      sessionId,
      claudeSessionUuid,
      systemPrompt, // freshly built — same value the first turn would pass
      model: body.model ?? "opus",
      allowedTools: allowedToolsForFlow(body.flowType),
    });
  } catch (e) {
    console.warn(
      "[scoping/session] pre-warm failed (non-fatal):",
      e instanceof Error ? e.message : String(e)
    );
  }

  const response: SessionResponse = { sessionId, systemPrompt, opener };
  return NextResponse.json(response);
}
