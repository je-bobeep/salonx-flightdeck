import { NextResponse } from "next/server";
import {
  appendMessage,
  claimProposedAction,
  getProposedAction,
} from "@/lib/scoping-db";
import { recordRejection } from "@/lib/scoping-telemetry";

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
  // Atomic — only one click "wins". A second click after the first succeeds
  // gets a 409 with the canonical state (so the UI can refresh and show
  // "rejected" without firing anything else).
  const claimed = claimProposedAction(id, "rejected");
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
  recordRejection(action.session_id);
  appendMessage(
    action.session_id,
    "tool_result",
    JSON.stringify({
      type: "_action_rejected",
      action_id: id,
      kind: action.kind,
    })
  );
  return NextResponse.json({ ok: true });
}
