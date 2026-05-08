"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTriage, useThemes } from "@/lib/queries/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgingBadges, rowTintClass } from "./AgingBadge";
import { HeadlineNumber } from "./HeadlineNumber";
import { TopThemes } from "./TopThemes";
import { AlertTriangle, Wand2, X } from "lucide-react";
import type { BdRow, DevRow } from "@/lib/data-shapes";
import type { Theme } from "@flightdeck/themes/shapes";
import { cn } from "@/lib/utils";
import { formatLarkDate } from "@/lib/format";

const PRIORITY_TONE: Record<string, "danger" | "warn" | "accent" | "neutral"> = {
  Immediate: "danger",
  High: "danger",
  Medium: "warn",
  Low: "neutral",
  Next: "accent",
};

export function TriageView() {
  const { data, isLoading, error } = useTriage();
  const themes = useThemes();
  const [selectedTheme, setSelectedTheme] = React.useState<Theme | null>(null);

  // Build a record-id → theme name map so we can show theme tags inside each
  // row. Computed before the loading/error early returns so hook order stays
  // stable across renders (React's Rules of Hooks).
  const themeByBdId = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    if (themes.data?.ok) {
      for (const t of themes.data.blob.themes) {
        for (const id of t.bdRecordIds) {
          map.set(id, { id: t.id, name: t.name });
        }
      }
    }
    return map;
  }, [themes.data]);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }
  if (!data) return null;

  const allRows = data.groups.flatMap((g) => g.rows);
  // Set of BD record IDs in the Triage scope. Theme chips above are scoped to
  // this — without it, chips can show 11 BDs but clicking yields 0 rows
  // because every member is already linked to a Dev ticket and Triage's
  // "unaddressed" filter excluded them.
  const triageBdIds = new Set(allRows.map((r) => r.recordId));
  const filterIds = selectedTheme
    ? new Set(
        selectedTheme.bdRecordIds.filter((id) => triageBdIds.has(id))
      )
    : null;
  const groupsFiltered = filterIds
    ? data.groups
        .map((g) => ({
          priority: g.priority,
          rows: g.rows.filter((r) => filterIds.has(r.recordId)),
        }))
        .filter((g) => g.rows.length > 0)
    : data.groups;

  const visibleRows = filterIds
    ? allRows.filter((r) => filterIds.has(r.recordId))
    : allRows;

  const pocCount = visibleRows.filter((r) => r.fromPocMerchant).length;
  const stale30 = visibleRows.filter((r) => (r.ageDays ?? 0) > 30).length;
  const stale14 = visibleRows.filter(
    (r) => (r.ageDays ?? 0) > 14 && (r.ageDays ?? 0) <= 30
  ).length;

  if (data.totalCount === 0) {
    return (
      <div className="flex flex-col gap-4">
        <HeadlineNumber
          value="0"
          label="Inbox zero on BD feedback"
          helper="Nothing waiting for triage. Good moment to scope something deeper or draft the weekly update."
          tone="success"
        />
      </div>
    );
  }

  const headline =
    stale30 > 0
      ? {
          value: stale30,
          label: "BD feedback rows over 30 days unaddressed",
          helper: `${pocCount} from a POC merchant. ${stale14} more in the 14–30 day band.`,
          tone: "warn" as const,
        }
      : stale14 > 0
        ? {
            value: stale14,
            label: "BD feedback rows aging in the 14–30 day window",
            helper: `${pocCount} from a POC merchant. Triage them before they cross 30d.`,
            tone: "warn" as const,
          }
        : {
            value: visibleRows.length,
            label: selectedTheme
              ? `Rows in theme: ${selectedTheme.name}`
              : "Unaddressed BD feedback rows",
            helper: `${pocCount} from a POC merchant.`,
            tone: "neutral" as const,
          };

  return (
    <div className="flex flex-col gap-6">
      <HeadlineNumber {...headline} />

      {data.criticalFix && data.criticalFix.length > 0 ? (
        <CriticalFixStrip tickets={data.criticalFix} />
      ) : null}

      <TopThemes
        selectedThemeId={selectedTheme?.id ?? null}
        onSelectTheme={(t) => setSelectedTheme(t)}
        helper="Click a theme to filter the bands below"
        scopeBdIds={triageBdIds}
      />

      {selectedTheme ? (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          <span>
            Filtering to <strong>{selectedTheme.name}</strong> —{" "}
            {selectedTheme.description}
          </span>
          <button
            type="button"
            onClick={() => setSelectedTheme(null)}
            className="ml-auto inline-flex items-center gap-1 rounded text-blue-900 hover:underline"
          >
            <X className="h-3 w-3" />
            Clear filter
          </button>
        </div>
      ) : null}

      {groupsFiltered.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-500">
          No rows in this theme are currently in triage.
        </div>
      ) : (
        groupsFiltered.map((g) => (
          <PriorityBand
            key={g.priority}
            priority={g.priority}
            rows={g.rows}
            themeByBdId={themeByBdId}
          />
        ))
      )}
    </div>
  );
}

type SubGroup = { label: string; rows: BdRow[] };

