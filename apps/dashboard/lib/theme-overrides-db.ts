// Manual per-row "Move to theme" overrides. Sticky across incremental and
// from-scratch cluster runs — the user's explicit decision wins.
//
// Schema lives in lib/auth/db.ts (canonical migration spot).

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

export function listRowOverrides(): Map<string, string> {
  try {
    const rows = db()
      .prepare(`SELECT bd_record_id, theme_id FROM theme_row_overrides`)
      .all() as Array<{ bd_record_id: string; theme_id: string }>;
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.bd_record_id, r.theme_id);
    return m;
  } catch (e) {
    // Table may not exist on first boot before getDb() runs. Don't blow up
    // the cluster pipeline — return empty.
    console.warn(
      "[theme-overrides] read failed (table may not exist yet): %s",
      e instanceof Error ? e.message : String(e)
    );
    return new Map();
  }
}

export function setRowOverride(bdRecordId: string, themeId: string): void {
  db()
    .prepare(
      `INSERT INTO theme_row_overrides (bd_record_id, theme_id, set_at)
       VALUES (?, ?, ?)
       ON CONFLICT(bd_record_id) DO UPDATE SET
         theme_id = excluded.theme_id,
         set_at   = excluded.set_at`
    )
    .run(bdRecordId, themeId, Date.now());
}

export function clearRowOverride(bdRecordId: string): void {
  db().prepare(`DELETE FROM theme_row_overrides WHERE bd_record_id = ?`).run(bdRecordId);
}

export function listDevOverrides(): Map<string, string> {
  try {
    const rows = db()
      .prepare(`SELECT dev_record_id, theme_id FROM dev_theme_overrides`)
      .all() as Array<{ dev_record_id: string; theme_id: string }>;
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.dev_record_id, r.theme_id);
    return m;
  } catch (e) {
    // Table may not exist on first boot before getDb() runs. Don't blow up
    // the roadmap pipeline — return empty.
    console.warn(
      "[dev-theme-overrides] read failed (table may not exist yet): %s",
      e instanceof Error ? e.message : String(e)
    );
    return new Map();
  }
}

export function setDevOverride(devRecordId: string, themeId: string): void {
  db()
    .prepare(
      `INSERT INTO dev_theme_overrides (dev_record_id, theme_id, set_at)
       VALUES (?, ?, ?)
       ON CONFLICT(dev_record_id) DO UPDATE SET
         theme_id = excluded.theme_id,
         set_at   = excluded.set_at`
    )
    .run(devRecordId, themeId, Date.now());
}

export function clearDevOverride(devRecordId: string): void {
  db().prepare(`DELETE FROM dev_theme_overrides WHERE dev_record_id = ?`).run(devRecordId);
}
