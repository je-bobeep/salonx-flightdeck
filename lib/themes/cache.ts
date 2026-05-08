// Theme cache, backed by the lark_cache table.
//
// One row per day under key `themes:bd:v1:<YYYY-MM-DD>`. We also maintain a
// "last computed" pointer so getThemes() can fall back to the most recent run
// rather than recomputing on every miss.

import {
  deleteCacheEntry,
  getCacheEntry,
  listCacheKeysStartingWith,
  setCacheEntry,
  type CacheEntry,
} from "@flightdeck/auth/db";
import type { Theme, ThemesBlob } from "./shapes";

const DAILY_KEY_PREFIX = "themes:bd:v1:";
const LAST_KEY = "themes:bd:v1:last";
const DAILY_KEY_DATE_RE = /^themes:bd:v1:(\d{4}-\d{2}-\d{2})$/;
const DAILY_RETENTION_COUNT = 14;

function todayKey(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${DAILY_KEY_PREFIX}${y}-${m}-${d}`;
}

export type CachedThemes = {
  blob: ThemesBlob;
  fetchedAt: number;
  /** Whether this came from today's bucket vs a fallback. */
  fresh: boolean;
};

export function readTodayCache(): CachedThemes | null {
  const key = todayKey();
  const today = getCacheEntry<ThemesBlob>(key);
  if (today) {
    return { blob: today.payload, fetchedAt: today.fetchedAt, fresh: true };
  }
  // Fallback: most-recently-written cluster (under "last" pointer)
  const last = getCacheEntry<ThemesBlob>(LAST_KEY);
  if (last) {
    return { blob: last.payload, fetchedAt: last.fetchedAt, fresh: false };
  }
  return null;
}

export function readPreviousThemes(): Theme[] {
  const last = getCacheEntry<ThemesBlob>(LAST_KEY);
  return last?.payload?.themes ?? [];
}

export function readLastBlob(): ThemesBlob | null {
  const last = getCacheEntry<ThemesBlob>(LAST_KEY);
  return last?.payload ?? null;
}

export function writeThemesCache(
  themes: Theme[],
  mode: "claude" | "fallback" | "unavailable",
  runKind: "full" | "incremental" = "full",
  newThemeCount: number = 0
): ThemesBlob {
  const nowIso = new Date().toISOString();
  const previous = getCacheEntry<ThemesBlob>(LAST_KEY)?.payload;
  const prevProv = previous?.provenance;

  // Phase 2 of theme-clustering-v2: refuse to persist fallback (Sub-category
  // bucketing) writes — that path was the user-visible regression. Synthesize
  // an empty "unavailable" blob with provenance carried forward, but DO NOT
  // touch today's daily bucket nor the LAST_KEY pointer. Existing callers get
  // back a coherent ThemesBlob without the bad data leaking into cache.
  if (mode === "fallback") {
    console.warn(
      "[themes/cache] writeThemesCache called with mode='fallback' — refusing to persist; returning synthesized 'unavailable' blob."
    );
    return {
      computedAt: nowIso,
      mode: "unavailable",
      themes: [],
      provenance: prevProv,
    };
  }

  // "unavailable" is similarly non-persistable — we don't want to overwrite a
  // good cluster from a prior day with an empty failure-mode blob. Return the
  // synthesized blob to the caller for response shaping; cache untouched.
  if (mode === "unavailable") {
    return {
      computedAt: nowIso,
      mode: "unavailable",
      themes: [],
      provenance: prevProv,
    };
  }

  let provenance: ThemesBlob["provenance"];
  if (runKind === "incremental" && prevProv) {
    provenance = {
      lastFullAt: prevProv.lastFullAt,
      lastIncrementalAt: nowIso,
      incrementalSinceFull: prevProv.incrementalSinceFull + 1,
      lastIncrementalNewThemeCount: newThemeCount,
    };
  } else {
    // Full run (or first-ever claude run with no prior provenance). Reset the
    // drift signal: a fresh from-scratch run nullifies any prior new-theme tally.
    provenance = {
      lastFullAt: nowIso,
      lastIncrementalAt: null,
      incrementalSinceFull: 0,
      lastIncrementalNewThemeCount: 0,
    };
  }

  const blob: ThemesBlob = {
    computedAt: nowIso,
    mode,
    themes,
    provenance,
  };
  setCacheEntry(todayKey(), blob);
  setCacheEntry(LAST_KEY, blob);

  // Retention: keep only the most recent N daily buckets. Done after the
  // write so today's bucket is always inside the keep-window.
  pruneOldDailyBuckets();
  return blob;
}

/**
 * Drops all daily theme buckets older than the most recent N (default 14).
 * The `:last` pointer is never touched by this — only the date-suffixed keys.
 */
export function pruneOldDailyBuckets(): void {
  const keys = listCacheKeysStartingWith(DAILY_KEY_PREFIX);
  const dated = keys
    .map((k) => {
      const m = DAILY_KEY_DATE_RE.exec(k);
      return m ? { key: k, dateKey: m[1] } : null;
    })
    .filter((v): v is { key: string; dateKey: string } => v !== null)
    // Most-recent date first.
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0));

  for (const entry of dated.slice(DAILY_RETENTION_COUNT)) {
    deleteCacheEntry(entry.key);
  }
}

/**
 * Most-recent N daily theme buckets, newest-first. Excludes the `:last`
 * pointer. Malformed payloads (parse failures) are skipped silently.
 */
export function readDailyBucketHistory(
  maxDays = DAILY_RETENTION_COUNT
): Array<{ dateKey: string; payload: ThemesBlob; fetchedAt: number }> {
  const keys = listCacheKeysStartingWith(DAILY_KEY_PREFIX);
  const dated = keys
    .map((k) => {
      const m = DAILY_KEY_DATE_RE.exec(k);
      return m ? { key: k, dateKey: m[1] } : null;
    })
    .filter((v): v is { key: string; dateKey: string } => v !== null)
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0))
    .slice(0, maxDays);

  const out: Array<{ dateKey: string; payload: ThemesBlob; fetchedAt: number }> =
    [];
  for (const entry of dated) {
    const cached = getCacheEntry<ThemesBlob>(entry.key);
    if (!cached) continue;
    const payload = cached.payload;
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof payload.computedAt !== "string" ||
      !Array.isArray(payload.themes)
    ) {
      continue;
    }
    out.push({
      dateKey: entry.dateKey,
      payload,
      fetchedAt: cached.fetchedAt,
    });
  }
  return out;
}

// Re-export so callers can read the raw entry if they want the timestamp.
export type { CacheEntry };
