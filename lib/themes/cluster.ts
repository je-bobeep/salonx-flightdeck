// Cluster BD-feedback rows into themes via Claude one-shot.
//
// The caller passes in a normalized list (id + minimal fields) and we return
// a fully-populated Theme[]. We compute volume, median age, dominantCategories,
// and `rising` here in TS — Claude only does the semantic grouping.

import { runClaudeOneShot } from "@flightdeck/claude/runner";
import {
  assignBdSystemPrompt,
  clusterBdSystemPrompt,
} from "./prompts/cluster-bd";
import type { Theme } from "./shapes";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Minimal BD row fields needed for clustering. Caller projects from BdRow.
 * Keeping this shape narrow keeps the prompt small (cheaper) and decoupled
 * from the full BdRow shape.
 */
export type BdInputRow = {
  recordId: string;
  item: string;
  translate: string;
  category: string[];
  subCategory: string;
  priority: string;
  ageDays: number | null;
  linkedDevIds: string[];
  /** Used to compute `rising`. */
  dateCreatedMs: number | null;
};

export type ClusterOptions = {
  rows: BdInputRow[];
  /** Theme names from the previous cluster run, for stable naming. */
  previousThemes?: { id: string; name: string; bdRecordIds: string[] }[];
  abortSignal?: AbortSignal;
  model?: string;
};

/** Full Theme objects from the previous cluster run, used by incremental
 * mode to keep existing assignments sticky. The dashboard-side caller
 * always passes the most recent successful claude blob; the cluster route
 * is responsible for falling back to from-scratch when previous mode was
 * "fallback" (deterministic — incoherent themes can't be appended to). */
export type IncrementalAssignOptions = {
  newRows: BdInputRow[];
  existingThemes: Theme[];
  /** Optional lookup from BD record_id → BdInputRow for ALL rows known this
   * cycle (existing + new). When provided, the assigner injects up to 3
   * example item-strings per existing theme into the prompt — gives Claude
   * concrete anchors so a `[Kanzashi]`-shaped new row reliably lands in the
   * Kanzashi cluster even when the theme name is semantic ("Cancellation
   * UX"). When omitted the prompt falls back to name + description only. */
  rowLookup?: Map<string, BdInputRow>;
  abortSignal?: AbortSignal;
  model?: string;
};

type AssignClaudeOutput = {
  assignments?: { record_id?: unknown; theme_id?: unknown }[];
  newThemes?: {
    tempId?: unknown;
    name?: unknown;
    description?: unknown;
    bdRecordIds?: unknown;
  }[];
};

/** Result shape for an incremental assign call. The caller merges these
 * into the existing themes and recomputes metrics over the merged set. */
export type IncrementalAssignResult = {
  /** existing-theme membership additions: theme_id -> [bd_record_id...] */
  additions: Map<string, string[]>;
  newThemes: Array<{
    tempId: string;
    name: string;
    description: string;
    bdRecordIds: string[];
  }>;
  /** Rows the model failed to place (no assignment, no newTheme). The caller
   * decides what to do — typically falls them back into a "from-scratch" run. */
  unplaced: string[];
};

type ClaudeOutput = {
  themes?: {
    name?: unknown;
    description?: unknown;
    bdRecordIds?: unknown;
    dominantCategories?: unknown;
    dominantSubCategories?: unknown;
  }[];
};

/**
 * Run the clustering call. Returns the fully-derived Theme[] or null if the
 * Claude output couldn't be parsed.
 */
