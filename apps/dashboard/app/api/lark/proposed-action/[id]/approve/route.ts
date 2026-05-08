import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { scopingOutputsDir } from "@flightdeck/claude/paths";
import {
  createRecord,
  updateRecord,
  linkBdToDev,
} from "@flightdeck/lark/bitable";
import { TRACKER } from "@flightdeck/lark/wiki";
import { BD_FIELDS, FD_FIELDS } from "@flightdeck/lark/schemas";
import {
  appendMessage,
  claimProposedAction,
  getProposedAction,
  updateProposedActionState,
} from "@/lib/scoping-db";
import { recordApproval } from "@/lib/scoping-telemetry";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<unknown> }
) {
  const { id } = (await ctx.params) as { id: string };
  const action = getProposedAction(id);
  if (!action) {
    return NextResponse.json({ error: "action not found" }, { status: 404 });
  }
  // Atomic pre-claim — flips state from `pending` → `firing` only if it's
  // still pending. A second concurrent click loses the race and gets a 409
  // with the current state, instead of firing the Lark write twice.
  // If the Lark write itself succeeds but the DB state-update step fails for
  // any reason, the row is left in `firing` rather than reverting to
  // `pending`, so retries surface the actual ambiguity instead of silently
  // double-writing.
  const claimed = claimProposedAction(id, "firing");
  if (!claimed) {
    const fresh = getProposedAction(id);
    return NextResponse.json(
      {
        error: `action is ${fresh?.state ?? "missing"}, not pending`,
        state: fresh?.state,
      },
      { status: 409 }
    );
  }
  const payload = JSON.parse(action.payload_json) as Record<string, unknown>;

  try {
    let result: unknown;
    switch (action.kind) {
      case "lark.create_dev_ticket":
        result = await createDevTicket(payload);
        break;
      case "lark.update_bd_status":
        result = await updateBdStatusAction(payload);
        break;
      case "lark.create_bd_dev_link":
        result = await createBdDevLink(payload);
        break;
      case "propose.write_stakeholder_md":
        result = await writeStakeholderMd(payload);
        break;
      default:
        return NextResponse.json(
          { error: `unknown action kind: ${action.kind}` },
          { status: 400 }
        );
    }
    updateProposedActionState(id, "fired", result);
    recordApproval(action.session_id);
    appendMessage(
      action.session_id,
      "tool_result",
      JSON.stringify({
        type: "_action_fired",
        action_id: id,
        kind: action.kind,
        result,
      })
    );
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    updateProposedActionState(id, "failed", { error: msg });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

async function createDevTicket(payload: Record<string, unknown>) {
  const fields: Record<string, unknown> = {
    [FD_FIELDS.description]: payload.description,
    [FD_FIELDS.storyDescription]: payload.story_description,
    [FD_FIELDS.status]:
      typeof payload.request_type === "string" && payload.request_type === "Bug"
        ? "Ready for Development"
        : "Pending PM PRD",
    [FD_FIELDS.requestType]: payload.request_type,
    [FD_FIELDS.priority]: payload.priority,
    [FD_FIELDS.milestone]: payload.milestone,
    [FD_FIELDS.customerFeedback]: payload.customer_feedback ?? true,
    [FD_FIELDS.needsTranslationReview]:
      payload.needs_translation_review ?? false,
  };
  if (Array.isArray(payload.module) && payload.module.length > 0) {
    fields[FD_FIELDS.module] = payload.module;
  }
  if (Array.isArray(payload.product) && payload.product.length > 0) {
    fields[FD_FIELDS.product] = payload.product;
  }
  if (typeof payload.sprint === "string" && payload.sprint.length > 0) {
    fields[FD_FIELDS.sprint] = payload.sprint;
  }
  if (typeof payload.eta === "string" && payload.eta.length > 0) {
    fields[FD_FIELDS.eta] = payload.eta;
  }
  if (typeof payload.assignee_open_id === "string" && payload.assignee_open_id) {
    fields[FD_FIELDS.assignee] = [{ id: payload.assignee_open_id }];
  }
  if (typeof payload.bd_record_id === "string" && payload.bd_record_id) {
    fields[FD_FIELDS.bdFeedback] = [payload.bd_record_id];
  }
  return createRecord(
    TRACKER.appToken,
    TRACKER.tables.featureDevelopment,
    fields
  );
}

async function updateBdStatusAction(payload: Record<string, unknown>) {
  if (typeof payload.bd_record_id !== "string") {
    throw new Error("bd_record_id required");
  }
  if (typeof payload.new_status !== "string") {
    throw new Error("new_status required");
  }
  return updateRecord(
    TRACKER.appToken,
    TRACKER.tables.bdFeedback,
    payload.bd_record_id,
    { [BD_FIELDS.status]: payload.new_status }
  );
}

async function createBdDevLink(payload: Record<string, unknown>) {
  if (
    typeof payload.bd_record_id !== "string" ||
    typeof payload.dev_record_id !== "string"
  ) {
    throw new Error("bd_record_id + dev_record_id required");
  }
  return linkBdToDev(
    payload.bd_record_id as never,
    payload.dev_record_id as never
  );
}

async function writeStakeholderMd(payload: Record<string, unknown>) {
  if (typeof payload.markdown !== "string") {
    throw new Error("markdown required");
  }
  const dir = scopingOutputsDir();
  await fs.mkdir(dir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  let suffix = 1;
  let filename: string;
  // Append numeric suffix on collision; never overwrite.
  // First try `<date>-stakeholder.md`, then `-stakeholder-2.md`, etc.

  while (true) {
    filename =
      suffix === 1
        ? `${today}-stakeholder.md`
        : `${today}-stakeholder-${suffix}.md`;
    const p = path.join(dir, filename);
    try {
      await fs.access(p);
      suffix++;
    } catch {
      // Doesn't exist — use this one.
      await fs.writeFile(p, payload.markdown, "utf8");
      return { path: p, filename };
    }
  }
}
