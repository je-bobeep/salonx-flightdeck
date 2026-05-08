// Server-side helpers for theme cluster fetch+compute. Used by the themes,
// linkage, and roadmap API routes — they all need the same blob.

import { fetchAllBd, projectBd } from "./data-derive";
import {
  assignNewRows,
  clusterBd,
  fallbackClusterBd,
  type BdInputRow,
} from "@flightdeck/themes/cluster";
import {
  readLastBlob,
  readPreviousThemes,
  readTodayCache,
  writeThemesCache,
} from "@flightdeck/themes/cache";
import type { Theme, ThemesBlob } from "@flightdeck/themes/shapes";
import { listRowOverrides } from "./theme-overrides-db";

export type ThemesFetchResult = {
  blob: ThemesBlob;
  fetchedAt: number;
  fresh: boolean;
};

/** Read today's cluster (or yesterday's fallback). Does NOT recompute on miss. */
export function readThemesCachedOnly(): ThemesFetchResult | null {
  return readTodayCache();
}

/** Hard cap on how many BD rows we send to Claude for clustering. Beyond
 * this we send the most-recently-created rows. Keeps the prompt bounded so
 * cluster latency stays under ~60s even when the BD log grows. */
const CLUSTER_MAX_ROWS = 80;

/** Wall-clock cap on a single Claude clustering call. Past this we abort and
 * fall back to deterministic Category × Sub-category grouping. Sonnet on a
 * 30-row payload measured ~235s end-to-end (most of which is API time, not
 * subprocess overhead — the Claude Code CLI prepends a ~19K-token preamble
 * before our cluster prompt). 300s gives enough headroom while still bailing
 * if something genuinely hangs. */
const CLUSTER_TIMEOUT_MS = 300_000;

function projectInputs(rows: ReturnType<typeof projectBd>[]): BdInputRow[] {
  return rows.map((r) => ({
    recordId: r.recordId,
    item: r.item,
    translate: r.translate,
    category: r.category,
    subCategory: r.subCategory,
    priority: r.priority,
    ageDays: r.ageDays,
    linkedDevIds: r.linkedDevIds,
    dateCreatedMs: r.dateCreatedMs,
  }));
}

async function fetchAndSampleInputs(): Promise<BdInputRow[]> {
  const raws = await fetchAllBd();
  const bdRows = raws.map((r) => projectBd(r));
  const candidates = bdRows.filter((r) => r.status !== "Done");
  // Always include unaddressed rows (no linked Dev, not deployed) — they're
  // the population Triage cares about. Fill remaining slots with most-recent
  // of the rest.
  const unaddressed = candidates.filter(
    (r) => !r.hasLinkedDev && !r.hasDayOfDeploying
  );
  const remaining = candidates
    .filter((r) => r.hasLinkedDev || r.hasDayOfDeploying)
    .sort(
      (a, b) =>
        (b.dateCreatedMs ?? b.dateRecordedMs ?? 0) -
        (a.dateCreatedMs ?? a.dateRecordedMs ?? 0)
    );
  const fillCount = Math.max(0, CLUSTER_MAX_ROWS - unaddressed.length);
  const sampled = [...unaddressed, ...remaining.slice(0, fillCount)];
  return projectInputs(sampled);
}

/** Synchronous deterministic-only path. Used by GET on cache miss so the UI
 * never waits ~4 min for a Claude call on first load. POST is the opt-in
 * trigger for the slow Claude path. */
export async function computeFallbackThemesNow(): Promise<ThemesFetchResult> {
  const inputs = await fetchAndSampleInputs();
  const themes = fallbackClusterBd(inputs);
  const themesAfterOverrides = applyRowOverrides(themes);
  const blob = writeThemesCache(themesAfterOverrides, "fallback", "full");
  return { blob, fetchedAt: Date.now(), fresh: true };
}

const DAY_MS = 24 * 60 * 60 * 1000;

const FNV_OFFSET = 2166136261;

