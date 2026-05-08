"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRoadmap } from "@/lib/queries/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TopThemes } from "./TopThemes";
import { Info, TrendingUp, Wand2 } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { RisingBadge } from "./RisingBadge";
import { formatLarkDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  RoadmapBand,
  RoadmapCell,
  RoadmapColumn,
  RoadmapTicket,
} from "@/lib/data-shapes";
import type { Theme } from "@flightdeck/themes/shapes";

const BAND_TONE: Record<RoadmapBand, string> = {
  now: "border-blue-200 bg-blue-50/40",
  next: "border-amber-200 bg-amber-50/40",
  soon: "border-neutral-200 bg-neutral-50/40",
  later: "border-neutral-200 bg-white",
};

/** Inline info-icon tooltip explaining how each Dev ticket lands in a band.
 * Mirrors `bandFor` in apps/dashboard/app/api/data/roadmap/route.ts:37-80 —
 * keep these in sync if the rules change. First-match-wins ordering matters. */
function BandRulesTooltip() {
  return (
    <Tooltip
      side="bottom"
      align="start"
      content={
        <div className="flex flex-col gap-2.5">
          <p className="text-sm font-semibold text-neutral-100">
            How tickets land in each column
          </p>
          <p className="text-xs text-neutral-300">
            First match wins. Shipped tickets (Status closed, or Release Date
            in the past) are excluded entirely.
          </p>
          <ol className="ml-4 list-decimal space-y-1.5 text-sm text-neutral-200">
            <li>
              <span className="text-neutral-100">Sprint match:</span> sprint =
              current → <b>Now</b>; sprint = next → <b>Next</b>.
            </li>
            <li>
              <span className="text-neutral-100">Late-stage status:</span>{" "}
              <code className="rounded bg-neutral-800 px-1 py-0.5 text-[13px]">
                Ready for Release
              </code>{" "}
              or{" "}
              <code className="rounded bg-neutral-800 px-1 py-0.5 text-[13px]">
                In Testing
              </code>{" "}
              → <b>Now</b>, regardless of ETA.
            </li>
            <li>
              <span className="text-neutral-100">External ETA:</span> past +
              still in flight → <b>Now</b> (overdue); past + inactive →{" "}
              <b>Later</b>; 0–14d → <b>Now</b>; 15–30d → <b>Next</b>; 31–90d →{" "}
              <b>Soon</b>; &gt;90d → <b>Later</b>.
            </li>
            <li>
              <span className="text-neutral-100">No sprint, no ETA:</span>{" "}
              in-flight status → <b>Soon</b>; otherwise → <b>Later</b>.
            </li>
          </ol>
          <p className="text-xs text-neutral-400">
            <span className="text-neutral-300">Note:</span> Internal ETA is
            <i> not</i> used for banding — only External ETA. Internal target
            drives the red/amber dot on each ticket and the week-strip above.
          </p>
        </div>
      }
    >
      <button
        type="button"
        aria-label="Banding rules"
        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:text-neutral-700"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
    </Tooltip>
  );
}