function chunkBySubCategory(rows: BdRow[]): SubGroup[] {
  const map = new Map<string, BdRow[]>();
  for (const row of rows) {
    const label = (row.subCategory || "").trim() || "—";
    const arr = map.get(label) ?? [];
    arr.push(row);
    map.set(label, arr);
  }
  // Sort sub-groups: named groups by row count desc, "—" last.
  const entries = [...map.entries()];
  entries.sort((a, b) => {
    if (a[0] === "—") return 1;
    if (b[0] === "—") return -1;
    return b[1].length - a[1].length || a[0].localeCompare(b[0]);
  });
  for (const [, arr] of entries) {
    arr.sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));
  }
  return entries.map(([label, rows]) => ({ label, rows }));
}

function PriorityBand({
  priority,
  rows,
  themeByBdId,
}: {
  priority: string;
  rows: BdRow[];
  themeByBdId: Map<string, { id: string; name: string }>;
}) {
  const subGroups = chunkBySubCategory(rows);
  return (
    <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-card">
      <header className="flex items-center justify-between border-b border-neutral-100 px-4 py-2">
        <div className="flex items-center gap-2">
          <Badge tone={PRIORITY_TONE[priority] ?? "neutral"}>
            {priority || "—"}
          </Badge>
          <span className="text-xs text-neutral-500">
            {rows.length} row{rows.length === 1 ? "" : "s"}
            {subGroups.length > 1 ? ` · ${subGroups.length} sub-categories` : ""}
          </span>
        </div>
      </header>
      <div className="divide-y divide-neutral-100">
        {subGroups.map((sg) => (
          <div key={sg.label}>
            {subGroups.length > 1 ? (
              <div className="flex items-baseline gap-2 bg-neutral-50/60 px-4 py-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  {sg.label}
                </span>
                <span className="text-[11px] text-neutral-400">
                  {sg.rows.length}
                </span>
              </div>
            ) : null}
            <ul className="divide-y divide-neutral-100">
              {sg.rows.map((row) => (
                <Row
                  key={row.recordId}
                  row={row}
                  themeTag={themeByBdId.get(row.recordId)}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Row({
  row,
  themeTag,
}: {
  row: BdRow;
  themeTag?: { id: string; name: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function openPanel(autoStartFlow = false) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("panel", row.recordId);
    next.set("kind", "bd");
    if (autoStartFlow) next.set("flow", "bd-to-dev");
    else next.delete("flow");
    router.push(`${pathname}?${next.toString()}`);
  }

  const tint = rowTintClass(row.aging);
  return (
    <li
      className={cn(
        "grid grid-cols-[6ch_1fr_auto_auto] items-start gap-4 px-4 py-3 cursor-pointer transition-colors",
        tint
      )}
      onClick={() => openPanel(false)}
    >
      <div className="font-mono text-xs text-neutral-500 pt-0.5">
        #{row.number}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm text-neutral-900">
          {row.translate || row.item || "(no item text)"}
        </div>
        {row.translate && row.item && row.translate !== row.item ? (
          <div className="mt-0.5 truncate text-xs text-neutral-500">
            {row.item}
          </div>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
          {themeTag ? (
            <Badge tone="accent">{themeTag.name}</Badge>
          ) : null}
          {row.category.map((c) => (
            <Badge key={c} tone="neutral">
              {c}
            </Badge>
          ))}
          {row.fromPocMerchant ? <Badge tone="accent">POC merchant</Badge> : null}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-xs text-neutral-500">
          {row.ageDays !== null ? `${row.ageDays}d` : "—"}
        </span>
        <AgingBadges signals={row.aging} />
      </div>
      <div className="flex shrink-0 items-start" onClick={(e) => e.stopPropagation()}>
        <Button
          size="sm"
          onClick={() => openPanel(true)}
          title="Open scoping flow for this row"
        >
          <Wand2 className="h-3.5 w-3.5" />
          Scope
        </Button>
      </div>
    </li>
  );
}

/**
 * Pinned strip at the top of Triage showing in-flight Dev tickets at
 * priority="0 Critical Fix". These are the most-urgent items the team is
 * actively shipping; the PM should be aware of them while triaging the BD
 * inbox below. Clicking opens the Dev panel.
 */
function CriticalFixStrip({ tickets }: { tickets: DevRow[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function openTicket(ticket: DevRow) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("panel", ticket.recordId);
    next.set("kind", "dev");
    next.delete("flow");
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <section className="overflow-hidden rounded-lg border border-red-200 bg-red-50/30 shadow-card">
      <header className="flex items-center justify-between border-b border-red-200/60 px-4 py-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
          <h2 className="text-sm font-semibold text-red-900">Critical fixes in flight</h2>
          <Badge tone="danger">{tickets.length}</Badge>
        </div>
        <span className="text-[11px] text-red-800/70">
          Active Dev tickets at Priority 0. Click to open.
        </span>
      </header>
      <ul className="divide-y divide-red-100">
        {tickets.map((t) => (
          <li
            key={t.recordId}
            onClick={() => openTicket(t)}
            className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-3 px-4 py-2 text-sm hover:bg-red-100/40"
          >
            <span className="min-w-0 truncate text-neutral-900">
              {t.description || "(no description)"}
            </span>
            <Badge tone={t.status === "In Progress" ? "accent" : "warn"}>
              {t.status || "—"}
            </Badge>
            <span
              className="text-xs text-neutral-500"
              title={t.assignees.map((a) => a.name ?? a.id).join(", ")}
            >
              {t.assignees[0]?.name ?? "unassigned"}
            </span>
            <span className="text-xs text-neutral-500">
              ETA {formatLarkDate(t.eta)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
