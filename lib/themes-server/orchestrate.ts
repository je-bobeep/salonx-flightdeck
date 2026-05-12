// Server-side helpers for theme cluster fetch+compute. Used by the themes,
// linkage, and roadmap API routes — they all need the same blob.

import { fetchAllBd, fetchAllDev, projectBd, projectDev } from "./fetch";
import type { BdRow, DevRow } from "./types";
import {
  assignNewRows,
  clusterBd,
  extractNewThemeNames,
  type BdInputRow,
  type FeedbackInputRow,
} from "@flightdeck/themes/cluster";
import {
  readLastBlob,
  readTodayCache,
  writeThemesCache,
} from "@flightdeck/themes/cache";
import type { Theme, ThemesBlob } from "@flightdeck/themes/shapes";
import { listRowOverrides } from "./theme-overrides-db";
import { recordProposals } from "./taxonomy-proposals-db";

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

const DAY_MS = 24 * 60 * 60 * 1000;

// Dev ageDays derived from lastModifiedMs as a proxy — Dev has no Date Created
// column on DevRow today. Less consistent than BD ageDays; bdMedianAgeDays on
// themes stays BD-only.
function projectDevForCluster(rows: DevRow[]): FeedbackInputRow[] {
  return rows.map((r) => ({
    recordId: r.recordId,
    source: "dev" as const,
    item: r.storyDescription || r.description || "",
    translate: r.storyDescription || r.description || "",
    category: r.module,
    subCategory: "",
    priority: r.priority,
    ageDays:
      r.lastModifiedMs !== null
        ? Math.max(0, Math.floor((Date.now() - r.lastModifiedMs) / DAY_MS))
        : null,
    linkedDevIds: [],
    dateCreatedMs: r.lastModifiedMs, // best-available signal for "rising"
  }));
}

