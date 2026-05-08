// SQLite helpers for the poller's watermark + ingest log. Co-located with the
// poller package so the schema stays close to the code that uses it.
//
// The actual CREATE TABLE statements live in lib/auth/db.ts (the canonical
// migration spot).

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

export type PollerState = {
  chatId: string;
  lastSeenCreateMs: number;
  lastSeenMessageId: string | null;
  lastRunAt: number | null;
  lastRunProcessed: number | null;
  lastRunError: string | null;
  updatedAt: number;
};

export function getPollerState(chatId: string): PollerState | null {
  const row = db()
    .prepare(
      `SELECT chat_id, last_seen_create_ms, last_seen_message_id, last_run_at,
              last_run_processed, last_run_error, updated_at
       FROM poller_state WHERE chat_id = ?`
    )
    .get(chatId) as
    | {
        chat_id: string;
        last_seen_create_ms: number;
        last_seen_message_id: string | null;
        last_run_at: number | null;
        last_run_processed: number | null;
        last_run_error: string | null;
        updated_at: number;
      }
    | undefined;
  if (!row) return null;
  return {
    chatId: row.chat_id,
    lastSeenCreateMs: row.last_seen_create_ms,
    lastSeenMessageId: row.last_seen_message_id,
    lastRunAt: row.last_run_at,
    lastRunProcessed: row.last_run_processed,
    lastRunError: row.last_run_error,
    updatedAt: row.updated_at,
  };
}

export function upsertPollerState(input: {
  chatId: string;
  lastSeenCreateMs: number;
  lastSeenMessageId: string | null;
  lastRunAt?: number;
  lastRunProcessed?: number;
  lastRunError?: string | null;
}) {
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO poller_state (
        chat_id, last_seen_create_ms, last_seen_message_id,
        last_run_at, last_run_processed, last_run_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        last_seen_create_ms = excluded.last_seen_create_ms,
        last_seen_message_id = excluded.last_seen_message_id,
        last_run_at = excluded.last_run_at,
        last_run_processed = excluded.last_run_processed,
        last_run_error = excluded.last_run_error,
        updated_at = excluded.updated_at`
    )
    .run(
      input.chatId,
      input.lastSeenCreateMs,
      input.lastSeenMessageId,
      input.lastRunAt ?? now,
      input.lastRunProcessed ?? null,
      input.lastRunError ?? null,
      now
    );
}

export type IngestLogState = "ingested" | "skipped" | "failed";

export type IngestLogEntry = {
  messageId: string;
  chatId: string;
  messageCreateMs: number;
  bdRecordId: string | null;
  bdNumber: string | null;
  state: IngestLogState;
  detectedPriority: string | null;
  category: string | null;
  subCategory: string | null;
  error: string | null;
  rawText: string | null;
  ingestedAt: number;
};

export function logIngest(entry: Omit<IngestLogEntry, "ingestedAt">): void {
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO poller_ingest_log (
        message_id, chat_id, message_create_ms, bd_record_id, bd_number,
        state, detected_priority, category, sub_category, error, raw_text, ingested_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET
        bd_record_id = excluded.bd_record_id,
        bd_number = excluded.bd_number,
        state = excluded.state,
        detected_priority = excluded.detected_priority,
        category = excluded.category,
        sub_category = excluded.sub_category,
        error = excluded.error,
        raw_text = excluded.raw_text,
        ingested_at = excluded.ingested_at`
    )
    .run(
      entry.messageId,
      entry.chatId,
      entry.messageCreateMs,
      entry.bdRecordId,
      entry.bdNumber,
      entry.state,
      entry.detectedPriority,
      entry.category,
      entry.subCategory,
      entry.error,
      entry.rawText,
      now
    );
}

export function hasIngested(messageId: string): boolean {
  const row = db()
    .prepare("SELECT 1 FROM poller_ingest_log WHERE message_id = ?")
    .get(messageId);
  return row !== undefined;
}

export function getIngestByBdRecordId(
  bdRecordId: string
): IngestLogEntry | null {
  const row = db()
    .prepare(
      `SELECT message_id, chat_id, message_create_ms, bd_record_id, bd_number,
              state, detected_priority, category, sub_category, error, raw_text,
              ingested_at
       FROM poller_ingest_log
       WHERE bd_record_id = ?
       ORDER BY message_create_ms DESC
       LIMIT 1`
    )
    .get(bdRecordId) as
    | {
        message_id: string;
        chat_id: string;
        message_create_ms: number;
        bd_record_id: string | null;
        bd_number: string | null;
        state: IngestLogState;
        detected_priority: string | null;
        category: string | null;
        sub_category: string | null;
        error: string | null;
        raw_text: string | null;
        ingested_at: number;
      }
    | undefined;
  if (!row) return null;
  return {
    messageId: row.message_id,
    chatId: row.chat_id,
    messageCreateMs: row.message_create_ms,
    bdRecordId: row.bd_record_id,
    bdNumber: row.bd_number,
    state: row.state,
    detectedPriority: row.detected_priority,
    category: row.category,
    subCategory: row.sub_category,
    error: row.error,
    rawText: row.raw_text,
    ingestedAt: row.ingested_at,
  };
}

export function recentIngestLog(
  chatId: string,
  limit = 20
): IngestLogEntry[] {
  const rows = db()
    .prepare(
      `SELECT message_id, chat_id, message_create_ms, bd_record_id, bd_number,
              state, detected_priority, category, sub_category, error, raw_text,
              ingested_at
       FROM poller_ingest_log
       WHERE chat_id = ?
       ORDER BY message_create_ms DESC
       LIMIT ?`
    )
    .all(chatId, limit) as Array<{
      message_id: string;
      chat_id: string;
      message_create_ms: number;
      bd_record_id: string | null;
      bd_number: string | null;
      state: IngestLogState;
      detected_priority: string | null;
      category: string | null;
      sub_category: string | null;
      error: string | null;
      raw_text: string | null;
      ingested_at: number;
    }>;
  return rows.map((r) => ({
    messageId: r.message_id,
    chatId: r.chat_id,
    messageCreateMs: r.message_create_ms,
    bdRecordId: r.bd_record_id,
    bdNumber: r.bd_number,
    state: r.state,
    detectedPriority: r.detected_priority,
    category: r.category,
    subCategory: r.sub_category,
    error: r.error,
    rawText: r.raw_text,
    ingestedAt: r.ingested_at,
  }));
}
