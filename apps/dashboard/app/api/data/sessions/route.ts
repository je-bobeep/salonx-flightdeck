import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "node:path";
import type { SessionRow } from "@/lib/data-shapes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dbPath() {
  return process.env.FLIGHTDECK_DB_PATH
    ? path.resolve(process.env.FLIGHTDECK_DB_PATH)
    : path.resolve(process.cwd(), "../../.data/tokens.db");
}

export async function GET() {
  const db = new Database(dbPath(), { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT s.id, s.flow_type, s.ticket_kind, s.ticket_record_id, s.ticket_number,
                s.ticket_title, s.status, s.model, s.created_at, s.updated_at,
                SUM(CASE WHEN p.state = 'pending' THEN 1 ELSE 0 END) AS pending_actions
         FROM scoping_sessions s
         LEFT JOIN proposed_actions p ON p.session_id = s.id
         GROUP BY s.id
         ORDER BY s.created_at DESC
         LIMIT 200`
      )
      .all() as Array<{
        id: string;
        flow_type: string;
        ticket_kind: string | null;
        ticket_record_id: string | null;
        ticket_number: number | null;
        ticket_title: string | null;
        status: string;
        model: string;
        created_at: number;
        updated_at: number;
        pending_actions: number;
      }>;
    const out: SessionRow[] = rows.map((r) => ({
      id: r.id,
      flowType: r.flow_type,
      ticketKind: r.ticket_kind,
      ticketRecordId: r.ticket_record_id,
      ticketNumber: r.ticket_number,
      ticketTitle: r.ticket_title,
      status: r.status,
      model: r.model,
      createdAtMs: r.created_at,
      updatedAtMs: r.updated_at,
      pendingActions: r.pending_actions ?? 0,
    }));
    return NextResponse.json({ sessions: out });
  } finally {
    db.close();
  }
}
