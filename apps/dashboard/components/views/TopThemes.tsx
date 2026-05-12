"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useDecideProposal,
  useRefreshThemes,
  useTaxonomyProposals,
  useThemes,
} from "@/lib/queries/data";
import { Sparkles, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { RisingBadge } from "./RisingBadge";
import type { Theme } from "@flightdeck/themes/shapes";

type SortMode = "bd" | "dev";
const SORT_MODE_STORAGE_KEY = "flightdeck.topthemes.sortMode";

/** Lazy-init the persisted sort mode from localStorage (SSR-safe). */
function readPersistedSortMode(): SortMode {
  if (typeof window === "undefined") return "bd";
  try {
    const v = window.localStorage.getItem(SORT_MODE_STORAGE_KEY);
    if (v === "bd" || v === "dev") return v;
  } catch {
    // ignore (private mode, etc.)
  }
  return "bd";
}

export type TopThemesProps = {
  /** When set, themes whose id matches this are highlighted as the active filter. */
  selectedThemeId?: string | null;
  onSelectTheme?: (theme: Theme | null) => void;
  /** How many themes to show in the strip. Default 6. */
  limit?: number;
  /** Optional helper line below the heading. */
  helper?: string;
  /** When provided, restrict each theme's count + median-age to BD record IDs
   * in this set (i.e. the rows the consuming view is actually showing).
   * Themes with zero members in scope are hidden. Without this prop, the
   * chips reflect the full BD population the cluster was built from. */
  scopeBdIds?: ReadonlySet<string>;
  /** When provided, only render themes whose id is in this set. Used by
   * Roadmap to hide themes that have no un-shipped Dev tickets — clicking
   * those chips would just empty all columns. */
  scopeThemeIds?: ReadonlySet<string>;
  /** When provided, override the chip count per theme. Used by Roadmap to
   * show "Dev tickets currently rendered" instead of "BD rows in cluster"
   * — clicking the chip then matches what the user expects. */
  themeCounts?: ReadonlyMap<string, number>;
  /** Label appended to the count tooltip for clarity, e.g. "Dev tickets" or
   * "BD rows". Default: "BD rows" (the cluster's native unit). */
  countLabel?: string;
  /** Render a BD-volume / Dev-queue sort toggle next to the heading.
   * Persists in localStorage. Only meaningful when `themeCounts` is also
   * provided (Roadmap), since "Dev queue" otherwise has no count to sort by. */
  showSortToggle?: boolean;
};

export function TopThemes({
  selectedThemeId = null,
  onSelectTheme,
  limit = 6,
  helper,
  scopeBdIds,
  scopeThemeIds,
  themeCounts,
  countLabel = "BD rows",
  showSortToggle = false,
}: TopThemesProps) {
  const { data, isLoading, error } = useThemes();
  const refresh = useRefreshThemes();

  const [sortMode, setSortMode] = React.useState<SortMode>(() =>
    readPersistedSortMode()
  );
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SORT_MODE_STORAGE_KEY, sortMode);
    } catch {
      // ignore (private mode, etc.)
    }
  }, [sortMode]);

  // Effective sort mode the chip strip should honour. The toggle UI is hidden
  // outside Roadmap (no themeCounts → "Dev queue" has nothing to sort by), so
  // force "bd" semantics there even if the persisted value says otherwise.
  const effectiveSortMode: SortMode =
    showSortToggle && themeCounts ? sortMode : "bd";

  if (isLoading && !data) {
    return (
      <ThemesShell helper={helper} onRefresh={() => refresh.mutate("incremental")} loading>
        <p className="px-4 py-3 text-xs text-neutral-500">
          Clustering BD feedback into themes…
        </p>
      </ThemesShell>
    );
  }

  if (error || !data?.ok) {
    const msg =
      error instanceof Error
        ? error.message
        : data && !data.ok
          ? data.error
          : "Couldn't load themes";
    return (
      <ThemesShell helper={helper} onRefresh={() => refresh.mutate("incremental")}>
        <p className="px-4 py-3 text-xs text-amber-700">
          Themes unavailable. {msg ?? ""}
        </p>
      </ThemesShell>
    );
  }

  const allThemes = data.blob.themes;
  // Proposals card reflects the current blob: BD-only on Triage (scopeBdIds
  // set), Dev-only on Roadmap (themeCounts set), both on neutral pages.
  const pageMode: "bd" | "dev" | "both" =
    scopeBdIds ? "bd" : themeCounts ? "dev" : "both";
  // Deterministic-fallback mode: legacy cache state from before
  // theme-clustering-v2 Phase 2. New blobs no longer use this mode —
  // writeThemesCache rejects fallback writes — but older buckets may still
  // carry it. Keep the badge + rising-suppression for that transition tail.
  // Read the explicit mode flag, not the theme-id prefix, because Claude runs
  // can carry forward fallback ids via the stable-id heuristic.
  const fallbackMode = data.blob.mode === "fallback";
  // Unavailable mode: clustering couldn't be computed (no claude CLI,
  // timeout, zero parseable themes). The blob carries an empty themes array;
  // we surface a clear retry CTA instead of silently looking like "no data".
  const unavailable = data.blob.mode === "unavailable";

  // Scope each theme to the consuming view's visible BD ids. Without this,
  // Triage shows themes with 11 members but clicking yields 0 rows because
  // every member is already linked to a Dev ticket (Triage's "unaddressed"
  // filter excludes them). With scoping the chip counts reflect what the user
  // will actually see.
  type ScopedTheme = Theme & {
    scopedCount: number;
    scopedMedianAgeDays: number | null;
  };
  const scopedThemes: ScopedTheme[] = allThemes.map((t) => {
    if (!scopeBdIds) {
      // Unscoped global view: include Claude-assigned Dev members so push
      // tickets (Dev rows with no BD link) contribute to the chip count.
      return {
        ...t,
        scopedCount: t.bdRecordIds.length + t.devRecordIds.length,
        scopedMedianAgeDays: t.bdMedianAgeDays,
      };
    }
    const inScope = t.bdRecordIds.filter((id) => scopeBdIds.has(id));
    return {
      ...t,
      scopedCount: inScope.length,
      // We don't have per-row ages in the theme blob, so fall back to the
      // global median when scoped. Good-enough; the chip is a cue, not a
      // metric source of truth.
      scopedMedianAgeDays: inScope.length > 0 ? t.bdMedianAgeDays : null,
    };
  });

  // The number to actually render on a chip. When the sort toggle is in
  // "dev" mode (Roadmap, planning a sprint), `themeCounts` (un-shipped Dev
  // tickets) is the count + sort key. In "bd" mode (default everywhere), the
  // BD-scoped count is used — even on Roadmap, so a high-volume BD theme
  // outranks a low-volume one with more queued Dev work.
  function displayCount(t: ScopedTheme): number {
    if (effectiveSortMode === "dev") {
      return themeCounts?.get(t.id) ?? 0;
    }
    return t.scopedCount;
  }

  // When the consuming view scopes themes, show all themes with in-scope
  // members — capping at 6 leaves the PM looking at "6 themes with 1 row
  // each" while ~17 other unaddressed rows are silently in chips off-screen.
  // Only apply the cap when scoping is OFF (the unscoped global view, where
  // 5–6 top themes is the right summary).
  const effectiveLimit =
    scopeBdIds || scopeThemeIds || themeCounts
      ? Number.POSITIVE_INFINITY
      : limit;
  const themes = scopedThemes
    .slice()
    .filter(
      (t) => !(fallbackMode && t.name.toLowerCase() === "uncategorized")
    )
    .filter((t) => displayCount(t) > 0)
    // Theme-id scope: hide themes the consuming view can't actually show.
    // Roadmap uses this to hide themes whose Dev tickets are all shipped.
    .filter((t) => !scopeThemeIds || scopeThemeIds.has(t.id))
    .sort((a, b) => displayCount(b) - displayCount(a))
    .slice(0, effectiveLimit);

  const totalInScope = themes.reduce((acc, t) => acc + displayCount(t), 0);

  if (themes.length === 0) {
    if (unavailable) {
      // Hard failure-mode empty state. Distinguish from "no themes match this
      // scope" so the user knows clustering needs to run, not just that
      // their filter is empty.
      return (
        <ThemesShell
          helper={helper}
          onRefresh={() => refresh.mutate("incremental")}
          unavailable
        >
          <ProposalsCard
            themes={allThemes}
            pageMode={pageMode}
            onSelectTheme={onSelectTheme}
          />
          <div className="flex flex-col items-start gap-2 border-l-2 border-amber-300 bg-amber-50/50 px-4 py-3">
            <p className="text-xs text-amber-900">
              Theme clustering is temporarily unavailable. Click{" "}
              <strong>Re-cluster</strong> to retry.
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => refresh.mutate("from-scratch")}
              disabled={refresh.isPending}
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5",
                  refresh.isPending && "animate-spin"
                )}
              />
              {refresh.isPending ? "Clustering…" : "Re-cluster"}
            </Button>
          </div>
        </ThemesShell>
      );
    }
    return (
      <ThemesShell helper={helper} onRefresh={() => refresh.mutate("incremental")}>
        <ProposalsCard />
        <p className="px-4 py-3 text-xs text-neutral-500">
          No themes detected yet. Recompute when more BD feedback rolls in.
        </p>
      </ThemesShell>
    );
  }

  function onScratch() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Cluster from scratch will reassign every BD row from scratch. Use only when themes feel stale or wrong. Continue?"
      )
    ) {
      return;
    }
    refresh.mutate("from-scratch");
  }

  const lastFullAt = data.blob.provenance?.lastFullAt;
  const incrementalSinceFull = data.blob.provenance?.incrementalSinceFull ?? 0;

  const sortToggleNode =
    showSortToggle && themeCounts ? (
      <SortToggle mode={sortMode} onChange={setSortMode} />
    ) : null;

  return (
    <ThemesShell
      helper={helper}
      onRefresh={() => refresh.mutate("incremental")}
      onScratch={onScratch}
      refreshing={refresh.isPending}
      stale={!data.fresh}
      fallback={fallbackMode}
      unavailable={unavailable}
      lastFullAt={lastFullAt}
      incrementalSinceFull={incrementalSinceFull}
      sortToggle={sortToggleNode}
    >
      <ProposalsCard />
      {(scopeBdIds || themeCounts) ? (
        <p className="border-b border-neutral-100 px-4 py-1.5 text-[11px] text-neutral-500">
          {totalInScope}{" "}
          {effectiveSortMode === "dev"
            ? countLabel.toLowerCase()
            : "BD rows"}{" "}
          across {themes.length} theme{themes.length === 1 ? "" : "s"}.
        </p>
      ) : null}
      <ul className="flex flex-wrap gap-2 px-4 py-3">
        {themes.map((t) => {
          const selected = selectedThemeId === t.id;
          const count = displayCount(t);
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelectTheme?.(selected ? null : t)}
                className={cn(
                  "group flex items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-colors",
                  selected
                    ? "border-blue-500 bg-blue-50 text-blue-900"
                    : "border-neutral-200 bg-white text-neutral-800 hover:border-neutral-300 hover:bg-neutral-50"
                )}
                title={t.description}
              >
                <span className="text-xs font-medium">{t.name}</span>
                <span
                  className="text-[11px] text-neutral-500"
                  title={
                    effectiveSortMode === "dev"
                      ? `${count} ${countLabel} (${t.bdRecordIds.length} BD · ${t.devRecordIds.length} Dev in cluster)`
                      : scopeBdIds
                        ? `${count} in this view (${t.bdRecordIds.length} BD · ${t.devRecordIds.length} Dev total in cluster)`
                        : `${t.bdRecordIds.length} BD rows · ${t.devRecordIds.length} Dev tickets in this theme`
                  }
                >
                  {count}
                </span>
                {t.rising && !fallbackMode ? (
                  <RisingBadge className="ml-1" />
                ) : null}
                {t.scopedMedianAgeDays !== null &&
                t.scopedMedianAgeDays > 14 ? (
                  <Badge
                    tone="warn"
                    className="ml-1"
                    title={`Median age across this theme's BD rows: ${t.scopedMedianAgeDays} days`}
                  >
                    {t.scopedMedianAgeDays}d med
                  </Badge>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </ThemesShell>
  );
}

function ThemesShell({
  children,
  helper,
  onRefresh,
  onScratch,
  refreshing = false,
  loading = false,
  stale = false,
  fallback = false,
  unavailable = false,
  lastFullAt,
  incrementalSinceFull = 0,
  sortToggle,
}: {
  children: React.ReactNode;
  helper?: string;
  onRefresh?: () => void;
  onScratch?: () => void;
  refreshing?: boolean;
  loading?: boolean;
  stale?: boolean;
  fallback?: boolean;
  unavailable?: boolean;
  lastFullAt?: string;
  incrementalSinceFull?: number;
  sortToggle?: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-card">
      <header className="flex items-center justify-between border-b border-neutral-100 px-4 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-blue-500" />
          <h2 className="text-sm font-semibold text-neutral-900">
            Top themes
          </h2>
          {unavailable ? (
            <Badge tone="warn" className="ml-1">
              unavailable
            </Badge>
          ) : null}
          {fallback ? (
            <Badge tone="neutral" className="ml-1">
              auto-grouped
            </Badge>
          ) : null}
          {stale && !fallback && !unavailable ? (
            <Badge tone="neutral" className="ml-1">
              from previous run
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {sortToggle}
          {helper ? (
            <span className="text-xs text-neutral-500">{helper}</span>
          ) : null}
          {onRefresh ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={onRefresh}
              disabled={refreshing || loading}
              title="Add new BD rows to existing themes (existing assignments stay sticky)"
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5",
                  refreshing && "animate-spin"
                )}
              />
              {refreshing ? "Clustering…" : "Re-cluster"}
            </Button>
          ) : null}
        </div>
      </header>
      {onScratch && !fallback ? (
        <div className="flex items-center justify-end gap-3 border-b border-neutral-100 px-4 py-1 text-[10px] text-neutral-500">
          {lastFullAt ? (
            <span title={`Last full recompute: ${lastFullAt}`}>
              From scratch · {daysAgo(lastFullAt)}d ago
              {incrementalSinceFull > 0
                ? ` · +${incrementalSinceFull} incremental`
                : ""}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onScratch}
            disabled={refreshing || loading}
            className="text-blue-600 underline-offset-2 hover:underline disabled:opacity-50"
          >
            Cluster from scratch
          </button>
        </div>
      ) : null}
      {fallback ? (
        <p className="border-b border-neutral-100 bg-amber-50/40 px-4 py-2 text-[11px] text-amber-800">
          Themes are auto-grouped by sub-category — Re-cluster for cross-cutting view (rising signal disabled).
        </p>
      ) : null}
      {children}
    </section>
  );
}

function daysAgo(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000)));
}

