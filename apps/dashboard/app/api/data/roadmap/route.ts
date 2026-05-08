import { NextResponse } from "next/server";
import {
  fetchAllDev,
  inferCurrentSprint,
  projectDev,
} from "@/lib/data-derive";
import {
  buildBdToThemeMap,
  readThemesCachedOnly,
} from "@/lib/themes-server";
import { listDevOverrides, type RowOverride } from "@/lib/theme-overrides-db";
import { nextSprintLabel } from "@/lib/sprint-naming";
import { statusBucket } from "@/lib/status";
import type {
  DevRow,
  RoadmapBand,
  RoadmapCell,
  RoadmapColumn,
  RoadmapData,
  RoadmapTicket,
} from "@/lib/data-shapes";
import type { Theme } from "@flightdeck/themes/shapes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseEtaMs(s: string): number | null {
  if (!s) return null;
  const num = Number(s);
  if (Number.isFinite(num) && num > 0) return num;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function bandFor(
  dev: DevRow,
  now: number,
  currentSprint: string | null,
  nextSprint: string | null
): { band: RoadmapBand; overdue: boolean } {
  const eta = parseEtaMs(dev.eta);
  const daysToEta =
    eta !== null ? Math.round((eta - now) / DAY_MS) : null;

  // Sprint signals win first — they're explicit planning intent.
  if (currentSprint && dev.sprint === currentSprint)
    return { band: "now", overdue: daysToEta !== null && daysToEta < 0 };
  if (nextSprint && dev.sprint === nextSprint)
    return { band: "next", overdue: false };

  // Late-stage status short-circuit. Tickets that are "Ready for Release" or
  // "In Testing" are imminent regardless of ETA arithmetic — without this,
  // a past-sprint ticket whose ETA already slipped lands in "Soon" via the
  // 30–90 day branch even though it's about to ship. Force them to "Now".
  if (dev.status === "Ready for Release" || dev.status === "In Testing") {
    return { band: "now", overdue: daysToEta !== null && daysToEta < 0 };
  }

  // ETA-based banding. Past ETAs that are still in flight stay in Now with an
  // overdue flag — a PM looking at "Now" should see every actively-shipping
  // ticket, including ones that missed their target. Past ETAs on inactive
  // tickets drop to Later (they're not really in motion).
  if (daysToEta !== null) {
    if (daysToEta < 0) {
      return isInFlight(dev.status)
        ? { band: "now", overdue: true }
        : { band: "later", overdue: true };
    }
    if (daysToEta <= 14) return { band: "now", overdue: false };
    if (daysToEta <= 30) return { band: "next", overdue: false };
    if (daysToEta <= 90) return { band: "soon", overdue: false };
    return { band: "later", overdue: false };
  }

  // No ETA, no sprint: actively in-flight → Soon (squeaky), else Later.
  if (isInFlight(dev.status)) return { band: "soon", overdue: false };
  return { band: "later", overdue: false };
}

function isInFlight(status: string): boolean {
  return (
    status === "Ready" ||
    status === "Ready for Development" ||
    status === "In Progress" ||
    status === "In Review" ||
    status === "In Testing" ||
    status === "Ready for Release"
  );
}

/**
 * A ticket is "shipped" — and therefore doesn't belong on the Roadmap — if
 * (a) its Status is in the closed bucket (Released / Done / Won't Do), OR
 * (b) it has a Release Date that has already passed.
 *
 * Relying on Status alone misses cases where the row was marked released by
 * a future Release Date but the Status field hasn't been updated yet.
 */
function isShipped(dev: DevRow, now: number): boolean {
  if (statusBucket(dev.status) === "done") return true;
  const release = parseEtaMs(dev.releaseDate);
  if (release !== null && release <= now) return true;
  return false;
}

