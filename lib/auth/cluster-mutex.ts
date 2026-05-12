import { getDb } from "./db";

// Stale-lock cutoff. Comfortably exceeds the 5-min cluster timeout so a real
// run-in-progress is never overridden, but a crashed holder is.
const STALE_AGE_MS = 10 * 60 * 1000;

export function acquireClusterMutex(holder: "poller" | "user"): boolean {
  const db = getDb();
  const now = Date.now();
  const existing = db
    .prepare("SELECT holder, acquired_at FROM cluster_mutex WHERE id = 1")
    .get() as { holder: string; acquired_at: number } | undefined;

  if (existing) {
    if (now - existing.acquired_at < STALE_AGE_MS) return false;
    console.warn(
      "[cluster-mutex] overriding stale lock held by %s since %s",
      existing.holder,
      new Date(existing.acquired_at).toISOString()
    );
  }

  db.prepare(
    "INSERT INTO cluster_mutex (id, holder, acquired_at) VALUES (1, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET holder = excluded.holder, acquired_at = excluded.acquired_at"
  ).run(holder, now);

  return true;
}

export function releaseClusterMutex(): void {
  const db = getDb();
  db.prepare("DELETE FROM cluster_mutex WHERE id = 1").run();
}