export function RoadmapView() {
  const { data, isLoading, error } = useRoadmap();
  const [filterThemeId, setFilterThemeId] = React.useState<string | null>(
    null
  );

  // Per-theme stats for the chip strip. Computed before the loading/error
  // early returns so hook order stays stable across renders.
  // - `roadmapThemeIds`: themes that actually have a cell on the roadmap.
  //   Hides chips that would empty all columns when clicked.
  // - `themeTicketCounts`: un-shipped Dev tickets per theme. The chip number
  //   then matches what shows up after the click — instead of "9 BD rows in
  //   the cluster" displayed but only 2 Dev tickets actually rendered.
  const { roadmapThemeIds, themeTicketCounts } = React.useMemo(() => {
    const ids = new Set<string>();
    const counts = new Map<string, number>();
    for (const col of data?.columns ?? []) {
      for (const cell of col.cells) {
        if (cell.theme) {
          ids.add(cell.theme.id);
          counts.set(
            cell.theme.id,
            (counts.get(cell.theme.id) ?? 0) + cell.tickets.length
          );
        }
      }
    }
    return { roadmapThemeIds: ids, themeTicketCounts: counts };
  }, [data?.columns]);

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

  const filterColumns = filterThemeId
    ? data.columns.map((col) => ({
        ...col,
        cells: col.cells.filter((c) => c.theme?.id === filterThemeId),
        totalTickets: col.cells
          .filter((c) => c.theme?.id === filterThemeId)
          .reduce((acc, c) => acc + c.tickets.length, 0),
      }))
    : data.columns;

  const totalTickets = filterColumns.reduce(
    (acc, c) => acc + c.totalTickets,
    0
  );
  const totalPull = filterColumns.reduce(
    (acc, col) =>
      acc + col.cells.reduce((s, c) => s + c.pull, 0),
    0
  );
  const totalPush = totalTickets - totalPull;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-base font-semibold text-neutral-900">
            What's shipping when
          </h2>
          <p className="flex items-baseline gap-1.5 text-xs text-neutral-500">
            <span>
              Time bands across themes. Pull = Dev work tied to BD feedback;
              Push = strategy-driven.
            </span>
            <BandRulesTooltip />
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <span>
            Current sprint:{" "}
            <span className="font-mono text-neutral-800">
              {data.currentSprintLabel ?? "—"}
            </span>
          </span>
          <span>
            Next:{" "}
            <span className="font-mono text-neutral-800">
              {data.nextSprintLabel ?? "—"}
            </span>
          </span>
        </div>
      </header>

      {/* Pull/push summary */}
      <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3 shadow-card">
        <div className="flex items-baseline gap-4 text-sm">
          <span className="text-neutral-500">{totalTickets} total tickets</span>
          <PullPushBar pull={totalPull} push={totalPush} large />
        </div>
      </div>

      <WeekStrip
        columns={data.columns}
        currentSprintLabel={data.currentSprintLabel}
        nextSprintLabel={data.nextSprintLabel}
      />

      <TopThemes
        selectedThemeId={filterThemeId}
        onSelectTheme={(t) => setFilterThemeId(t?.id ?? null)}
        helper="Click a theme to filter the columns below"
        scopeThemeIds={roadmapThemeIds}
        themeCounts={themeTicketCounts}
        countLabel="Dev tickets"
      />

      {data.risingNotScheduled.length > 0 ? (
        <RisingBanner items={data.risingNotScheduled} />
      ) : null}

      {filterThemeId && totalTickets === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
          No un-shipped Dev tickets are tied to this theme. Click the chip
          again to clear the filter.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {filterColumns.map((col) => (
            <RoadmapColumnView key={col.band} col={col} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Week strip ─────────────────────────────────────────────────────────────
// A small cue strip rendered above the band columns: 8 weeks (-1..+6 from this
// week), each showing how many Dev tickets fall in that Mon–Sun window based
// on internal-target-then-external-ETA. Today gets a vertical guide; the
// current/next sprint gets a thin underbar spanning matching weeks.

const WEEKS_BEFORE = 1;
const WEEKS_AFTER = 6;
const WEEK_COUNT = WEEKS_BEFORE + 1 + WEEKS_AFTER; // 8

/** Returns the Monday (00:00 local) of the week containing `d`. */
function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // getDay(): Sun=0, Mon=1 ... Sat=6. Want Monday-based.
  const dow = out.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  out.setDate(out.getDate() + diff);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function shortMonthDay(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Best-effort parse of a date value coming off a RoadmapTicket. Accepts:
 *   - ISO yyyy-mm-dd (treated as local midnight)
 *   - numeric epoch ms (stringified or number)
 *   - any Date.parse-able string
 * Returns null when unparseable / empty.
 */
function parseTicketDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const num = Number(s);
  if (Number.isFinite(num) && num > 0 && /^\d+$/.test(s)) {
    return new Date(num);
  }
  // ISO yyyy-mm-dd → parse as local midnight to keep week-binning stable.
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (isoMatch) {
    return new Date(
      Number(isoMatch[1]),
      Number(isoMatch[2]) - 1,
      Number(isoMatch[3])
    );
  }
  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t);
  return null;
}

const SPRINT_RANGE_RE =
  /:\s*([A-Za-z]+)\s+(\d{1,2})\s*[-–—]\s*([A-Za-z]+)?\s*(\d{1,2})/;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** Parse a sprint label like "Sprint 31: May 5 - May 18" into a [start, end]
 * Date pair (both at local midnight, end is inclusive day). Returns null on
 * any parse failure. Year is inferred from "today" — if the parsed start is
 * more than ~6 months before today, bumps to next year (handles year flip). */
function parseSprintRange(label: string | null): {
  number: string | null;
  start: Date;
  end: Date;
} | null {
  if (!label) return null;
  const m = SPRINT_RANGE_RE.exec(label);
  if (!m) return null;
  const startMonth = MONTHS[m[1].toLowerCase()];
  const startDay = Number(m[2]);
  const endMonthStr = m[3] ?? m[1];
  const endMonth = MONTHS[endMonthStr.toLowerCase()];
  const endDay = Number(m[4]);
  if (
    startMonth === undefined ||
    endMonth === undefined ||
    !Number.isFinite(startDay) ||
    !Number.isFinite(endDay)
  ) {
    return null;
  }
  const today = new Date();
  let year = today.getFullYear();
  let start = new Date(year, startMonth, startDay);
  let end = new Date(year, endMonth, endDay);
  // If end < start, sprint crosses year boundary.
  if (end < start) end = new Date(year + 1, endMonth, endDay);
  // If start is way before today, this is next year's same-numbered sprint.
  const sixMonthsAgo = addDays(today, -180);
  if (start < sixMonthsAgo) {
    year += 1;
    start = new Date(year, startMonth, startDay);
    end = new Date(year, endMonth, endDay);
    if (end < start) end = new Date(year + 1, endMonth, endDay);
  }
  // Sprint number: pull leading "Sprint NN" if present.
  const numberMatch = /sprint\s*(\d+)/i.exec(label);
  return {
    number: numberMatch ? numberMatch[1] : null,
    start,
    end,
  };
}

function WeekStrip({
  columns,
  currentSprintLabel,
  nextSprintLabel,
}: {
  columns: RoadmapColumn[];
  currentSprintLabel: string | null;
  nextSprintLabel: string | null;
}) {
  const { weeks, todayIdx, todayPctInWeek, sprintBars } = React.useMemo(() => {
    const today = new Date();
    const thisWeekStart = startOfWeek(today);
    const stripStart = addDays(thisWeekStart, -7 * WEEKS_BEFORE);

    type Week = { start: Date; end: Date; count: number };
    const weeks: Week[] = [];
    for (let i = 0; i < WEEK_COUNT; i++) {
      const start = addDays(stripStart, i * 7);
      const end = addDays(start, 6); // Sun (inclusive)
      weeks.push({ start, end, count: 0 });
    }

    const stripEnd = addDays(stripStart, WEEK_COUNT * 7); // exclusive

    for (const col of columns) {
      for (const cell of col.cells) {
        for (const t of cell.tickets) {
          const d =
            parseTicketDate(t.internalTargetDate) ??
            parseTicketDate(t.eta);
          if (!d) continue;
          if (d < stripStart || d >= stripEnd) continue;
          const idx = Math.floor(
            (d.getTime() - stripStart.getTime()) / (7 * 24 * 60 * 60 * 1000)
          );
          if (idx >= 0 && idx < weeks.length) weeks[idx].count += 1;
        }
      }
    }

    // Today guide: percentage across the today-week column (Mon=0% ... Sun=~100%)
    const todayIdx = WEEKS_BEFORE;
    const dayOfWeek = (today.getDay() + 6) % 7; // Mon=0 .. Sun=6
    const msIntoDay =
      today.getTime() -
      new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      ).getTime();
    const todayPctInWeek =
      (dayOfWeek + msIntoDay / (24 * 60 * 60 * 1000)) / 7;

    // Sprint bars — span weeks whose [Mon..Sun] overlaps [start..end].
    function rangeToWeekSpan(
      r: { start: Date; end: Date } | null
    ): { firstIdx: number; lastIdx: number } | null {
      if (!r) return null;
      let first = -1;
      let last = -1;
      for (let i = 0; i < weeks.length; i++) {
        const w = weeks[i];
        const wEndExclusive = addDays(w.end, 1);
        const overlap = r.start < wEndExclusive && r.end >= w.start;
        if (overlap) {
          if (first === -1) first = i;
          last = i;
        }
      }
      if (first === -1) return null;
      return { firstIdx: first, lastIdx: last };
    }

    const cur = parseSprintRange(currentSprintLabel);
    const nxt = parseSprintRange(nextSprintLabel);
    const sprintBars: {
      key: string;
      number: string | null;
      tone: "current" | "next";
      firstIdx: number;
      lastIdx: number;
    }[] = [];
    const curSpan = rangeToWeekSpan(cur);
    if (cur && curSpan) {
      sprintBars.push({
        key: "current",
        number: cur.number,
        tone: "current",
        ...curSpan,
      });
    }
    const nxtSpan = rangeToWeekSpan(nxt);
    if (nxt && nxtSpan) {
      sprintBars.push({
        key: "next",
        number: nxt.number,
        tone: "next",
        ...nxtSpan,
      });
    }

    return { weeks, todayIdx, todayPctInWeek, sprintBars };
  }, [columns, currentSprintLabel, nextSprintLabel]);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-card">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-wide text-neutral-500">
          Week strip
        </span>
        <span className="text-[10px] text-neutral-400">
          Internal target · falls back to external ETA
        </span>
      </div>
      <div
        className="relative grid"
        style={{ gridTemplateColumns: `repeat(${WEEK_COUNT}, minmax(0, 1fr))` }}
      >
        {weeks.map((w, i) => {
          const isToday = i === todayIdx;
          return (
            <div
              key={i}
              className={cn(
                "flex h-[50px] flex-col items-center justify-center border-r border-neutral-100 px-1 text-center last:border-r-0",
                isToday && "bg-blue-50/70"
              )}
            >
              <div
                className={cn(
                  "text-[10px] leading-tight",
                  isToday ? "font-medium text-blue-700" : "text-neutral-500"
                )}
              >
                {shortMonthDay(w.start)}
              </div>
              <div
                className={cn(
                  "mt-0.5 text-[11px] leading-tight tabular-nums",
                  w.count === 0
                    ? "text-neutral-300"
                    : isToday
                      ? "font-semibold text-blue-800"
                      : "text-neutral-700"
                )}
                title={`${w.count} ticket${w.count === 1 ? "" : "s"} · ${shortMonthDay(w.start)} – ${shortMonthDay(w.end)}`}
              >
                {w.count} {w.count === 1 ? "ticket" : "tickets"}
              </div>
            </div>
          );
        })}

        {/* today vertical guide */}
        <div
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-blue-500/70"
          style={{
            left: `calc(${((todayIdx + todayPctInWeek) / WEEK_COUNT) * 100}%)`,
          }}
          aria-hidden
        />

        {/* sprint underbars */}
        {sprintBars.map((b, idx) => {
          const leftPct = (b.firstIdx / WEEK_COUNT) * 100;
          const widthPct = ((b.lastIdx - b.firstIdx + 1) / WEEK_COUNT) * 100;
          const tone =
            b.tone === "current"
              ? "bg-blue-500/80 text-white"
              : "bg-amber-500/80 text-white";
          return (
            <div
              key={b.key}
              className={cn(
                "pointer-events-none absolute flex items-center justify-center rounded-sm px-1 text-[9px] font-medium leading-none",
                tone
              )}
              style={{
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                bottom: idx === 0 ? -10 : -20,
                height: 8,
              }}
              title={
                b.tone === "current"
                  ? `Current sprint${b.number ? " " + b.number : ""}`
                  : `Next sprint${b.number ? " " + b.number : ""}`
              }
            >
              {b.tone === "current" ? "S" : "S+1"}
              {b.number ? b.number : ""}
            </div>
          );
        })}
      </div>
      {sprintBars.length > 0 ? <div className="h-6" /> : null}
    </div>
  );
}

function RoadmapColumnView({ col }: { col: RoadmapColumn }) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border bg-white shadow-card",
        BAND_TONE[col.band]
      )}
    >
      <header className="border-b border-neutral-200/60 px-3 py-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-neutral-900">{col.label}</h3>
          <span className="text-xs text-neutral-500">
            {col.totalTickets} ticket{col.totalTickets === 1 ? "" : "s"}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-neutral-500">{col.helper}</p>
      </header>

      <div className="flex flex-col gap-2 px-2 py-2">
        {col.cells.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-neutral-400">
            empty
          </p>
        ) : (
          col.cells.map((cell, idx) => (
            <RoadmapCellView
              key={cell.theme?.id ?? `untheme-${idx}`}
              cell={cell}
            />
          ))
        )}
      </div>
    </section>
  );
}