function toRoadmapTicket(
  dev: DevRow,
  overdue = false,
  now: number = Date.now()
): RoadmapTicket {
  // Internal target overdue / slipping. Use end-of-day so a target of
  // 2026-05-07 isn't considered overdue at 9am on that same day.
  let internalOverdue = false;
  let internalSlipping = false;
  if (dev.internalTargetDate) {
    const internalMs = Date.parse(dev.internalTargetDate + "T23:59:59Z");
    if (Number.isFinite(internalMs) && internalMs < now) {
      internalOverdue = true;
      const externalMs = Date.parse(dev.eta);
      // Slipping: internal passed but external is still in the future.
      if (Number.isFinite(externalMs) && externalMs > now) {
        internalSlipping = true;
      }
    }
  }
  return {
    recordId: dev.recordId,
    description: dev.description,
    status: dev.status,
    priority: dev.priority,
    milestone: dev.milestone,
    sprint: dev.sprint,
    assigneeNames: dev.assignees
      .map((a) => a.name ?? "")
      .filter((n): n is string => !!n),
    eta: dev.eta,
    releaseDate: dev.releaseDate,
    internalTargetDate: dev.internalTargetDate,
    hasFeedback: dev.bdLinkIds.length > 0,
    overdue,
    internalOverdue,
    internalSlipping,
  };
}

function slugifyName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function pickThemeForDev(
  dev: DevRow,
  themes: Theme[],
  devOverrides: Map<string, RowOverride>
): Theme | null {
  if (themes.length === 0) return null;
  // Manual override wins over both authoritative joins. If the override's id
  // is missing (rename / re-cluster), try to recover via the snapshotted
  // theme name: slug-match against current themes. Drop silently if both
  // fail and fall through to scoring.
  const override = devOverrides.get(dev.recordId);
  if (override) {
    const overridden = themes.find((t) => t.id === override.themeId);
    if (overridden) return overridden;
    if (override.themeName) {
      const wanted = slugifyName(override.themeName);
      const recovered = themes.find((t) => slugifyName(t.name) === wanted);
      if (recovered) return recovered;
    }
  }
  // A Dev ticket belongs to a theme ONLY via authoritative cross-references:
  //   (a) the Dev's record_id is in theme.devRecordIds — i.e. the cluster
  //       reached this Dev by joining a BD member's linkedDevIds.
  //   (b) any of the Dev's bdLinkIds is a member of the theme's bdRecordIds.
  // We previously had a third "fuzzy" rule that matched the Dev's
  // module/product strings against theme.dominantCategories on substring
  // overlap. That was too loose: themes with `dominantCategories=["Booking"]`
  // swallowed any Dev row containing "Booking" in its module — a "POS thank-
  // you screen" ticket and a "Bookings cancellation datetime" ticket were
  // both attributed to "Set Menu Booking". Push tickets that legitimately
  // have no BD link land in the unthemed bucket below — that grouping (by
  // module/milestone) is the correct home for them.
  const linkedBdSet = new Set(dev.bdLinkIds);
  let best: { theme: Theme; score: number } | null = null;
  for (const t of themes) {
    let score = 0;
    if (t.devRecordIds.includes(dev.recordId)) score += 5;
    for (const bdId of t.bdRecordIds) {
      if (linkedBdSet.has(bdId)) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { theme: t, score };
    }
  }
  return best?.theme ?? null;
}

/** Pick a non-theme grouping label for an unthemed Dev ticket so the "Now"
 * column doesn't collapse into one giant pile. Module wins; falls back to
 * milestone, then to a single shared "Other" bucket. */
function unthemedBucketKey(dev: DevRow): string {
  const mod = dev.module[0]?.trim();
  if (mod) return `mod:${mod}`;
  const ms = dev.milestone?.trim();
  if (ms) return `ms:${ms}`;
  return "other";
}

function unthemedBucketLabel(key: string): string {
  if (key === "other") return "Unlinked";
  if (key.startsWith("mod:")) return key.slice(4);
  if (key.startsWith("ms:")) return key.slice(3);
  return key;
}

const BAND_DEFS: { band: RoadmapBand; label: string; helper: string }[] = [
  {
    band: "now",
    label: "Now",
    helper: "In current sprint or shipping in ≤ 14 days",
  },
  {
    band: "next",
    label: "Next",
    helper: "In next sprint or 14–30 days out",
  },
  {
    band: "soon",
    label: "Soon",
    helper: "30–90 days out, or in flight without a sprint or ETA",
  },
  {
    band: "later",
    label: "Later",
    helper: "Beyond 90 days, or no ETA set",
  },
];

