import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type StoredToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
  scope: string;
  openId: string | null;
  name: string | null;
  updatedAt: number;
};

// Anchor: FLIGHTDECK_DB_PATH wins (set by the MCP server spawn config).
// Default assumes cwd is apps/dashboard/ (the Next.js dev server's cwd).
const DB_PATH = process.env.FLIGHTDECK_DB_PATH
  ? path.resolve(process.env.FLIGHTDECK_DB_PATH)
  : path.resolve(process.cwd(), "../../.data/tokens.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      refresh_expires_at INTEGER NOT NULL,
      scope TEXT NOT NULL,
      open_id TEXT,
      name TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scoping_sessions (
      id TEXT PRIMARY KEY,
      flow_type TEXT NOT NULL,
      ticket_kind TEXT,
      ticket_record_id TEXT,
      ticket_number INTEGER,
      ticket_title TEXT,
      status TEXT NOT NULL,
      model TEXT NOT NULL,
      claude_session_uuid TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scoping_sessions_ticket
      ON scoping_sessions(ticket_record_id, flow_type);
    CREATE INDEX IF NOT EXISTS idx_scoping_sessions_status_created
      ON scoping_sessions(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS scoping_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES scoping_sessions(id),
      role TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scoping_messages_session
      ON scoping_messages(session_id, created_at);

    CREATE TABLE IF NOT EXISTS proposed_actions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES scoping_sessions(id),
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      state TEXT NOT NULL,
      result_json TEXT,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_proposed_actions_session
      ON proposed_actions(session_id);
    CREATE INDEX IF NOT EXISTS idx_proposed_actions_state
      ON proposed_actions(state);

    CREATE TABLE IF NOT EXISTS poller_state (
      chat_id TEXT PRIMARY KEY,
      last_seen_create_ms INTEGER NOT NULL,
      last_seen_message_id TEXT,
      last_run_at INTEGER,
      last_run_processed INTEGER,
      last_run_error TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS poller_ingest_log (
      message_id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      message_create_ms INTEGER NOT NULL,
      bd_record_id TEXT,
      bd_number TEXT,
      state TEXT NOT NULL,
      detected_priority TEXT,
      category TEXT,
      sub_category TEXT,
      error TEXT,
      raw_text TEXT,
      ingested_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_poller_ingest_log_chat
      ON poller_ingest_log(chat_id, message_create_ms DESC);

    CREATE TABLE IF NOT EXISTS lark_cache (
      cache_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );

    -- Per-browser sessions. Each successful Lark OAuth (with the configured
    -- open_id allowlist) issues one row. Cookie value IS the session id.
    -- Distinct from the tokens singleton (Lark UAT). Sign-out drops the row
    -- but leaves the Lark token intact so the background poller keeps working.
    CREATE TABLE IF NOT EXISTS sessions (
      id           TEXT PRIMARY KEY,
      open_id      TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      user_agent   TEXT,
      ip           TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_open_id ON sessions(open_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen_at);

    -- Cross-process serialization for Lark refresh-token rotation. The dashboard
    -- and poller each hold their own Node process; without this, both can read
    -- the same refresh_token from the singleton tokens row, both POST it to
    -- Lark, the second gets error 20064 ("token already used"), and the user
    -- is force-reauthed for no reason. Only one row ever, id=1.
    CREATE TABLE IF NOT EXISTS refresh_mutex (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      holder      TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lark_thread_cache (
      thread_id     TEXT PRIMARY KEY,
      bd_record_id  TEXT,
      messages_json TEXT NOT NULL,
      summary_text  TEXT,
      fetched_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lark_thread_cache_bd
      ON lark_thread_cache(bd_record_id);

    CREATE TABLE IF NOT EXISTS dev_internal_target (
      dev_record_id TEXT PRIMARY KEY,
      target_date   TEXT NOT NULL,
      notes         TEXT,
      set_at        INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS theme_row_overrides (
      bd_record_id TEXT PRIMARY KEY,
      theme_id     TEXT NOT NULL,
      set_at       INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dev_theme_overrides (
      dev_record_id TEXT PRIMARY KEY,
      theme_id      TEXT NOT NULL,
      set_at        INTEGER NOT NULL
    );

    -- Phase 3 of theme-clustering-v2: proposals table for brand-new theme
    -- names emitted by Claude (within MAX_NEW_THEMES_PER_RUN). User accepts
    -- or rejects; "accepted" is purely a record — adding to the canon is a
    -- manual edit of lib/themes/taxonomy.ts.
    CREATE TABLE IF NOT EXISTS taxonomy_proposals (
      name           TEXT PRIMARY KEY,
      first_seen_at  INTEGER NOT NULL,
      last_seen_at   INTEGER NOT NULL,
      member_count   INTEGER NOT NULL DEFAULT 0,
      status         TEXT NOT NULL DEFAULT 'pending',
      decided_at     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_taxonomy_proposals_status
      ON taxonomy_proposals(status, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS scoping_telemetry (
      session_id      TEXT PRIMARY KEY REFERENCES scoping_sessions(id),
      flow_type       TEXT NOT NULL,
      started_at      INTEGER NOT NULL,
      user_turn_count INTEGER NOT NULL DEFAULT 0,
      proposal_count  INTEGER NOT NULL DEFAULT 0,
      approved_count  INTEGER NOT NULL DEFAULT 0,
      rejected_count  INTEGER NOT NULL DEFAULT 0,
      abandoned_at    INTEGER,
      last_event_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scoping_telemetry_started
      ON scoping_telemetry(started_at DESC);

    CREATE TABLE IF NOT EXISTS cluster_mutex (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      holder TEXT NOT NULL,
      acquired_at INTEGER NOT NULL
    );
  `);

  // Idempotent column additions on poller_state. SQLite ALTER TABLE ADD COLUMN
  // errors if the column exists, so guard with PRAGMA table_info.
  const pollerCols = db
    .prepare("PRAGMA table_info(poller_state)")
    .all() as { name: string }[];
  const pollerColNames = new Set(pollerCols.map((c) => c.name));
  if (!pollerColNames.has("last_cluster_at")) {
    db.exec("ALTER TABLE poller_state ADD COLUMN last_cluster_at INTEGER");
  }
  if (!pollerColNames.has("last_cluster_error")) {
    db.exec("ALTER TABLE poller_state ADD COLUMN last_cluster_error TEXT");
  }
  if (!pollerColNames.has("last_cluster_mode")) {
    db.exec("ALTER TABLE poller_state ADD COLUMN last_cluster_mode TEXT");
  }

  // Forward-compatible migrations. CREATE TABLE IF NOT EXISTS only fires the
  // first time, so once the table exists we have to ALTER manually for new
  // columns. ALTER TABLE ADD COLUMN is idempotent only if we check first.
  const cols = db
    .prepare("PRAGMA table_info(scoping_sessions)")
    .all() as { name: string }[];
  if (!cols.some((c) => c.name === "claude_session_uuid")) {
    db.exec("ALTER TABLE scoping_sessions ADD COLUMN claude_session_uuid TEXT");
  }
  if (!cols.some((c) => c.name === "recap_md")) {
    db.exec("ALTER TABLE scoping_sessions ADD COLUMN recap_md TEXT");
  }
  if (!cols.some((c) => c.name === "recap_at_turn")) {
    db.exec("ALTER TABLE scoping_sessions ADD COLUMN recap_at_turn INTEGER");
  }
  if (!cols.some((c) => c.name === "investigation_enabled")) {
    db.exec(
      "ALTER TABLE scoping_sessions ADD COLUMN investigation_enabled INTEGER NOT NULL DEFAULT 0"
    );
  }

  // Phase 3: name-based override recovery. Snapshotting the theme name at
  // override-time lets applyRowOverrides redirect to a slug-matched theme
  // when ids drift (rename, ad-hoc → candidate transition).
  const overrideCols = db
    .prepare("PRAGMA table_info(theme_row_overrides)")
    .all() as { name: string }[];
  if (!overrideCols.some((c) => c.name === "theme_name")) {
    db.exec("ALTER TABLE theme_row_overrides ADD COLUMN theme_name TEXT");
  }
  const devOverrideCols = db
    .prepare("PRAGMA table_info(dev_theme_overrides)")
    .all() as { name: string }[];
  if (!devOverrideCols.some((c) => c.name === "theme_name")) {
    db.exec("ALTER TABLE dev_theme_overrides ADD COLUMN theme_name TEXT");
  }

  return db;
}

type Row = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  refresh_expires_at: number;
  scope: string;
  open_id: string | null;
  name: string | null;
  updated_at: number;
};

export function getToken(): StoredToken | null {
  const row = getDb()
    .prepare("SELECT * FROM tokens WHERE id = 1")
    .get() as Row | undefined;
  if (!row) return null;
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    refreshExpiresAt: row.refresh_expires_at,
    scope: row.scope,
    openId: row.open_id,
    name: row.name,
    updatedAt: row.updated_at,
  };
}

export function saveToken(token: Omit<StoredToken, "updatedAt">): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO tokens (id, access_token, refresh_token, expires_at, refresh_expires_at, scope, open_id, name, updated_at)
       VALUES (1, @accessToken, @refreshToken, @expiresAt, @refreshExpiresAt, @scope, @openId, @name, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         refresh_expires_at = excluded.refresh_expires_at,
         scope = excluded.scope,
         open_id = excluded.open_id,
         name = excluded.name,
         updated_at = excluded.updated_at`
    )
    .run({ ...token, updatedAt: now });
}

export function clearToken(): void {
  getDb().prepare("DELETE FROM tokens WHERE id = 1").run();
}

export function updateProfile(openId: string, name: string): void {
  getDb()
    .prepare("UPDATE tokens SET open_id = ?, name = ?, updated_at = ? WHERE id = 1")
    .run(openId, name, Date.now());
}

// --- lark_cache helpers ---------------------------------------------------

export type CacheEntry<T = unknown> = {
  payload: T;
  fetchedAt: number;
};

export function getCacheEntry<T = unknown>(key: string): CacheEntry<T> | null {
  const row = getDb()
    .prepare("SELECT payload_json, fetched_at FROM lark_cache WHERE cache_key = ?")
    .get(key) as { payload_json: string; fetched_at: number } | undefined;
  if (!row) return null;
  try {
    return { payload: JSON.parse(row.payload_json) as T, fetchedAt: row.fetched_at };
  } catch {
    return null;
  }
}

export function setCacheEntry(key: string, payload: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO lark_cache (cache_key, payload_json, fetched_at)
       VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         payload_json = excluded.payload_json,
         fetched_at = excluded.fetched_at`
    )
    .run(key, JSON.stringify(payload), Date.now());
}

export function deleteCacheEntry(key: string): void {
  getDb().prepare("DELETE FROM lark_cache WHERE cache_key = ?").run(key);
}

/**
 * List all `lark_cache` keys that start with the given prefix, ordered
 * lexicographically descending (so date-suffixed keys come back newest-first
 * for `YYYY-MM-DD`-shaped suffixes). Used by the themes cache for retention
 * pruning + history reads.
 */
export function listCacheKeysStartingWith(prefix: string): string[] {
  const rows = getDb()
    .prepare(
      "SELECT cache_key FROM lark_cache WHERE cache_key LIKE ? ORDER BY cache_key DESC"
    )
    .all(`${prefix}%`) as { cache_key: string }[];
  return rows.map((r) => r.cache_key);
}

// --- sessions -------------------------------------------------------------

export const SESSION_COOKIE_NAME = "fd_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type SessionRow = {
  id: string;
  openId: string;
  createdAt: number;
  lastSeenAt: number;
  userAgent: string | null;
  ip: string | null;
};

export function createSession(
  openId: string,
  userAgent?: string | null,
  ip?: string | null
): string {
  const id = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  getDb()
    .prepare(
      "INSERT INTO sessions (id, open_id, created_at, last_seen_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(id, openId, now, now, userAgent ?? null, ip ?? null);
  return id;
}

export function getSession(id: string): SessionRow | null {
  const row = getDb()
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(id) as
    | {
        id: string;
        open_id: string;
        created_at: number;
        last_seen_at: number;
        user_agent: string | null;
        ip: string | null;
      }
    | undefined;
  if (!row) return null;
  // Expire stale sessions on lookup so we don't need a sweeper.
  if (Date.now() - row.last_seen_at > SESSION_TTL_MS) {
    deleteSession(id);
    return null;
  }
  return {
    id: row.id,
    openId: row.open_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    userAgent: row.user_agent,
    ip: row.ip,
  };
}

export function touchSession(id: string): void {
  getDb()
    .prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
    .run(Date.now(), id);
}

export function deleteSession(id: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function deleteAllSessionsForOpenId(openId: string): void {
  getDb().prepare("DELETE FROM sessions WHERE open_id = ?").run(openId);
}

// --- refresh mutex --------------------------------------------------------

/**
 * Try to acquire the singleton Lark-refresh mutex. Returns true if we now hold
 * it (no live holder, or previous holder's TTL expired). Caller MUST call
 * `releaseRefreshMutex(holder)` in a finally block.
 *
 * Mutex is a single row keyed id=1; serialization is via SQLite's write lock
 * inside `db.transaction()` (better-sqlite3 transactions are synchronous, so
 * no risk of awaiting inside the critical section).
 */
export function acquireRefreshMutex(holder: string, ttlMs: number): boolean {
  const db = getDb();
  const now = Date.now();
  const expireAt = now + ttlMs;
  const acquire = db.transaction((): boolean => {
    const row = db
      .prepare(
        "SELECT holder, expires_at FROM refresh_mutex WHERE id = 1"
      )
      .get() as { holder: string; expires_at: number } | undefined;
    if (row && row.expires_at > now) return false;
    db.prepare(
      `INSERT INTO refresh_mutex (id, holder, acquired_at, expires_at)
       VALUES (1, @holder, @now, @expireAt)
       ON CONFLICT(id) DO UPDATE SET
         holder = excluded.holder,
         acquired_at = excluded.acquired_at,
         expires_at = excluded.expires_at`
    ).run({ holder, now, expireAt });
    return true;
  });
  return acquire();
}

export function releaseRefreshMutex(holder: string): void {
  getDb()
    .prepare("DELETE FROM refresh_mutex WHERE id = 1 AND holder = ?")
    .run(holder);
}
