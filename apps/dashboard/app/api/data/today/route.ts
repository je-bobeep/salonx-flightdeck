import { NextResponse } from "next/server";
import {
  fetchAllBd,
  fetchAllDev,
  projectBd,
  projectDev,
  inferCurrentSprint,
} from "@/lib/data-derive";
import { isActive } from "@/lib/status";
import { readThemesCachedOnly } from "@flightdeck/themes-server/orchestrate";
import type { TodayData } from "@/lib/data-shapes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET() {
  const now = Date.now();
  const [bdRaws, devRaws] = await Promise.all([fetchAllBd(), fetchAllDev()]);
  const allBd = bdRaws.map((r) => projectBd(r, now));
  const baseDev = devRaws.map((r) => projectDev(r));
  const currentSprint = inferCurrentSprint(baseDev, now);
  const allDev = devRaws.map((r) =>
    projectDev(r, { currentSprintLabel: currentSprint ?? undefined, now })
  );

  // BD signals
  const bdNewLast7d = allBd.filter(
    (r) => r.dateRecordedMs !== null && now - r.dateRecordedMs < 7 * DAY_MS
  ).length;
  const bdUnaddressed = allBd.filter(
    (r) => !r.hasLinkedDev && !r.hasDayOfDeploying
  );
  const bdStale30d = bdUnaddressed.filter((r) => (r.ageDays ?? 0) > 30).length;
  const bdStale14d = bdUnaddressed.filter(
    (r) => (r.ageDays ?? 0) > 14 && (r.ageDays ?? 0) <= 30
  ).length;
  const bdPocCount = bdUnaddressed.filter((r) => r.fromPocMerchant).length;
  const bdPocStale = bdUnaddressed.filter(
    (r) => r.fromPocMerchant && (r.ageDays ?? 0) > 14
  ).length;

  // Dev signals — `noEta` measures the planning-relevant absence: an active
  // sprint row with NEITHER an internal target NOR an external ETA. Rows
  // with internal target set but external missing are NOT flagged here
  // (internal is the merge plan; external is the commitment hygiene).
  const sprintRows = allDev.filter((r) => r.sprint === currentSprint);
  const sprintActive = sprintRows.filter((r) => isActive(r.status));
  const sprintNoEta = sprintActive.filter(
    (r) => !r.internalTargetDate && !r.eta
  ).length;
  const sprintNoMilestone = sprintActive.filter((r) => !r.milestone).length;
  const sprintStuck = sprintActive.filter((r) =>
    r.aging.some((s) => s.kind === "dev-status-stale")
  ).length;

  // Roadmap signals derived from theme cache (if present).
  const themesCache = readThemesCachedOnly();
  let risingNotOnRoadmap = 0;
  let uncoveredImmediateThemes = 0;
  // When clustering hit the deterministic fallback, surface that so the view
  // hides rising-dependent CTAs that would otherwise silently read as "all
  // clear" (the fallback can't compute a meaningful rising signal).
  const fallbackThemes = themesCache?.blob.mode === "fallback";
  if (themesCache) {
    const linkedDevIds = new Set<string>();
    for (const d of allDev) {
      if (d.bdLinkIds.length > 0) linkedDevIds.add(d.recordId);
    }
    for (const t of themesCache.blob.themes) {
      const hasDev = t.devRecordIds.some((id) =>
        allDev.some((d) => d.recordId === id && d.status !== "Done")
      );
      if (t.rising && !hasDev) risingNotOnRoadmap += 1;

      // "Uncovered Immediate-aged theme" = aging beyond 14d AND no covered Dev
      const aged = (t.bdMedianAgeDays ?? 0) > 14;
      const covered = t.devRecordIds.some((id) =>
        allDev.some((d) => d.recordId === id)
      );
      if (aged && !covered) uncoveredImmediateThemes += 1;
    }
  }

  // Coverage: of Immediate-priority unaddressed BD rows, how many are linked
  const immediateBd = allBd.filter(
    (r) => r.priority === "Immediate" && r.status !== "Won't Do"
  );
  const immediateBdLinked = immediateBd.filter((r) => r.hasLinkedDev).length;
  const immediateBdCovPct =
    immediateBd.length === 0
      ? null
      : Math.round((immediateBdLinked / immediateBd.length) * 100);

  const data: TodayData = {
    now,
    bd: {
      newLast7d: bdNewLast7d,
      unaddressed: bdUnaddressed.length,
      stale30d: bdStale30d,
      stale14d: bdStale14d,
      pocCount: bdPocCount,
      pocStale: bdPocStale,
      immediateCoveragePct: immediateBdCovPct,
      immediateTotal: immediateBd.length,
      immediateLinked: immediateBdLinked,
    },
    sprint: {
      label: currentSprint,
      total: sprintRows.length,
      active: sprintActive.length,
      noEta: sprintNoEta,
      noMilestone: sprintNoMilestone,
      stuck: sprintStuck,
    },
    roadmap: {
      risingNotOnRoadmap,
      uncoveredImmediateThemes,
      fallbackThemes,
    },
  };
  return NextResponse.json(data);
}
