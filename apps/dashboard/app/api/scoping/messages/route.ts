import { NextResponse } from "next/server";
import { listMessages, listProposedActions, getSession } from "@/lib/scoping-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session");
  if (!sessionId) {
    return NextResponse.json({ error: "session required" }, { status: 400 });
  }
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  // Filter out legacy `system`-role rows that pre-T1 sessions used to store
  // the Claude session UUID. They were never meant to render in chat; the
  // value now lives on scoping_sessions.claude_session_uuid.
  const messages = listMessages(sessionId).filter((m) => m.role !== "system");
  const proposedActions = listProposedActions(sessionId);
  return NextResponse.json({
    session: {
      id: session.id,
      flowType: session.flow_type,
      ticketKind: session.ticket_kind,
      ticketRecordId: session.ticket_record_id,
      ticketTitle: session.ticket_title,
      ticketNumber: session.ticket_number,
      status: session.status,
      model: session.model,
      createdAtMs: session.created_at,
      updatedAtMs: session.updated_at,
    },
    messages,
    proposedActions,
  });
}