export async function clusterBd(opts: ClusterOptions): Promise<Theme[] | null> {
  if (opts.rows.length === 0) return [];

  const prevNames = opts.previousThemes?.map((t) => t.name);
  const systemPrompt = clusterBdSystemPrompt({ previousThemeNames: prevNames });

  // Trim down what we send to keep the prompt small. Translate beats item if
  // both present (English first).
  const promptRows = opts.rows.map((r) => ({
    record_id: r.recordId,
    item: (r.translate || r.item).slice(0, 240),
    category: r.category,
    subCategory: r.subCategory ? r.subCategory.trim() : "",
    priority: r.priority,
    ageDays: r.ageDays,
  }));

  const result = await runClaudeOneShot({
    systemPrompt,
    userMessage: JSON.stringify(promptRows),
    model: opts.model ?? "sonnet",
    abortSignal: opts.abortSignal,
    disableMcp: true,
  });

  if (!result.json || typeof result.json !== "object") {
    // Surface the raw text + stderr to server logs so we can diagnose Claude
    // wrapper variations. Truncated to keep logs sane.
    console.warn(
      "[themes/cluster] Claude returned unparseable output. resultText[0..400]=%s stderr[0..400]=%s",
      (result.resultText || "").slice(0, 400),
      (result.stderr || "").slice(0, 400)
    );
    return null;
  }
  const out = result.json as ClaudeOutput;
  if (!Array.isArray(out.themes)) {
    console.warn(
      "[themes/cluster] Claude JSON missing 'themes' array. keys=%s",
      Object.keys(out).join(",")
    );
    return null;
  }

  const byId = new Map<string, BdInputRow>();
  for (const r of opts.rows) byId.set(r.recordId, r);

  const now = Date.now();
  const themes: Theme[] = [];

  for (const raw of out.themes) {
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const description =
      typeof raw.description === "string" ? raw.description.trim() : "";
    const bdRecordIdsRaw = Array.isArray(raw.bdRecordIds)
      ? raw.bdRecordIds.filter(
          (s): s is string => typeof s === "string" && byId.has(s)
        )
      : [];
    const dominantCategories = Array.isArray(raw.dominantCategories)
      ? raw.dominantCategories.filter((s): s is string => typeof s === "string")
      : [];
    const dominantSubCategories = Array.isArray(raw.dominantSubCategories)
      ? raw.dominantSubCategories.filter(
          (s): s is string => typeof s === "string"
        )
      : [];

    if (!name || bdRecordIdsRaw.length === 0) continue;

    // Dedup
    const bdRecordIds = [...new Set(bdRecordIdsRaw)];

    // Joined Dev members
    const devRecordIds = [
      ...new Set(
        bdRecordIds.flatMap((id) => byId.get(id)?.linkedDevIds ?? [])
      ),
    ];

    // Median age days (skip rows with null age)
    const ages = bdRecordIds
      .map((id) => byId.get(id)?.ageDays)
      .filter((v): v is number => typeof v === "number")
      .sort((a, b) => a - b);
    const bdMedianAgeDays =
      ages.length === 0 ? null : ages[Math.floor(ages.length / 2)];

    // Rising: ≥3 members with dateCreatedMs in last 14 days
    const newCount = bdRecordIds.reduce((acc, id) => {
      const ms = byId.get(id)?.dateCreatedMs;
      if (typeof ms === "number" && now - ms < 14 * DAY_MS) return acc + 1;
      return acc;
    }, 0);
    const rising = newCount >= 3;

    // Stable id via overlap heuristic
    const id = pickStableId(bdRecordIds, name, opts.previousThemes);

    themes.push({
      id,
      name,
      description,
      bdRecordIds,
      devRecordIds,
      dominantCategories: dedup(dominantCategories).slice(0, 2),
      dominantSubCategories: dedup(dominantSubCategories).slice(0, 2),
      bdVolume: bdRecordIds.length,
      bdMedianAgeDays,
      rising,
    });
  }

  return themes;
}

/**
 * Assign-only path. Sends Claude only the new rows + a compact catalog of
 * existing themes. Existing assignments are sticky (handled by the caller).
 * Returns additions to fold back in, plus any newly-minted themes.
 */