function shortHash(ids: string[]): string {
  let h = FNV_OFFSET;
  const sorted = [...ids].sort().join(",");
  for (let i = 0; i < sorted.length; i++) {
    h ^= sorted.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36).slice(0, 6);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/**
 * Recompute volume / median age / rising / dominant categories from the
 * (possibly merged) member list. Used by the incremental path after we've
 * appended new BD ids into existing themes.
 */
function recomputeMetrics(themes: Theme[], byId: Map<string, BdInputRow>): Theme[] {
  const now = Date.now();
  return themes.map((t) => {
    const members = t.bdRecordIds
      .map((id) => byId.get(id))
      .filter((r): r is BdInputRow => !!r);
    const ages = members
      .map((r) => r.ageDays)
      .filter((v): v is number => typeof v === "number")
      .sort((a, b) => a - b);
    const newCount = members.reduce((acc, r) => {
      if (typeof r.dateCreatedMs === "number" && now - r.dateCreatedMs < 14 * DAY_MS)
        return acc + 1;
      return acc;
    }, 0);
    const devRecordIds = [
      ...new Set(members.flatMap((r) => r.linkedDevIds ?? [])),
    ];
    return {
      ...t,
      bdVolume: members.length,
      bdMedianAgeDays:
        ages.length === 0 ? null : ages[Math.floor(ages.length / 2)],
      rising: newCount >= 3,
      devRecordIds,
    };
  });
}

/**
 * Apply manual per-row theme overrides on top of a cluster result. Overrides
 * persist across incremental and from-scratch runs (the user's "no, this
 * goes here" judgement is sticky). Drops overrides that point at a theme
 * that no longer exists.
 */
function applyRowOverrides(themes: Theme[]): Theme[] {
  const overrides = listRowOverrides();
  if (overrides.size === 0) return themes;
  const themeById = new Map(themes.map((t) => [t.id, t]));
  // Strip overridden ids from any current home, then re-add them to the
  // override target.
  const overrideIds = new Set(overrides.keys());
  const stripped = themes.map((t) => ({
    ...t,
    bdRecordIds: t.bdRecordIds.filter((id) => !overrideIds.has(id)),
  }));
  for (const [bdId, themeId] of overrides) {
    const target = stripped.find((t) => t.id === themeId);
    if (!target) {
      console.warn(
        "[themes-server] dropping override bd=%s -> theme=%s (theme missing)",
        bdId,
        themeId
      );
      continue;
    }
    if (!target.bdRecordIds.includes(bdId)) target.bdRecordIds.push(bdId);
  }
  void themeById; // eslint reachability
  return stripped;
}

async function computeFromScratch(
  inputs: BdInputRow[]
): Promise<{ themes: Theme[]; mode: "claude" | "fallback" }> {
  const previous = readPreviousThemes();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CLUSTER_TIMEOUT_MS);
  let themes: Awaited<ReturnType<typeof clusterBd>> = null;
  try {
    themes = await clusterBd({
      rows: inputs,
      previousThemes: previous,
      model: "opus",
      abortSignal: ac.signal,
    });
  } catch (err) {
    console.warn(
      "[themes-server] clusterBd threw — falling back to deterministic grouping. err=%s",
      err instanceof Error ? err.message : String(err)
    );
    themes = null;
  } finally {
    clearTimeout(timer);
  }

  if (!themes || themes.length === 0) {
    console.warn(
      "[themes-server] Claude returned %s — using deterministic fallback over %d rows.",
      themes === null ? "no parseable output" : "zero themes",
      inputs.length
    );
    return { themes: fallbackClusterBd(inputs), mode: "fallback" };
  }
  return { themes, mode: "claude" };
}