function RoadmapCellView({ cell }: { cell: RoadmapCell }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function openTicket(ticket: RoadmapTicket) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("panel", ticket.recordId);
    next.set("kind", "dev");
    next.delete("flow");
    router.push(`${pathname}?${next.toString()}`);
  }

  const themeLabel = cell.theme?.name ?? cell.unthemedLabel ?? "Unthemed";
  const isUnthemed = !cell.theme;
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-neutral-200 bg-white">
      <header className="flex items-center justify-between gap-2 border-b border-neutral-100 px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "truncate text-xs font-semibold",
              isUnthemed ? "text-neutral-500" : "text-neutral-800"
            )}
          >
            {themeLabel}
          </span>
          {cell.theme?.rising ? <RisingBadge /> : null}
        </div>
        <PullPushBar pull={cell.pull} push={cell.push} />
      </header>
      <ul className="divide-y divide-neutral-100">
        {cell.tickets.map((t) => (
          <li
            key={t.recordId}
            onClick={() => openTicket(t)}
            className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 px-2 py-1.5 text-xs hover:bg-neutral-50"
          >
            <span className="flex min-w-0 items-baseline">
              <span
                className={cn(
                  "mr-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                  t.hasFeedback ? "bg-blue-500" : "bg-neutral-300"
                )}
                title={t.hasFeedback ? "Pull (BD-driven)" : "Push (strategy-driven)"}
              />
              <span className="min-w-0 flex-1 truncate text-neutral-800">
                {t.description}
              </span>
            </span>
            <span className="flex shrink-0 items-baseline gap-1.5 text-neutral-500">
              {/* Dot priority: internal-overdue (red) ≻ internal-slipping (amber)
                  ≻ external-overdue (red). Only one renders. */}
              {t.internalOverdue && !t.internalSlipping ? (
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full bg-red-500"
                  title={`Internal target ${t.internalTargetDate} passed — still in flight`}
                />
              ) : t.internalSlipping ? (
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                  title={`Internal target ${t.internalTargetDate} passed — external ${formatLarkDate(t.eta)} still in future`}
                />
              ) : t.overdue ? (
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full bg-red-500"
                  title="External ETA passed — still in flight"
                />
              ) : null}
              {t.assigneeNames[0] ? (
                <span className="text-[10px]" title={t.assigneeNames.join(", ")}>
                  {initialsFor(t.assigneeNames[0])}
                </span>
              ) : null}
              <span
                className={cn(
                  (t.internalOverdue || (t.overdue && !t.internalTargetDate)) &&
                    "text-red-600",
                  t.internalSlipping && "text-amber-600"
                )}
                title={
                  t.internalTargetDate
                    ? `Internal target: ${t.internalTargetDate} · External: ${formatLarkDate(t.eta) || "—"}`
                    : `External ETA: ${formatLarkDate(t.eta) || "—"}`
                }
              >
                {/* Show internal target as primary date when set; else external. */}
                {t.internalTargetDate || formatLarkDate(t.eta)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PullPushBar({
  pull,
  push,
  large = false,
}: {
  pull: number;
  push: number;
  large?: boolean;
}) {
  const total = pull + push;
  if (total === 0) {
    return (
      <span className="text-[10px] text-neutral-400">no tickets</span>
    );
  }
  const pullPct = (pull / total) * 100;
  const dim = large ? "h-2 w-40" : "h-1.5 w-16";
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cn(
          "flex overflow-hidden rounded-full bg-neutral-200",
          dim
        )}
        title={`${pull} pull · ${push} push`}
      >
        <span
          className="bg-blue-500"
          style={{ width: `${pullPct}%` }}
        />
      </span>
      <span className={cn("text-[10px] text-neutral-500", large && "text-xs")}>
        {pull} pull · {push} push
      </span>
    </span>
  );
}

function RisingBanner({
  items,
}: {
  items: { id: string; name: string; bdVolume: number }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function openTriageForTheme() {
    // Triage page reads its own theme filter via TopThemes; sending the user
    // there is enough — they can click the theme chip to scope the BDs.
    router.push("/triage");
    void pathname;
    void searchParams;
  }

  const list = items.slice(0, 5);
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <TrendingUp className="h-4 w-4 shrink-0 text-amber-700" />
      <span className="font-medium">
        Rising in BD feedback but not yet on the roadmap:
      </span>
      <ul className="flex flex-wrap items-center gap-1.5">
        {list.map((t) => (
          <li key={t.id}>
            <span className="inline-flex items-center gap-1 rounded bg-white/70 px-1.5 py-0.5">
              {t.name}
              <span className="text-amber-700/70">·</span>
              <span className="tabular-nums">{t.bdVolume}</span>
            </span>
          </li>
        ))}
        {items.length > list.length ? (
          <li className="text-amber-700/70">
            +{items.length - list.length} more
          </li>
        ) : null}
      </ul>
      <Button
        size="sm"
        variant="secondary"
        onClick={openTriageForTheme}
        className="ml-auto"
      >
        <Wand2 className="h-3.5 w-3.5" />
        Scope a theme
      </Button>
    </section>
  );
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
