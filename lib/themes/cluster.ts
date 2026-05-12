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
import {
  CANDIDATE_THEME_NAMES_LC,
  MAX_NEW_THEMES_PER_RUN,
  isCandidateName,
} from "./taxonomy";

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
 * Parse a raw Claude clustering response into Theme[]. Shared between the
 * first-pass and the strict-retry pass so the validation logic is identical.
 * Returns null on hard parse failure (no themes array, unparseable JSON);
 * returns Theme[] (possibly empty) for any other shape — caller decides
 * whether the resulting count violates constraints.
 */
function parseClaudeThemes(
  out: ClaudeOutput,
  byId: Map<string, BdInputRow>,
  previousThemes: ClusterOptions["previousThemes"]
): Theme[] | null {
  if (!Array.isArray(out.themes)) {
    console.warn(
      "[themes/cluster] Claude JSON missing 'themes' array. keys=%s",
      Object.keys(out).join(",")
    );
    return null;
  }

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

    // Stable id: candidate names use slugify(name) directly; ad-hoc names
    // fall back to the overlap heuristic + hash.
    const id = pickStableId(bdRecordIds, name, previousThemes);

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

function countNewNames(themes: Theme[]): { count: number; names: string[] } {
  const offending = themes
    .map((t) => t.name)
    .filter((n) => !CANDIDATE_THEME_NAMES_LC.has(n.trim().toLowerCase()));
  return { count: offending.length, names: offending };
}

/**
 * Run the clustering call. Returns the fully-derived Theme[] or null if the
 * Claude output couldn't be parsed (or the brand-new-name cap was violated
 * twice).
 */
export async function clusterBd(opts: ClusterOptions): Promise<Theme[] | null> {
  if (opts.rows.length === 0) return [];

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
  const userMessage = JSON.stringify(promptRows);

  const byId = new Map<string, BdInputRow>();
  for (const r of opts.rows) byId.set(r.recordId, r);

  async function runOnce(strictRetry: boolean): Promise<Theme[] | null> {
    const systemPrompt = clusterBdSystemPrompt({ strictRetry });
    const result = await runClaudeOneShot({
      systemPrompt,
      userMessage,
      model: opts.model ?? "opus",
      abortSignal: opts.abortSignal,
      disableMcp: true,
    });
    if (!result.json || typeof result.json !== "object") {
      console.warn(
        "[themes/cluster] Claude returned unparseable output. resultText[0..400]=%s stderr[0..400]=%s",
        (result.resultText || "").slice(0, 400),
        (result.stderr || "").slice(0, 400)
      );
      return null;
    }
    return parseClaudeThemes(
      result.json as ClaudeOutput,
      byId,
      opts.previousThemes
    );
  }

  // First pass.
  let themes = await runOnce(false);
  if (themes === null) return null;

  let { count: newNameCount, names: offendingNames } = countNewNames(themes);
  if (newNameCount > MAX_NEW_THEMES_PER_RUN) {
    console.warn(
      "[themes/cluster] first pass emitted %d brand-new names (cap %d): %s — retrying with strictRetry.",
      newNameCount,
      MAX_NEW_THEMES_PER_RUN,
      offendingNames.slice(0, 5).join(", ")
    );
    const retry = await runOnce(true);
    if (retry === null) {
      console.warn(
        "[themes/cluster] strict retry returned no parseable output — failing closed."
      );
      return null;
    }
    const post = countNewNames(retry);
    if (post.count > MAX_NEW_THEMES_PER_RUN) {
      console.warn(
        "[themes/cluster] strict retry STILL emitted %d brand-new names (cap %d): %s — failing closed.",
        post.count,
        MAX_NEW_THEMES_PER_RUN,
        post.names.slice(0, 5).join(", ")
      );
      return null;
    }
    console.log(
      "[themes/cluster] strict retry succeeded — %d new names within cap %d.",
      post.count,
      MAX_NEW_THEMES_PER_RUN
    );
    themes = retry;
  }

  return themes;
}

/**
 * Extract brand-new (non-candidate) theme names from a parsed Theme[]. Used by
 * themes-server to record taxonomy_proposals after each successful run.
 */
export function extractNewThemeNames(themes: Theme[]): string[] {
  return themes
    .map((t) => t.name)
    .filter((n) => !CANDIDATE_THEME_NAMES_LC.has(n.trim().toLowerCase()));
}

/**
 * Parse a raw assign-call response into the additions/newThemes/unplaced
 * shape. Shared between first-pass and strict-retry pass.
 */
function parseAssignOutput(
  out: AssignClaudeOutput,
  validRecordIds: Set<string>,
  validThemeIds: Set<string>
): IncrementalAssignResult {
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

  const unplaced = [...validRecordIds].filter((id) => !placed.has(id));
  return { additions, newThemes, unplaced };
}

/**
 * Assign-only path. Sends Claude only the new rows + a compact catalog of
 * existing themes. Existing assignments are sticky (handled by the caller).
 * Returns additions to fold back in, plus any newly-minted themes.
 *
 * Phase 3: enforces MAX_NEW_THEMES_PER_RUN. If the first call returns
 * `>MAX_NEW_THEMES_PER_RUN` newThemes, retries once with stricter prompt; on
 * retry failure returns null (themes-server falls back to from-scratch).
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

  const promptRows = opts.newRows.map((r) => ({
    record_id: r.recordId,
    item: (r.translate || r.item).slice(0, 240),
    category: r.category,
    subCategory: r.subCategory ? r.subCategory.trim() : "",
    priority: r.priority,
    ageDays: r.ageDays,
  }));
  const userMessage = JSON.stringify(promptRows);
  const validRecordIds = new Set(opts.newRows.map((r) => r.recordId));
  const validThemeIds = new Set(opts.existingThemes.map((t) => t.id));

  async function runOnce(
    strictRetry: boolean
  ): Promise<IncrementalAssignResult | null> {
    const systemPrompt = assignBdSystemPrompt({
      existingThemes: catalog,
      strictRetry,
    });
    const result = await runClaudeOneShot({
      systemPrompt,
      userMessage,
      model: opts.model ?? "opus",
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
    return parseAssignOutput(
      result.json as AssignClaudeOutput,
      validRecordIds,
      validThemeIds
    );
  }

  let parsed = await runOnce(false);
  if (!parsed) return null;

  if (parsed.newThemes.length > MAX_NEW_THEMES_PER_RUN) {
    console.warn(
      "[themes/assign] first pass minted %d new themes (cap %d): %s — retrying with strictRetry.",
      parsed.newThemes.length,
      MAX_NEW_THEMES_PER_RUN,
      parsed.newThemes
        .map((t) => t.name)
        .slice(0, 5)
        .join(", ")
    );
    const retry = await runOnce(true);
    if (!retry) {
      console.warn(
        "[themes/assign] strict retry returned no parseable output — failing closed."
      );
      return null;
    }
    if (retry.newThemes.length > MAX_NEW_THEMES_PER_RUN) {
      console.warn(
        "[themes/assign] strict retry STILL minted %d new themes (cap %d) — failing closed.",
        retry.newThemes.length,
        MAX_NEW_THEMES_PER_RUN
      );
      return null;
    }
    parsed = retry;
  }

  return parsed;
}

function dedup(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()).filter((s) => s.length > 0))];
}

/**
 * Pick a stable theme id.
 *
 * - Candidate (anchored) names: id is `slugify(name)` with no hash suffix.
 *   Same name → same id across runs by construction; manual overrides survive
 *   member-set changes (Phase 3 of theme-clustering-v2).
 * - Ad-hoc names: keep the 70%-overlap heuristic — if any previous theme
 *   shares ≥70% members, reuse its id. Otherwise mint slug + short hash.
 */
function pickStableId(
  bdRecordIds: string[],
  name: string,
  previousThemes?: { id: string; bdRecordIds: string[] }[]
): string {
  if (isCandidateName(name)) {
    return slugify(name);
  }
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
 * @deprecated Disabled by Phase 2 of theme-clustering-v2 (2026-05-08).
 * Sub-category-shaped buckets caused a user-visible regression where the UI
 * rendered raw Sub-category strings as "themes" identically to real Claude
 * clusters. We now return [] and let callers surface an empty state instead.
 * Kept as a no-op so callers don't need to remove call sites in lockstep.
 */
export function fallbackClusterBd(rows: BdInputRow[]): Theme[] {
  void rows;
  return [];
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
