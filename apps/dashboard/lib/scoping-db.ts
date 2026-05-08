// Server-side helpers for the scoping_sessions / scoping_messages /
// proposed_actions tables. Imports lib/auth/db lazily to share the connection.

import { ulid } from "ulid";
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

export type SessionRowRaw = {
  id: string;
  flow_type: string;
  ticket_kind: string | null;
  ticket_record_id: string | null;
  ticket_number: number | null;
  ticket_title: string | null;
  status: string;
  model: string;
  claude_session_uuid: string | null;
  recap_md: string | null;
  recap_at_turn: number | null;
  /** SQLite stores 0/1 for the boolean — coerce to boolean at the read site. */
  investigation_enabled: number;
  created_at: number;
  updated_at: number;
};

export function setSessionRecap(
  sessionId: string,
  recapMd: string,
  recapAtTurn: number
) {
  db()
    .prepare(
      `UPDATE scoping_sessions
       SET recap_md = ?, recap_at_turn = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(recapMd, recapAtTurn, Date.now(), sessionId);
}

export function mintSessionId(): string {
  return `ses_${ulid()}`;
}

export function createSession(input: {
  /** Optional pre-minted id (so callers can bake it into the system prompt). */
  id?: string;
  flowType: string;
  ticketKind: string | null;
  ticketRecordId: string | null;
  ticketNumber: number | null;
  ticketTitle: string | null;
  model: string;
  claudeSessionUuid: string;
  /** When true, the bd-to-dev / pair-sanity prompt mandates an Investigation
   * phase before drafting (codebase grep + PRD search + shipped-PR check). */
  investigationEnabled?: boolean;
}): string {
  const id = input.id ?? mintSessionId();
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO scoping_sessions (
        id, flow_type, ticket_kind, ticket_record_id, ticket_number,
        ticket_title, status, model, claude_session_uuid,
        investigation_enabled, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.flowType,
      input.ticketKind,
      input.ticketRecordId,
      input.ticketNumber,
      input.ticketTitle,
      input.model,
      input.claudeSessionUuid,
      input.investigationEnabled ? 1 : 0,
      now,
      now
    );
  return id;
}

export function getSession(id: string): SessionRowRaw | null {
  return (
    (db()
      .prepare("SELECT * FROM scoping_sessions WHERE id = ?")
      .get(id) as SessionRowRaw | undefined) ?? null
  );
}

export function getClaudeSessionUuid(sessionId: string): string | null {
  // Read from the dedicated column. Older sessions (before the column
  // existed) stored the uuid as the first system-role message; we still
  // honour those as a fallback so existing in-flight sessions don't break.
  const row = db()
    .prepare(
      "SELECT claude_session_uuid FROM scoping_sessions WHERE id = ?"
    )
    .get(sessionId) as { claude_session_uuid: string | null } | undefined;
  if (row?.claude_session_uuid) return row.claude_session_uuid;
  // Legacy path — pre-T1 sessions persisted the UUID as a fake system msg.
  const legacy = db()
    .prepare(
      "SELECT content_json FROM scoping_messages WHERE session_id = ? AND role = 'system' ORDER BY created_at ASC LIMIT 1"
    )
    .get(sessionId) as { content_json: string } | undefined;
  if (!legacy) return null;
  try {
    const parsed = JSON.parse(legacy.content_json) as {
      claude_session_uuid?: string;
    };
    return parsed.claude_session_uuid ?? null;
  } catch {
    return null;
  }
}

export function appendMessage(
  sessionId: string,
  role: "user" | "assistant" | "tool_use" | "tool_result" | "system",
  contentJson: string
): string {
  const id = `msg_${ulid()}`;
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO scoping_messages (id, session_id, role, content_json, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, sessionId, role, contentJson, now);
  db()
    .prepare("UPDATE scoping_sessions SET updated_at = ? WHERE id = ?")
    .run(now, sessionId);
  return id;
}

export function listMessages(sessionId: string): Array<{
  id: string;
  sessionId: string;
  role: string;
  contentJson: string;
  createdAtMs: number;
}> {
  const rows = db()
    .prepare(
      "SELECT id, session_id, role, content_json, created_at FROM scoping_messages WHERE session_id = ? AND role != 'system' ORDER BY created_at ASC"
    )
    .all(sessionId) as Array<{
      id: string;
      session_id: string;
      role: string;
      content_json: string;
      created_at: number;
    }>;
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    role: r.role,
    contentJson: r.content_json,
    createdAtMs: r.created_at,
  }));
}

export function listProposedActions(sessionId: string): Array<{
  id: string;
  kind: string;
  payload: unknown;
  state: string;
  result: unknown;
  createdAtMs: number;
  resolvedAtMs: number | null;
}> {
  const rows = db()
    .prepare(
      `SELECT id, kind, payload_json, state, result_json, created_at, resolved_at
       FROM proposed_actions WHERE session_id = ? ORDER BY created_at ASC`
    )
    .all(sessionId) as Array<{
      id: string;
      kind: string;
      payload_json: string;
      state: string;
      result_json: string | null;
      created_at: number;
      resolved_at: number | null;
    }>;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    payload: safeJson(r.payload_json),
    state: r.state,
    result: r.result_json ? safeJson(r.result_json) : null,
    createdAtMs: r.created_at,
    resolvedAtMs: r.resolved_at,
  }));
}

export function getProposedAction(id: string) {
  return db()
    .prepare(
      `SELECT id, session_id, kind, payload_json, state, result_json, created_at, resolved_at
       FROM proposed_actions WHERE id = ?`
    )
    .get(id) as
    | {
        id: string;
        session_id: string;
        kind: string;
        payload_json: string;
        state: string;
        result_json: string | null;
        created_at: number;
        resolved_at: number | null;
      }
    | undefined;
}

export function updateProposedActionState(
  id: string,
  state: string,
  result: unknown
) {
  db()
    .prepare(
      `UPDATE proposed_actions
       SET state = ?, result_json = ?, resolved_at = ?
       WHERE id = ?`
    )
    .run(state, result === null ? null : JSON.stringify(result), Date.now(), id);
}

/**
 * Atomic claim — flips a `pending` row to the given target state ONLY if it's
 * still pending. Returns true on win (caller owns the firing), false on loss
 * (a concurrent click already claimed it). Used by the approve/reject routes
 * so a partial failure can't leave us in "Lark wrote, DB didn't" state — the
 * caller pre-claims to `firing`, runs the Lark write, then transitions to
 * `fired` or `failed`.
 */
export function claimProposedAction(
  id: string,
  newState: "firing" | "rejected"
): boolean {
  const result = db()
    .prepare(
      `UPDATE proposed_actions
       SET state = ?, resolved_at = ?
       WHERE id = ? AND state = 'pending'`
    )
    .run(newState, Date.now(), id);
  return result.changes === 1;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export function setSessionStatus(id: string, status: string) {
  db()
    .prepare("UPDATE scoping_sessions SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, Date.now(), id);
}
