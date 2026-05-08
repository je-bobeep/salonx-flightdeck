import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, unauthenticated. Designed to be polled by Uptime Kuma / Prometheus
// without a session cookie. Reports operational signals only — no PII, no
// Lark IDs, no message content. Excluded from the middleware gate via
// `apps/dashboard/middleware.ts`.

type Health = {
  ok: boolean;
  dashboard: {
    uptimeMs: number;
    nodeVersion: string;
  };
  token: {
    present: boolean;
    accessExpiresInMs: number | null;
    refreshExpiresInMs: number | null;
  };
  sessions: {
    active: number;
  };
  poller: {
    chats: Array<{
      chatId: string;
      lastRunAt: number | null;
      lastRunMsAgo: number | null;
      lastRunProcessed: number | null;
      lastRunError: string | null;
      lastSeenCreateMs: number;
    }>;
    recent24h: {
      ingested: number;
      failed: number;
    };
  };
};

const startedAt = Date.now();

function dbPath(): string {
  return process.env.FLIGHTDECK_DB_PATH
    ? path.resolve(process.env.FLIGHTDECK_DB_PATH)
    : path.resolve(process.cwd(), "../../.data/tokens.db");
}

export async function GET() {
  const now = Date.now();
  const out: Health = {
    ok: true,
    dashboard: {
      uptimeMs: now - startedAt,
      nodeVersion: process.version,
    },
    token: { present: false, accessExpiresInMs: null, refreshExpiresInMs: null },
    sessions: { active: 0 },
    poller: { chats: [], recent24h: { ingested: 0, failed: 0 } },
  };

  // Read-only — open in readonly mode so we don't accidentally trigger schema
  // migrations from a code path that only wants to report state.
  let db: Database.Database;
  try {
    db = new Database(dbPath(), { readonly: true, fileMustExist: true });
  } catch {
    // If the DB doesn't exist yet, the dashboard hasn't been signed into yet.
    // Still return ok=true (dashboard process IS up); poller info just empty.
    return NextResponse.json(out);
  }

  try {
    const tok = db
      .prepare(
        "SELECT expires_at, refresh_expires_at FROM tokens WHERE id = 1"
      )
      .get() as { expires_at: number; refresh_expires_at: number } | undefined;
    if (tok) {
      out.token.present = true;
      out.token.accessExpiresInMs = tok.expires_at - now;
      out.token.refreshExpiresInMs = tok.refresh_expires_at - now;
    }

    const sessRow = db
      .prepare("SELECT count(*) AS c FROM sessions")
      .get() as { c: number };
    out.sessions.active = sessRow.c;

    const chats = db
      .prepare(
        "SELECT chat_id, last_run_at, last_run_processed, last_run_error, last_seen_create_ms FROM poller_state"
      )
      .all() as Array<{
        chat_id: string;
        last_run_at: number | null;
        last_run_processed: number | null;
        last_run_error: string | null;
        last_seen_create_ms: number;
      }>;
    out.poller.chats = chats.map((c) => ({
      chatId: c.chat_id,
      lastRunAt: c.last_run_at,
      lastRunMsAgo: c.last_run_at ? now - c.last_run_at : null,
      lastRunProcessed: c.last_run_processed,
      lastRunError: c.last_run_error,
      lastSeenCreateMs: c.last_seen_create_ms,
    }));

    const day = 24 * 60 * 60 * 1000;
    const ingested = db
      .prepare(
        "SELECT count(*) AS c FROM poller_ingest_log WHERE state = 'ingested' AND ingested_at > ?"
      )
      .get(now - day) as { c: number };
    const failed = db
      .prepare(
        "SELECT count(*) AS c FROM poller_ingest_log WHERE state = 'failed' AND ingested_at > ?"
      )
      .get(now - day) as { c: number };
    out.poller.recent24h.ingested = ingested.c;
    out.poller.recent24h.failed = failed.c;
  } finally {
    db.close();
  }

  return NextResponse.json(out);
}