async function computeIncremental(
  inputs: BdInputRow[],
  prevBlob: ThemesBlob
): Promise<{
  themes: Theme[];
  mode: "claude" | "fallback";
  runKind: "full" | "incremental";
}> {
  const byId = new Map<string, BdInputRow>();
  for (const r of inputs) byId.set(r.recordId, r);

  const existingAssignedIds = new Set<string>();
  for (const t of prevBlob.themes) {
    for (const id of t.bdRecordIds) existingAssignedIds.add(id);
  }
  const newRows = inputs.filter((r) => !existingAssignedIds.has(r.recordId));

  // No new rows? Just rebuild metrics over current rows so volume/median age
  // reflect the latest data, but keep assignments untouched.
  if (newRows.length === 0) {
    const themesPruned = prevBlob.themes.map((t) => ({
      ...t,
      bdRecordIds: t.bdRecordIds.filter((id) => byId.has(id)),
    }));
    return {
      themes: recomputeMetrics(themesPruned, byId),
      mode: "claude",
      runKind: "incremental",
    };
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CLUSTER_TIMEOUT_MS);
  let assignResult: Awaited<ReturnType<typeof assignNewRows>> = null;
  try {
    assignResult = await assignNewRows({
      newRows,
      existingThemes: prevBlob.themes,
      // Pass the full row map so existing themes get up-to-3 concrete item
      // examples in the prompt — lets Claude reliably bucket a new row like
      // "[Kanzashi] Show cancellation reason" even if the existing Kanzashi
      // theme was named semantically by the prior from-scratch run.
      rowLookup: byId,
      model: "sonnet",
      abortSignal: ac.signal,
    });
  } catch (err) {
    console.warn(
      "[themes-server] assignNewRows threw — falling back to from-scratch. err=%s",
      err instanceof Error ? err.message : String(err)
    );
    assignResult = null;
  } finally {
    clearTimeout(timer);
  }

  if (!assignResult) {
    console.warn(
      "[themes-server] incremental assign failed — running from-scratch instead."
    );
    const fs = await computeFromScratch(inputs);
    return { ...fs, runKind: "full" };
  }

  // Merge: append additions to existing themes, mint new themes from the
  // model's newThemes proposals (collapsing slug-collisions into existing).
  const existingNameSlugs = new Map<string, string>(); // slug -> theme.id
  for (const t of prevBlob.themes) {
    existingNameSlugs.set(slugify(t.name), t.id);
  }

  const merged: Theme[] = prevBlob.themes.map((t) => ({
    ...t,
    bdRecordIds: [...t.bdRecordIds.filter((id) => byId.has(id))],
  }));
  const themeIndex = new Map(merged.map((t) => [t.id, t]));

  for (const [themeId, ids] of assignResult.additions) {
    const target = themeIndex.get(themeId);
    if (!target) continue;
    for (const id of ids) {
      if (!target.bdRecordIds.includes(id)) target.bdRecordIds.push(id);
    }
  }

  for (const nt of assignResult.newThemes) {
    const slug = slugify(nt.name);
    const collision = existingNameSlugs.get(slug);
    if (collision) {
      // Treat as additions to the existing theme rather than minting a dup.
      const target = themeIndex.get(collision);
      if (target) {
        for (const id of nt.bdRecordIds) {
          if (!target.bdRecordIds.includes(id)) target.bdRecordIds.push(id);
        }
      }
      continue;
    }
    const newTheme: Theme = {
      id: `${slug}-${shortHash(nt.bdRecordIds)}`,
      name: nt.name,
      description: nt.description,
      bdRecordIds: [...new Set(nt.bdRecordIds)],
      devRecordIds: [],
      dominantCategories: [],
      dominantSubCategories: [],
      bdVolume: 0,
      bdMedianAgeDays: null,
      rising: false,
    };
    merged.push(newTheme);
    themeIndex.set(newTheme.id, newTheme);
    existingNameSlugs.set(slug, newTheme.id);
  }

  // Unplaced rows from the model — surface a warning. Don't fail the run;
  // these will likely get picked up next time, or the user can scratch.
  if (assignResult.unplaced.length > 0) {
    console.warn(
      "[themes-server] %d row(s) unplaced by incremental assign: %s",
      assignResult.unplaced.length,
      assignResult.unplaced.slice(0, 5).join(", ")
    );
  }

  return {
    themes: recomputeMetrics(merged, byId),
    mode: "claude",
    runKind: "incremental",
  };
}

export async function computeFreshThemes(
  opts: { mode?: "incremental" | "from-scratch" } = {}
): Promise<ThemesFetchResult> {
  const inputs = await fetchAndSampleInputs();
  const requested = opts.mode ?? "incremental";

  const prev = readLastBlob();

  // Force from-scratch when we have no usable previous claude blob.
  let mode: "incremental" | "from-scratch" = requested;
  if (!prev || prev.mode === "fallback" || prev.themes.length === 0) {
    if (requested === "incremental") {
      console.warn(
        "[themes-server] incremental requested but previous blob unusable (mode=%s themes=%d) — running from-scratch.",
        prev?.mode ?? "missing",
        prev?.themes.length ?? 0
      );
    }
    mode = "from-scratch";
  }

  if (mode === "incremental" && prev) {
    const inc = await computeIncremental(inputs, prev);
    const themesAfterOverrides = applyRowOverrides(inc.themes);
    const blob = writeThemesCache(
      themesAfterOverrides,
      inc.mode,
      inc.runKind
    );
    return { blob, fetchedAt: Date.now(), fresh: true };
  }

  const fs = await computeFromScratch(inputs);
  const themesAfterOverrides = applyRowOverrides(fs.themes);
  const blob = writeThemesCache(themesAfterOverrides, fs.mode, "full");
  return { blob, fetchedAt: Date.now(), fresh: true };
}

/** Cached if available, else computed. Used by routes that depend on themes. */
export async function getOrComputeThemes(): Promise<ThemesFetchResult> {
  const cached = readTodayCache();
  if (cached) {
    console.log(
      "[themes-server] cache hit (fresh=%s, themes=%d, fetched=%s)",
      cached.fresh,
      cached.blob.themes.length,
      new Date(cached.fetchedAt).toISOString()
    );
    return cached;
  }
  console.log("[themes-server] cache miss — computing fresh");
  return computeFreshThemes();
}

/** Look up a record_id → theme map (for tagging rows in views). */
export function buildBdToThemeMap(themes: Theme[]): Map<string, Theme> {
  const m = new Map<string, Theme>();
  for (const t of themes) {
    for (const id of t.bdRecordIds) m.set(id, t);
  }
  return m;
}
