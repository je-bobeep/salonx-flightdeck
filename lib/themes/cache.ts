// Theme cache, backed by the lark_cache table.
//
// One row per day under key `themes:bd:v1:<YYYY-MM-DD>`. We also maintain a
// "last computed" pointer so getThemes() can fall back to the most recent run
// rather than recomputing on every miss.

import {
  getCacheEntry,
  setCacheEntry,
  type CacheEntry,
} from "@flightdeck/auth/db";
import type { Theme, ThemesBlob } from "./shapes";

const DAILY_KEY_PREFIX = "themes:bd:v1:";
const LAST_KEY = "themes:bd:v1:last";

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
  mode: "claude" | "fallback",
  runKind: "full" | "incremental" = "full"
): ThemesBlob {
  const nowIso = new Date().toISOString();
  const previous = getCacheEntry<ThemesBlob>(LAST_KEY)?.payload;
  const prevProv = previous?.provenance;

  let provenance: ThemesBlob["provenance"];
  if (mode === "fallback") {
    // Don't pollute provenance counters from fallback runs. Carry forward
    // whatever was there so a subsequent claude run can resume tracking.
    provenance = prevProv;
  } else if (runKind === "incremental" && prevProv) {
    provenance = {
      lastFullAt: prevProv.lastFullAt,
      lastIncrementalAt: nowIso,
      incrementalSinceFull: prevProv.incrementalSinceFull + 1,
    };
  } else {
    // Full run (or first-ever claude run with no prior provenance).
    provenance = {
      lastFullAt: nowIso,
      lastIncrementalAt: null,
      incrementalSinceFull: 0,
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
  return blob;
}

// Re-export so callers can read the raw entry if they want the timestamp.
export type { CacheEntry };
