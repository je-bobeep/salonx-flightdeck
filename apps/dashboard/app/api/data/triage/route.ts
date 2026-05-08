import { NextResponse } from "next/server";
import { fetchAllBd, fetchAllDev, projectBd, projectDev } from "@/lib/data-derive";
import { statusBucket } from "@/lib/status";
import type { BdRow, DevRow, TriageData } from "@/lib/data-shapes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIORITY_ORDER: Record<string, number> = {
  Immediate: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

export async function GET() {
  const now = Date.now();
  const [bdRaws, devRaws] = await Promise.all([fetchAllBd(), fetchAllDev()]);
  const all = bdRaws.map((r) => projectBd(r, now));
  // "Needs triaging" = the ask has not been actioned in any way yet:
  // no linked Dev ticket AND no Day-of-deploying date set. Status is
  // intentionally NOT in this filter — rows can sit in any non-terminal
  // status and still need a decision.
  const unaddressed = all.filter(
    (r) => !r.hasLinkedDev && !r.hasDayOfDeploying
  );

  // Group by priority bucket; sort within each by age desc.
  const buckets = new Map<string, BdRow[]>();
  for (const row of unaddressed) {
    const key = row.priority || "—";
    const arr = buckets.get(key) ?? [];
    arr.push(row);
    buckets.set(key, arr);
  }
  for (const arr of buckets.values()) {
    arr.sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));
  }

  const groups = [...buckets.entries()]
    .sort(
      (a, b) =>
        (PRIORITY_ORDER[a[0]] ?? 99) - (PRIORITY_ORDER[b[0]] ?? 99) ||
        a[0].localeCompare(b[0])
    )
    .map(([priority, rows]) => ({ priority, rows }));

  // Critical Fix Dev tickets — pinned at the top of Triage as the most urgent
  // items in flight. Filter on Dev-side priority "0 Critical Fix" (paired
  // with Milestone "-1: Critical Fix from BD" by convention but priority is
  // the authoritative signal). Exclude shipped tickets; we only care about
  // ones still requiring attention.
  const allDev = devRaws.map((r) => projectDev(r, { now }));
  const criticalFix: DevRow[] = allDev
    .filter((r) => r.priority === "0 Critical Fix")
    .filter((r) => statusBucket(r.status) !== "done")
    .sort((a, b) => {
      // In-flight first, then by ETA asc (sooner-due first), then by
      // last-modified desc as the tiebreaker.
      const aActive = statusBucket(a.status) === "eng" ? 0 : 1;
      const bActive = statusBucket(b.status) === "eng" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      const ae = parseEtaMs(a.eta);
      const be = parseEtaMs(b.eta);
      if (ae !== null && be !== null) return ae - be;
      if (ae !== null) return -1;
      if (be !== null) return 1;
      return (b.lastModifiedMs ?? 0) - (a.lastModifiedMs ?? 0);
    });

  const data: TriageData = {
    groups,
    totalCount: unaddressed.length,
    criticalFix,
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
