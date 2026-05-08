"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRefreshThemes, useThemes } from "@/lib/queries/data";
import { Sparkles, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { RisingBadge } from "./RisingBadge";
import type { Theme } from "@flightdeck/themes/shapes";

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
}: TopThemesProps) {
  const { data, isLoading, error } = useThemes();
  const refresh = useRefreshThemes();

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
  // Deterministic-fallback mode: clusterBd timed out (or hadn't run yet) and
  // we grouped by raw Category × Sub-category. In that mode the "rising"
  // axis is structurally always false and "Uncategorized" is residue, not a
  // coverage gap — surface this so the PM doesn't act on misleading clusters.
  // Read the explicit mode flag, not the theme-id prefix, because Claude runs
  // can carry forward fallback ids via the stable-id heuristic.
  const fallbackMode = data.blob.mode === "fallback";

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
      return {
        ...t,
        scopedCount: t.bdVolume,
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

  // The number to actually render on a chip. `themeCounts` (from the view)
  // wins when present — Roadmap uses it to show un-shipped Dev-ticket counts
  // instead of BD-row counts. Otherwise fall back to the BD-scoped count.
  function displayCount(t: ScopedTheme): number {
    const override = themeCounts?.get(t.id);
    return typeof override === "number" ? override : t.scopedCount;
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
    return (
      <ThemesShell helper={helper} onRefresh={() => refresh.mutate("incremental")}>
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

  return (
    <ThemesShell
      helper={helper}
      onRefresh={() => refresh.mutate("incremental")}
      onScratch={onScratch}
      refreshing={refresh.isPending}
      stale={!data.fresh}
      fallback={fallbackMode}
      lastFullAt={lastFullAt}
      incrementalSinceFull={incrementalSinceFull}
    >
      {(scopeBdIds || themeCounts) ? (
        <p className="border-b border-neutral-100 px-4 py-1.5 text-[11px] text-neutral-500">
          {totalInScope} {countLabel.toLowerCase()} across {themes.length}{" "}
          theme{themes.length === 1 ? "" : "s"}.
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
                    themeCounts
                      ? `${count} ${countLabel} (${t.bdVolume} BD rows in cluster)`
                      : scopeBdIds
                        ? `${count} in this view (${t.bdVolume} total in cluster)`
                        : `${t.bdVolume} BD rows in this theme`
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
  lastFullAt,
  incrementalSinceFull = 0,
}: {
  children: React.ReactNode;
  helper?: string;
  onRefresh?: () => void;
  onScratch?: () => void;
  refreshing?: boolean;
  loading?: boolean;
  stale?: boolean;
  fallback?: boolean;
  lastFullAt?: string;
  incrementalSinceFull?: number;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-card">
      <header className="flex items-center justify-between border-b border-neutral-100 px-4 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-blue-500" />
          <h2 className="text-sm font-semibold text-neutral-900">
            Top themes
          </h2>
          {fallback ? (
            <Badge tone="neutral" className="ml-1">
              auto-grouped
            </Badge>
          ) : null}
          {stale && !fallback ? (
            <Badge tone="neutral" className="ml-1">
              from previous run
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
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
