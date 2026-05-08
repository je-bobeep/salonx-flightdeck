import { NextResponse } from "next/server";
import {
  fetchAllBd,
  fetchAllDev,
  projectBd,
  projectDev,
} from "@/lib/data-derive";
import {
  buildBdToThemeMap,
  readThemesCachedOnly,
} from "@/lib/themes-server";
import type {
  BdRow,
  CoverageEntry,
  DevRow,
  LinkageData,
} from "@/lib/data-shapes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [bdRaws, devRaws] = await Promise.all([fetchAllBd(), fetchAllDev()]);
  const bdRows = bdRaws.map((r) => projectBd(r));
  const devRows = devRaws.map((r) => projectDev(r));

  const devById = new Map<string, DevRow>(devRows.map((d) => [d.recordId, d]));
  const bdById = new Map<string, BdRow>(bdRows.map((b) => [b.recordId, b]));

  const pairs: { bd: BdRow; dev: DevRow }[] = [];
  const linkedBdIds = new Set<string>();
  const linkedDevIds = new Set<string>();

  for (const bd of bdRows) {
    for (const devId of bd.linkedDevIds) {
      const dev = devById.get(devId);
      if (dev) {
        pairs.push({ bd, dev });
        linkedBdIds.add(bd.recordId);
        linkedDevIds.add(dev.recordId);
      }
    }
  }
  // Reverse direction (Dev's BD link), in case BD's Development Task field is missing.
  for (const dev of devRows) {
    for (const bdId of dev.bdLinkIds) {
      if (linkedDevIds.has(dev.recordId)) continue;
      const bd = bdById.get(bdId);
      if (bd) {
        pairs.push({ bd, dev });
        linkedBdIds.add(bd.recordId);
        linkedDevIds.add(dev.recordId);
      }
    }
  }

  const orphanDev = devRows.filter((d) => !linkedDevIds.has(d.recordId));

  // Coverage by theme — only if a theme cache exists. We deliberately do NOT
  // trigger a fresh cluster here; it can take 30s+ and would block /linkage.
  // Users hit "Re-cluster" from the TopThemes UI; this route just reflects
  // whatever cluster is in cache.
  const themesCache = readThemesCachedOnly();
  const coverage: CoverageEntry[] = [];
  if (themesCache) {
    const bdToTheme = buildBdToThemeMap(themesCache.blob.themes);
    for (const theme of themesCache.blob.themes) {
      const memberBdIds = theme.bdRecordIds.filter((id) => bdById.has(id));
      const coveredBdIds = memberBdIds.filter((id) => linkedBdIds.has(id));
      const uncoveredBdIds = memberBdIds.filter(
        (id) => !linkedBdIds.has(id)
      );

      const devTickets = theme.devRecordIds
        .map((id) => devById.get(id))
        .filter((d): d is DevRow => Boolean(d))
        .filter((d) => d.status !== "Done")
        .map((d) => ({
          recordId: d.recordId,
          description: d.description,
          status: d.status,
          eta: d.eta,
          releaseDate: d.releaseDate,
        }));

      coverage.push({
        theme,
        coveredBdCount: coveredBdIds.length,
        uncoveredBdCount: uncoveredBdIds.length,
        coveredBdIds,
        uncoveredBdIds,
        devTickets,
      });
    }
    // Sort: themes with most uncovered BDs first (where the gap is widest).
    coverage.sort((a, b) => b.uncoveredBdCount - a.uncoveredBdCount);
    void bdToTheme; // (currently unused outside the build above)
  }

  // Pairs: sort by Dev ETA asc when present, else by BD age desc.
  pairs.sort((a, b) => {
    const ae = parseEtaMs(a.dev.eta);
    const be = parseEtaMs(b.dev.eta);
    if (ae !== null && be !== null) return ae - be;
    if (ae !== null) return -1;
    if (be !== null) return 1;
    return (b.bd.ageDays ?? 0) - (a.bd.ageDays ?? 0);
  });
  orphanDev.sort(
    (a, b) => (b.lastModifiedMs ?? 0) - (a.lastModifiedMs ?? 0)
  );

  // Snapshot of BD rows referenced by coverage entries (so the view can render
  // uncovered BD details without an extra fetch). Keeps payload small by only
  // including referenced rows.
  const bdSnapshotIds = new Set<string>();
  for (const c of coverage) {
    for (const id of c.coveredBdIds) bdSnapshotIds.add(id);
    for (const id of c.uncoveredBdIds) bdSnapshotIds.add(id);
  }
  const bdById_out: Record<string, BdRow> = {};
  for (const id of bdSnapshotIds) {
    const r = bdById.get(id);
    if (r) bdById_out[id] = r;
  }

  const data: LinkageData = {
    pairs,
    orphanDev,
    coverage,
    bdById: bdById_out,
    themesUnavailable: themesCache?.blob.mode === "unavailable",
  };
  return NextResponse.json(data);
}

function parseEtaMs(s: string): number | null {
  if (!s) return null;
  const num = Number(s);
  if (Number.isFinite(num) && num > 0) return num;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