export async function assignNewRows(
  opts: IncrementalAssignOptions
): Promise<IncrementalAssignResult | null> {
  if (opts.newRows.length === 0) {
    return { additions: new Map(), newThemes: [], unplaced: [] };
  }

  // Build the theme catalog: id, name, description, dominantSubCategories,
  // and ≤3 example items pulled from each theme's existing members. When the
  // caller supplied a rowLookup, examples are concrete item-strings (lets
  // Claude reliably bucket prefix-tagged new rows like "[Kanzashi] X" into a
  // semantically-named theme like "Cancellation UX"). When rowLookup is
  // missing, examples are empty and Claude has only name+description+subcats.
  const examplesByThemeId = new Map<string, string[]>();
  for (const t of opts.existingThemes) {
    if (!opts.rowLookup) {
      examplesByThemeId.set(t.id, []);
      continue;
    }
    const examples: string[] = [];
    for (const recordId of t.bdRecordIds) {
      const row = opts.rowLookup.get(recordId);
      if (!row) continue;
      const text = (row.translate || row.item || "").trim();
      if (!text) continue;
      examples.push(text.slice(0, 120));
      if (examples.length >= 3) break;
    }
    examplesByThemeId.set(t.id, examples);
  }

  const catalog = opts.existingThemes.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description || "",
    dominantSubCategories: t.dominantSubCategories,
    examples: examplesByThemeId.get(t.id) ?? [],
  }));

  const systemPrompt = assignBdSystemPrompt({ existingThemes: catalog });

  const promptRows = opts.newRows.map((r) => ({
    record_id: r.recordId,
    item: (r.translate || r.item).slice(0, 240),
    category: r.category,
    subCategory: r.subCategory ? r.subCategory.trim() : "",
    priority: r.priority,
    ageDays: r.ageDays,
  }));

  const result = await runClaudeOneShot({
    systemPrompt,
    userMessage: JSON.stringify(promptRows),
    model: opts.model ?? "sonnet",
    abortSignal: opts.abortSignal,
    disableMcp: true,
  });

  if (!result.json || typeof result.json !== "object") {
    console.warn(
      "[themes/assign] unparseable Claude output. resultText[0..400]=%s",
      (result.resultText || "").slice(0, 400)
    );
    return null;
  }

  const out = result.json as AssignClaudeOutput;
  const validRecordIds = new Set(opts.newRows.map((r) => r.recordId));
  const validThemeIds = new Set(opts.existingThemes.map((t) => t.id));
  const placed = new Set<string>();

  const additions = new Map<string, string[]>();
  for (const a of out.assignments ?? []) {
    const recordId = typeof a.record_id === "string" ? a.record_id : null;
    const themeId = typeof a.theme_id === "string" ? a.theme_id : null;
    if (!recordId || !themeId) continue;
    if (!validRecordIds.has(recordId)) continue;
    if (!validThemeIds.has(themeId)) continue;
    if (placed.has(recordId)) continue;
    placed.add(recordId);
    const arr = additions.get(themeId) ?? [];
    arr.push(recordId);
    additions.set(themeId, arr);
  }

  const newThemes: IncrementalAssignResult["newThemes"] = [];
  for (const raw of out.newThemes ?? []) {
    const tempId = typeof raw.tempId === "string" ? raw.tempId : "";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const description =
      typeof raw.description === "string" ? raw.description.trim() : "";
    const ids = Array.isArray(raw.bdRecordIds)
      ? raw.bdRecordIds.filter(
          (s): s is string =>
            typeof s === "string" && validRecordIds.has(s) && !placed.has(s)
        )
      : [];
    if (!name || ids.length === 0) continue;
    for (const id of ids) placed.add(id);
    newThemes.push({ tempId, name, description, bdRecordIds: [...new Set(ids)] });
  }

  // Cap new-theme count post-hoc for safety (the prompt says cap at 2 but
  // we enforce here too).
  newThemes.splice(2);

  const unplaced = [...validRecordIds].filter((id) => !placed.has(id));
  return { additions, newThemes, unplaced };
}

function dedup(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()).filter((s) => s.length > 0))];
}