export async function GET() {
  const now = Date.now();
  const raws = await fetchAllDev();
  const baseDev = raws.map((r) => projectDev(r));
  const currentSprint = inferCurrentSprint(baseDev, now);
  const allDevLabels = baseDev.map((r) => r.sprint);
  const next = nextSprintLabel(currentSprint, allDevLabels);

  const allDev = raws
    .map((r) =>
      projectDev(r, { currentSprintLabel: currentSprint ?? undefined, now })
    )
    .filter((d) => !isShipped(d, now));

  const themesCache = readThemesCachedOnly();
  const themes = themesCache?.blob.themes ?? [];
  const devOverrides = listDevOverrides();

  // Bucket each ticket into a band + cell. Themed tickets cluster by theme;
  // unthemed ones fall back to module/milestone so the column doesn't become
  // one giant flat list.
  type Cell = {
    theme: Theme | null;
    /** When theme is null, what we used as the sub-group label. */
    unthemedLabel?: string;
    tickets: RoadmapTicket[];
  };
  const banded: Record<RoadmapBand, Map<string, Cell>> = {
    now: new Map(),
    next: new Map(),
    soon: new Map(),
    later: new Map(),
  };

  for (const dev of allDev) {
    const { band, overdue } = bandFor(dev, now, currentSprint, next);
    const theme = pickThemeForDev(dev, themes, devOverrides);
    const cellKey = theme?.id ?? `__un__${unthemedBucketKey(dev)}`;
    const bucket = banded[band];
    let cell = bucket.get(cellKey);
    if (!cell) {
      cell = {
        theme,
        unthemedLabel: theme
          ? undefined
          : unthemedBucketLabel(unthemedBucketKey(dev)),
        tickets: [],
      };
      bucket.set(cellKey, cell);
    }
    cell.tickets.push(toRoadmapTicket(dev, overdue, now));
  }

  const columns: RoadmapColumn[] = BAND_DEFS.map(({ band, label, helper }) => {
    const bucket = banded[band];
    const cells: RoadmapCell[] = [];
    let totalTickets = 0;
    for (const [, cell] of bucket) {
      cell.tickets.sort((a, b) => {
        const ae = parseEtaMs(a.eta);
        const be = parseEtaMs(b.eta);
        if (ae !== null && be !== null) return ae - be;
        if (ae !== null) return -1;
        if (be !== null) return 1;
        return 0;
      });
      const pull = cell.tickets.filter((t) => t.hasFeedback).length;
      const push = cell.tickets.length - pull;
      totalTickets += cell.tickets.length;
      cells.push({
        theme: cell.theme,
        unthemedLabel: cell.unthemedLabel,
        tickets: cell.tickets,
        pull,
        push,
      });
    }
    cells.sort((a, b) => b.tickets.length - a.tickets.length);
    return { band, label, helper, cells, totalTickets };
  });

  // Rising signal: a theme that's gaining BD volume but is *under-served* by
  // Dev work (not just "zero tickets" — a theme with one token ticket is still
  // a signal worth flagging). Threshold: covered ratio below 30%.
  const coveredBdByTheme = new Map<string, number>();
  for (const t of themes) {
    let covered = 0;
    for (const bdId of t.bdRecordIds) {
      const linkedDev = allDev.find((d) => d.bdLinkIds.includes(bdId));
      if (linkedDev) covered += 1;
    }
    coveredBdByTheme.set(t.id, covered);
  }
  const risingNotScheduled = themes
    .filter((t) => {
      if (!t.rising) return false;
      const covered = coveredBdByTheme.get(t.id) ?? 0;
      const ratio = covered / Math.max(t.bdVolume, 1);
      return ratio < 0.3;
    })
    .map((t) => ({ id: t.id, name: t.name, bdVolume: t.bdVolume }));

  // Reference build-up to satisfy linters; this map is currently unused but
  // kept here in case future enhancements want a fast theme lookup.
  void buildBdToThemeMap(themes);

  const data: RoadmapData = {
    columns,
    risingNotScheduled,
    currentSprintLabel: currentSprint,
    nextSprintLabel: next,
    themesUnavailable: themesCache?.blob.mode === "unavailable",
  };
  return NextResponse.json(data);
}