function projectInputs(rows: ReturnType<typeof projectBd>[]): BdInputRow[] {
  return rows.map((r) => ({
    recordId: r.recordId,
    source: "bd" as const,
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

async function fetchAndSampleInputs(): Promise<FeedbackInputRow[]> {
  const [bdRaws, devRaws] = await Promise.all([fetchAllBd(), fetchAllDev()]);
  const bdRows = bdRaws.map((r) => projectBd(r));
  const devRows = devRaws.map((r) => projectDev(r));

  // BD: status != "Done"
  const bdCandidates = bdRows.filter((r) => r.status !== "Done");

  // Dev: "non-shipped" filter. Reuse the same logic as RoadmapView — see
  // apps/dashboard/components/views/RoadmapView.tsx:43 for the canonical
  // description. Rows are non-shipped when status is NOT in the terminal set
  // AND releaseDate is empty. Use whatever the existing isDevShipped helper
  // is named; if it doesn't exist, inline the predicate here.
  // Mirrors the "done" bucket in apps/dashboard/lib/status.ts — the canonical
  // shipped/terminal set for Feature Development rows.
  const TERMINAL_DEV_STATUSES = new Set(["Released", "Done", "Won't Do"]);
  const devCandidates = devRows.filter(
    (r) => !TERMINAL_DEV_STATUSES.has(r.status) && !r.releaseDate
  );

  // Sample priority order: unaddressed BD → push Dev (no BD link) → fill with
  // most-recent of the rest of both populations.
  const unaddressedBd = bdCandidates.filter(
    (r) => !r.hasLinkedDev && !r.hasDayOfDeploying
  );
  const pushDev = devCandidates.filter((r) => r.bdLinkIds.length === 0);

  type TaggedRow =
    | { kind: "bd"; row: BdRow }
    | { kind: "dev"; row: DevRow };

  const tagBd = (r: BdRow): TaggedRow => ({ kind: "bd", row: r });
  const tagDev = (r: DevRow): TaggedRow => ({ kind: "dev", row: r });

  // Priority order: unaddressed BD → push Dev → most-recent of the rest.
  const restBd = bdCandidates.filter(
    (r) => r.hasLinkedDev || r.hasDayOfDeploying
  );
  const pullDev = devCandidates.filter((r) => r.bdLinkIds.length > 0);

  const rest: TaggedRow[] = [
    ...restBd.map(tagBd),
    ...pullDev.map(tagDev),
  ].sort((a, b) => {
    const am =
      a.kind === "bd"
        ? a.row.dateCreatedMs ?? a.row.dateRecordedMs ?? 0
        : a.row.lastModifiedMs ?? 0;
    const bm =
      b.kind === "bd"
        ? b.row.dateCreatedMs ?? b.row.dateRecordedMs ?? 0
        : b.row.lastModifiedMs ?? 0;
    return bm - am;
  });

  const sampled: TaggedRow[] = [
    ...unaddressedBd.map(tagBd),
    ...pushDev.map(tagDev),
    ...rest,
  ].slice(0, CLUSTER_MAX_ROWS);

  const bdSampled = sampled
    .filter((s): s is { kind: "bd"; row: BdRow } => s.kind === "bd")
    .map((s) => s.row);
  const devSampled = sampled
    .filter((s): s is { kind: "dev"; row: DevRow } => s.kind === "dev")
    .map((s) => s.row);

  return [...projectInputs(bdSampled), ...projectDevForCluster(devSampled)];
}

/**
 * Synchronous "unavailable" path. Used by GET on cache miss so the UI never
 * waits ~4 min for a Claude call on first load. Returns an explicit empty
 * blob with `mode: "unavailable"`; POST (Re-cluster) is the explicit trigger
 * for the slow Claude path. We deliberately do NOT synthesize fallback
 * Sub-category themes here — that was the regression mode that motivated
 * theme-clustering-v2.
 */
export async function computeUnavailableNow(): Promise<ThemesFetchResult> {
  return {
    blob: {
      computedAt: new Date().toISOString(),
      mode: "unavailable" as const,
      themes: [],
      provenance: undefined,
    },
    fetchedAt: Date.now(),
    fresh: true,
  };
}

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
 * that no longer exists, except when name-based recovery succeeds.
 *
 * Phase 3 of theme-clustering-v2: when an override's saved theme_id is
 * missing from the new themes BUT a current theme has a slug-matching name
 * to the override's saved theme_name, redirect the override to that theme.
 * Survives renames within the canonical vocabulary.
 */
function applyRowOverrides(themes: Theme[]): Theme[] {
  const overrides = listRowOverrides();
  if (overrides.size === 0) return themes;
  // Strip overridden ids from any current home, then re-add them to the
  // override target.
  const overrideIds = new Set(overrides.keys());
  const stripped = themes.map((t) => ({
    ...t,
    bdRecordIds: t.bdRecordIds.filter((id) => !overrideIds.has(id)),
  }));
  // slug → theme map for name-based recovery.
  const themeBySlug = new Map<string, Theme>();
  for (const t of stripped) themeBySlug.set(slugify(t.name), t);

  for (const [bdId, override] of overrides) {
    let target = stripped.find((t) => t.id === override.themeId);
    if (!target && override.themeName) {
      const recovered = themeBySlug.get(slugify(override.themeName));
      if (recovered) {
        console.warn(
          "[themes-server] override bd=%s recovered by name match: themeId=%s -> %s (name=%s)",
          bdId,
          override.themeId,
          recovered.id,
          override.themeName
        );
        target = recovered;
      }
    }
    if (!target) {
      console.warn(
        "[themes-server] dropping override bd=%s -> theme=%s (theme missing, name=%s)",
        bdId,
        override.themeId,
        override.themeName ?? "<null>"
      );
      continue;
    }
    if (!target.bdRecordIds.includes(bdId)) target.bdRecordIds.push(bdId);
  }
  return stripped;
}

/** Build a {themeName: bdRecordIds.length} map for taxonomy_proposals
 * member-count tracking. */
function buildMemberCountMap(themes: Theme[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of themes) out[t.name] = t.bdRecordIds.length;
  return out;
}

async function computeFromScratch(
  inputs: BdInputRow[]
): Promise<{ themes: Theme[]; mode: "claude" | "unavailable" }> {
  // Gate `previousThemes` on the prior blob's mode. If the last good blob was
  // a fallback (Sub-category bucketing) or unavailable (no themes), we MUST
  // NOT pass those names back into the cluster prompt — the prompt's "reuse
  // when ≥70% members overlap" clause would otherwise leak Sub-category-shaped
  // names forward into a real Claude run. Phase 2 of theme-clustering-v2.
  const prevBlob = readLastBlob();
  const usablePrev =
    prevBlob && prevBlob.mode === "claude" ? prevBlob.themes : [];
  if (prevBlob && prevBlob.mode !== "claude") {
    console.warn(
      "[themes-server] previous blob mode=%s — discarding previousThemes to prevent name leakage into clusterBd.",
      prevBlob.mode
    );
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CLUSTER_TIMEOUT_MS);
  let themes: Awaited<ReturnType<typeof clusterBd>> = null;
  try {
    themes = await clusterBd({
      rows: inputs,
      previousThemes: usablePrev,
      model: "opus",
      abortSignal: ac.signal,
    });
  } catch (err) {
    console.warn(
      "[themes-server] clusterBd threw — surfacing 'unavailable' blob. err=%s",
      err instanceof Error ? err.message : String(err)
    );
    themes = null;
  } finally {
    clearTimeout(timer);
  }

  if (!themes || themes.length === 0) {
    console.warn(
      "[themes-server] Claude returned %s — no fallback render. Surfacing empty 'unavailable' blob.",
      themes === null ? "no parseable output" : "zero themes"
    );
    return { themes: [], mode: "unavailable" as const };
  }
  return { themes, mode: "claude" };
}

async function computeIncremental(
  inputs: BdInputRow[],
  prevBlob: ThemesBlob
): Promise<{
  themes: Theme[];
  mode: "claude" | "unavailable";
  runKind: "full" | "incremental";
  /** Count of brand-new themes minted by this incremental run. Persisted into
   * provenance for the Phase 4 drift signal — >0 forces from-scratch next time. */
  newThemeCount: number;
}> {
  const byId = new Map<string, BdInputRow>();
  for (const r of inputs) byId.set(r.recordId, r);

  const existingAssignedIds = new Set<string>();
  for (const t of prevBlob.themes) {
    for (const id of t.bdRecordIds) existingAssignedIds.add(id);
    for (const id of t.devRecordIds) existingAssignedIds.add(id);
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
      newThemeCount: 0,
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
      model: "opus",
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
    return { ...fs, runKind: "full", newThemeCount: 0 };
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

  let mintedThemeCount = 0;
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
    mintedThemeCount += 1;
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
    newThemeCount: mintedThemeCount,
  };
}

const SEVEN_DAYS_MS = 7 * DAY_MS;

export async function computeFreshThemes(
  opts: { mode?: "incremental" | "from-scratch" } = {}
): Promise<ThemesFetchResult> {
  const inputs = await fetchAndSampleInputs();
  const requested = opts.mode ?? "incremental";

  const prev = readLastBlob();

  // Drift bounding (Phase 4 of theme-clustering-v2): force from-scratch when
  //   (a) prior blob is missing / non-claude / empty,
  //   (b) ≥7 days since the last full recompute, OR
  //   (c) the most recent incremental run minted ≥1 new theme — strong signal
  //       that the existing canon no longer fits incoming rows.
  let mode: "incremental" | "from-scratch" = requested;
  let promoteReason: string | null = null;

  if (!prev || prev.mode !== "claude" || prev.themes.length === 0) {
    mode = "from-scratch";
    promoteReason = `prior blob unusable (mode=${prev?.mode ?? "missing"} themes=${prev?.themes.length ?? 0})`;
  } else if (mode === "incremental") {
    const lastFullAt = prev.provenance?.lastFullAt
      ? Date.parse(prev.provenance.lastFullAt)
      : null;
    const lastNewCount = prev.provenance?.lastIncrementalNewThemeCount ?? 0;
    if (lastFullAt === null || Number.isNaN(lastFullAt)) {
      mode = "from-scratch";
      promoteReason = "no lastFullAt timestamp";
    } else if (Date.now() - lastFullAt > SEVEN_DAYS_MS) {
      mode = "from-scratch";
      promoteReason = `>7d since lastFullAt (${prev.provenance?.lastFullAt})`;
    } else if (lastNewCount > 0) {
      mode = "from-scratch";
      promoteReason = `latest incremental minted ${lastNewCount} new theme(s) — drift signal`;
    }
  }

  if (promoteReason && requested === "incremental") {
    console.warn(
      "[themes-server] promoting incremental → from-scratch: %s",
      promoteReason
    );
  }

  if (mode === "incremental" && prev) {
    const inc = await computeIncremental(inputs, prev);
    const themesAfterOverrides = applyRowOverrides(inc.themes);
    if (inc.mode === "claude" && themesAfterOverrides.length > 0) {
      // Record any brand-new (non-canonical) names that survived the
      // strict-cap retry path so the user can accept/reject them in the UI.
      recordProposals(
        extractNewThemeNames(themesAfterOverrides),
        buildMemberCountMap(themesAfterOverrides)
      );
    }
    const blob = writeThemesCache(
      themesAfterOverrides,
      inc.mode,
      inc.runKind,
      inc.newThemeCount
    );
    return { blob, fetchedAt: Date.now(), fresh: true };
  }

  const fs = await computeFromScratch(inputs);
  const themesAfterOverrides = applyRowOverrides(fs.themes);
  if (fs.mode === "claude" && themesAfterOverrides.length > 0) {
    recordProposals(
      extractNewThemeNames(themesAfterOverrides),
      buildMemberCountMap(themesAfterOverrides)
    );
  }
  const blob = writeThemesCache(themesAfterOverrides, fs.mode, "full", 0);
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