/**
 * Pick a stable theme id by checking overlap with the previous run. If any
 * previous theme shares ≥70% of its members with this one, reuse its id.
 * Otherwise mint a new one (slug of the name + short hash of the member set).
 */
function pickStableId(
  bdRecordIds: string[],
  name: string,
  previousThemes?: { id: string; bdRecordIds: string[] }[]
): string {
  if (previousThemes && previousThemes.length > 0) {
    const memberSet = new Set(bdRecordIds);
    let bestId: string | null = null;
    let bestOverlap = 0;
    for (const prev of previousThemes) {
      if (prev.bdRecordIds.length === 0) continue;
      const overlap = prev.bdRecordIds.reduce(
        (acc, id) => (memberSet.has(id) ? acc + 1 : acc),
        0
      );
      const ratio =
        overlap / Math.min(prev.bdRecordIds.length, bdRecordIds.length);
      if (ratio >= 0.7 && overlap > bestOverlap) {
        bestId = prev.id;
        bestOverlap = overlap;
      }
    }
    if (bestId) return bestId;
  }
  return slugify(name) + "-" + shortHash(bdRecordIds);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function shortHash(ids: string[]): string {
  // Tiny FNV-1a so we don't need a crypto import. The risk surface is
  // negligible; this is just for id stability.
  let h = 2166136261;
  const sorted = [...ids].sort().join(",");
  for (let i = 0; i < sorted.length; i++) {
    h ^= sorted.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36).slice(0, 6);
}

/**
 * Deterministic Category × Sub-category grouping. Used as a fallback when
 * Claude clustering is unavailable (timeout, parse failure, no `claude` CLI).
 *
 * Theme name = the dominant Sub-category (or Category if Sub-category is
 * empty). All metrics (volume, median age, rising) are computed identically
 * to the Claude path so downstream consumers don't need to branch.
 */
export function fallbackClusterBd(rows: BdInputRow[]): Theme[] {
  if (rows.length === 0) return [];
  const buckets = new Map<string, BdInputRow[]>();
  for (const r of rows) {
    const sub = (r.subCategory || "").trim();
    const cat = r.category[0] || "Uncategorized";
    const key = sub || cat;
    const arr = buckets.get(key) ?? [];
    arr.push(r);
    buckets.set(key, arr);
  }

  const now = Date.now();
  const themes: Theme[] = [];
  for (const [key, members] of buckets) {
    const bdRecordIds = members.map((r) => r.recordId);
    const devRecordIds = [
      ...new Set(members.flatMap((r) => r.linkedDevIds ?? [])),
    ];
    const ages = members
      .map((r) => r.ageDays)
      .filter((v): v is number => typeof v === "number")
      .sort((a, b) => a - b);
    const bdMedianAgeDays =
      ages.length === 0 ? null : ages[Math.floor(ages.length / 2)];
    const newCount = members.reduce((acc, r) => {
      if (typeof r.dateCreatedMs === "number" && now - r.dateCreatedMs < 14 * DAY_MS)
        return acc + 1;
      return acc;
    }, 0);
    const dominantCategories = topN(members.flatMap((r) => r.category), 2);
    const dominantSubCategories = topN(
      members.map((r) => (r.subCategory || "").trim()).filter((s) => s.length > 0),
      2
    );
    themes.push({
      id: "auto-" + slugify(key) + "-" + shortHash(bdRecordIds),
      name: key,
      description: `Auto-grouped by ${dominantSubCategories.length > 0 ? "sub-category" : "category"}.`,
      bdRecordIds,
      devRecordIds,
      dominantCategories,
      dominantSubCategories,
      bdVolume: bdRecordIds.length,
      bdMedianAgeDays,
      rising: newCount >= 3,
    });
  }
  // Sort biggest first for stable ordering in views.
  themes.sort((a, b) => b.bdVolume - a.bdVolume);
  return themes;
}

function topN(arr: string[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const s of arr) {
    const t = s.trim();
    if (!t) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([s]) => s);
}