/** Two-button sort-mode pill for the Roadmap chip strip. BD volume keeps
 * Roadmap aligned with Triage / Linkage; Dev queue prioritises sprint
 * planning. Persisted by the parent via localStorage. */
function SortToggle({
  mode,
  onChange,
}: {
  mode: SortMode;
  onChange: (m: SortMode) => void;
}) {
  return (
    <div
      className="flex h-5 overflow-hidden rounded-md border border-neutral-200 text-[11px]"
      title="Roadmap chips rank by BD volume to match Triage/Linkage. Switch to 'Dev queue' when planning a sprint."
    >
      <button
        type="button"
        onClick={() => onChange("bd")}
        className={cn(
          "px-2 leading-none transition-colors",
          mode === "bd"
            ? "bg-neutral-800 text-white"
            : "bg-white text-neutral-600 hover:bg-neutral-50"
        )}
      >
        BD volume
      </button>
      <button
        type="button"
        onClick={() => onChange("dev")}
        className={cn(
          "border-l border-neutral-200 px-2 leading-none transition-colors",
          mode === "dev"
            ? "bg-neutral-800 text-white"
            : "bg-white text-neutral-600 hover:bg-neutral-50"
        )}
      >
        Dev queue
      </button>
    </div>
  );
}

/**
 * Theme proposals — brand-new names Claude minted that aren't in
 * CANDIDATE_THEMES yet. Renders inline above the chip strip when ≥1 pending
 * proposal exists. Accept = record-only (the user still has to add the name
 * to lib/themes/taxonomy.ts manually); Reject = remember the decline so we
 * stop nagging about the same name on every cluster run.
 *
 * Counts come from the current cluster blob (not the stored member_count,
 * which is BD-only and stale-by-design). Stale proposals — names Claude
 * minted in a previous run but no longer mints — are filtered out silently;
 * the DB row stays and will resurface if the same name re-appears.
 */
