// taxonomy_proposals CRUD. Brand-new theme names emitted by Claude (within
// MAX_NEW_THEMES_PER_RUN) land here for explicit accept/reject in the UI.
// Accepted proposals are a record only — the user manually edits
// lib/themes/taxonomy.ts to add a name to the canon. The status flag in this
// table just remembers the decision so the UI doesn't keep re-prompting.
//
// Schema lives in lib/auth/db.ts. This module mirrors the shape of
// theme-overrides-db.ts (lazy connection, FLIGHTDECK_DB_PATH override,
// try/catch on table-missing).

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

export type ProposalStatus = "pending" | "accepted" | "rejected";

export type PendingProposal = {
  name: string;
  firstSeenAt: number;
  lastSeenAt: number;
  memberCount: number;
};

/**
 * UPSERT each name. Bumps last_seen_at and updates member_count to the latest
 * cluster size. Status is left untouched if the row already exists with
 * 'accepted' or 'rejected' — we don't want a re-emit to revert the user's
 * decision. New rows default to 'pending'.
 */
export function recordProposals(
  names: string[],
  memberCounts: Record<string, number>
): void {
  if (names.length === 0) return;
  try {
    const now = Date.now();
    const stmt = db().prepare(
      `INSERT INTO taxonomy_proposals (name, first_seen_at, last_seen_at, member_count, status)
       VALUES (?, ?, ?, ?, 'pending')
       ON CONFLICT(name) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         member_count = excluded.member_count`
    );
    const tx = db().transaction((rows: string[]) => {
      for (const name of rows) {
        const count = memberCounts[name] ?? 0;
        stmt.run(name, now, now, count);
      }
    });
    tx(names);
  } catch (e) {
    console.warn(
      "[taxonomy-proposals] recordProposals failed: %s",
      e instanceof Error ? e.message : String(e)
    );
  }
}

export function listPendingProposals(): PendingProposal[] {
  try {
    const rows = db()
      .prepare(
        `SELECT name, first_seen_at, last_seen_at, member_count
           FROM taxonomy_proposals
          WHERE status = 'pending'
          ORDER BY last_seen_at DESC`
      )
      .all() as Array<{
      name: string;
      first_seen_at: number;
      last_seen_at: number;
      member_count: number;
    }>;
    return rows.map((r) => ({
      name: r.name,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
      memberCount: r.member_count,
    }));
  } catch (e) {
    console.warn(
      "[taxonomy-proposals] listPendingProposals failed (table may not exist yet): %s",
      e instanceof Error ? e.message : String(e)
    );
    return [];
  }
}

function decide(name: string, status: "accepted" | "rejected"): void {
  try {
    db()
      .prepare(
        `UPDATE taxonomy_proposals
            SET status = ?, decided_at = ?
          WHERE name = ?`
      )
      .run(status, Date.now(), name);
  } catch (e) {
    console.warn(
      "[taxonomy-proposals] decide(%s) failed: %s",
      status,
      e instanceof Error ? e.message : String(e)
    );
  }
}

export function acceptProposal(name: string): void {
  decide(name, "accepted");
}

export function rejectProposal(name: string): void {
  decide(name, "rejected");
}
