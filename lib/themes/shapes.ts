// Shared theme shape consumed by Triage, Linkage, and Roadmap.

export type Theme = {
  /** Stable across runs (preserved if ≥70% member overlap with a previous run). */
  id: string;
  /** Short label, ≤ 4 words. */
  name: string;
  /** One-line summary. */
  description: string;
  /** Member BD record IDs. */
  bdRecordIds: string[];
  /** Member Dev record IDs. Directly assigned by Claude during clustering —
   * a Dev row is in this theme because the model grouped it here based on
   * its own content (story description, module). Includes both pull tickets
   * (BD-linked) and push tickets (no BD link). */
  devRecordIds: string[];
  dominantCategories: string[];
  dominantSubCategories: string[];
  bdVolume: number;
  bdMedianAgeDays: number | null;
  /** ≥3 new BD members in last 14 days. */
  rising: boolean;
};

export type ThemesBlob = {
  /** ISO date the cluster was computed. */
  computedAt: string;
  /** "claude" = real cross-cutting cluster from runClaudeOneShot.
   * "fallback" = legacy deterministic Category × Sub-category grouping.
   * Retained in the union for compatibility with cached blobs written before
   * Phase 2 of theme-clustering-v2 (2026-05-08); writeThemesCache no longer
   * persists this mode.
   * "unavailable" = Clustering couldn't be computed (no `claude` CLI,
   * timeout, or zero parseable themes). The blob carries an empty themes
   * array; consumers render an empty state, not fallback Sub-category
   * buckets. */
  mode: "claude" | "fallback" | "unavailable";
  themes: Theme[];
  /** Tracks how often we've appended-only (incremental) since the last full
   * recompute. Lets the UI nudge "cluster from scratch" when the cluster has
   * been stitched together for a long time. */
  provenance?: {
    lastFullAt: string;
    lastIncrementalAt: string | null;
    incrementalSinceFull: number;
    /** Number of new themes minted in the most recent incremental run. Used
     * as a drift signal — if >0, computeFreshThemes promotes the next request
     * to from-scratch. Phase 4 of theme-clustering-v2. */
    lastIncrementalNewThemeCount?: number;
  };
};