function ProposalsCard({
  themes,
  pageMode,
  onSelectTheme,
}: {
  themes?: Theme[];
  pageMode?: "bd" | "dev" | "both";
  onSelectTheme?: (theme: Theme | null) => void;
}) {
  const { data } = useTaxonomyProposals();
  const decide = useDecideProposal();
  const proposals = data?.proposals ?? [];
  if (proposals.length === 0) return null;

  // Match by lowercased+trimmed name; the slug isn't on the proposal row.
  const byName = new Map<string, Theme>();
  for (const t of themes ?? []) {
    byName.set(t.name.trim().toLowerCase(), t);
  }
  const live = proposals
    .map((p) => ({ p, theme: byName.get(p.name.trim().toLowerCase()) }))
    .filter((row) => row.theme !== undefined) as {
    p: (typeof proposals)[number];
    theme: Theme;
  }[];
  if (live.length === 0) return null;

  function renderCount(t: Theme): { label: string; tooltip: string } {
    const bd = t.bdRecordIds.length;
    const dev = t.devRecordIds.length;
    if (pageMode === "bd") {
      return { label: `${bd}`, tooltip: `${bd} BD rows in this theme` };
    }
    if (pageMode === "dev") {
      return { label: `${dev}`, tooltip: `${dev} Dev tickets in this theme` };
    }
    return {
      label: `${bd} BD · ${dev} Dev`,
      tooltip: `${bd} BD rows · ${dev} Dev tickets in this theme`,
    };
  }

  return (
    <div className="border-b border-neutral-100 bg-blue-50/40 px-4 py-2 text-xs">
      <div className="mb-1 font-semibold text-blue-900">
        Proposed new themes ({live.length})
      </div>
      <ul className="space-y-1">
        {live.map(({ p, theme }) => {
          const { label, tooltip } = renderCount(theme);
          return (
            <li
              key={p.name}
              className="flex items-center justify-between gap-2"
            >
              <span className="truncate text-neutral-800" title={tooltip}>
                <button
                  type="button"
                  onClick={() => onSelectTheme?.(theme)}
                  className={cn(
                    "text-left",
                    onSelectTheme
                      ? "cursor-pointer text-blue-700 hover:underline"
                      : "cursor-default"
                  )}
                >
                  {p.name}
                </button>
                <span className="ml-2 text-neutral-500">{label}</span>
              </span>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    decide.mutate({ name: p.name, action: "accept" })
                  }
                  disabled={decide.isPending}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    decide.mutate({ name: p.name, action: "reject" })
                  }
                  disabled={decide.isPending}
                >
                  Reject
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-[10px] text-neutral-500">
        Accept records the decision; add the name to lib/themes/taxonomy.ts to
        make it available to future cluster runs.
      </p>
    </div>
  );
}
