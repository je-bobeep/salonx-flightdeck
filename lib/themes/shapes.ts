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
  /** Member Dev record IDs (joined from BD members' linkedDevIds). */
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
   * "fallback" = deterministic Category × Sub-category grouping (used when
   * the Claude call timed out or the runtime can't reach the CLI).
   * Persisted because the UI suppresses rising-dependent CTAs and shows a
   * banner in fallback mode — and ID-prefix detection is unreliable since
   * pickStableId can carry old "auto-" ids forward into a Claude run. */
  mode: "claude" | "fallback";
  themes: Theme[];
  /** Tracks how often we've appended-only (incremental) since the last full
   * recompute. Lets the UI nudge "cluster from scratch" when the cluster has
   * been stitched together for a long time. */
  provenance?: {
    lastFullAt: string;
    lastIncrementalAt: string | null;
    incrementalSinceFull: number;
  };
};
