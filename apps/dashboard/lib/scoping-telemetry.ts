// Tiny telemetry helpers for the scoping feature. Used to inform the future
// kill/keep decision (CLAUDE.md "Scope feature is on probation").
//
// Every helper is no-op safe — wraps writes in try/catch so a telemetry
// failure never blocks the user-facing flow.

import path from "node:path";
import Database from "better-sqlite3";

function dbPath() {
  return process.env.FLIGHTDECK_DB_PATH
    ? path.resolve(process.env.FLIGHTDECK_DB_PATH)
    : path.resolve(process.cwd(), "../../.data/tokens.db");
}

let cached: Database.Database | null = null;
function db() {
  if (cached) return cached;
  cached = new Database(dbPath());
  cached.pragma("journal_mode = WAL");
  return cached;
}

function safeRun(fn: () => void) {
  try {
    fn();
  } catch (e) {
    console.warn(
      "[scoping-telemetry] write failed (non-fatal): %s",
      e instanceof Error ? e.message : String(e)
    );
  }
}

export function recordSessionStart(sessionId: string, flowType: string): void {
  safeRun(() => {
    const now = Date.now();
    db()
      .prepare(
        `INSERT INTO scoping_telemetry (
           session_id, flow_type, started_at, last_event_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO NOTHING`
      )
      .run(sessionId, flowType, now, now);
  });
}

export function recordUserTurn(sessionId: string): void {
  safeRun(() => {
    const now = Date.now();
    db()
      .prepare(
        `UPDATE scoping_telemetry
         SET user_turn_count = user_turn_count + 1,
             last_event_at = ?
         WHERE session_id = ?`
      )
      .run(now, sessionId);
  });
}

export function recordApproval(sessionId: string): void {
  safeRun(() => {
    const now = Date.now();
    db()
      .prepare(
        `UPDATE scoping_telemetry
         SET approved_count = approved_count + 1,
             last_event_at  = ?
         WHERE session_id = ?`
      )
      .run(now, sessionId);
  });
}

export function recordRejection(sessionId: string): void {
  safeRun(() => {
    const now = Date.now();
    db()
      .prepare(
        `UPDATE scoping_telemetry
         SET rejected_count = rejected_count + 1,
             last_event_at  = ?
         WHERE session_id = ?`
      )
      .run(now, sessionId);
  });
}

export type TelemetryRollup = {
  daysBack: number;
  totalSessions: number;
  byFlowType: Record<string, number>;
  sessionsWithProposal: number;
  approvedActions: number;
  rejectedActions: number;
  abandonedSessions: number;
  avgUserTurns: number;
};

export function getTelemetryRollup(daysBack: number = 30): TelemetryRollup {
  const since = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  try {
    const rows = db()
      .prepare(
        `SELECT flow_type, user_turn_count, proposal_count,
                approved_count, rejected_count
         FROM scoping_telemetry
         WHERE started_at >= ?`
      )
      .all(since) as Array<{
        flow_type: string;
        user_turn_count: number;
        proposal_count: number;
        approved_count: number;
        rejected_count: number;
      }>;

    const byFlowType: Record<string, number> = {};
    let totalUserTurns = 0;
    let sessionsWithProposal = 0;
    let approvedActions = 0;
    let rejectedActions = 0;
    let abandonedSessions = 0;

    for (const r of rows) {
      byFlowType[r.flow_type] = (byFlowType[r.flow_type] ?? 0) + 1;
      totalUserTurns += r.user_turn_count;
      if (r.proposal_count > 0) sessionsWithProposal += 1;
      approvedActions += r.approved_count;
      rejectedActions += r.rejected_count;
      // "Abandoned" = had a proposal but it was never approved or rejected.
      const unresolvedProposals =
        r.proposal_count - r.approved_count - r.rejected_count;
      if (unresolvedProposals > 0) abandonedSessions += 1;
    }

    return {
      daysBack,
      totalSessions: rows.length,
      byFlowType,
      sessionsWithProposal,
      approvedActions,
      rejectedActions,
      abandonedSessions,
      avgUserTurns:
        rows.length > 0 ? Math.round((totalUserTurns / rows.length) * 10) / 10 : 0,
    };
  } catch (e) {
    console.warn(
      "[scoping-telemetry] rollup failed: %s",
      e instanceof Error ? e.message : String(e)
    );
    return {
      daysBack,
      totalSessions: 0,
      byFlowType: {},
      sessionsWithProposal: 0,
      approvedActions: 0,
      rejectedActions: 0,
      abandonedSessions: 0,
      avgUserTurns: 0,
    };
  }
}
