// Server-side helpers that pull raw Lark records and project them into the
// shapes the views need.

import type { DevRow } from "./data-shapes";

export { fetchAllBd, projectBd, fetchAllDev, projectDev } from "@flightdeck/themes-server/fetch";

/** Heuristic: the "current" sprint is the most-frequent non-empty Sprint
 * label among rows whose Status is in an active state. Returns null if
 * nothing's running. */
/**
 * Parse "Sprint 15: May 4 - May 8" into a start/end date range. Year is
 * inferred from `now` because the label doesn't carry one. Returns null when
 * the label doesn't match the expected shape.
 */
function parseSprintRange(
  label: string,
  now: number
): { startMs: number; endMs: number } | null {
  const m = label.match(
    /:\s*([A-Za-z]+)\s+(\d{1,2})\s*[-–—]\s*([A-Za-z]+)?\s*(\d{1,2})/
  );
  if (!m) return null;
  const [, startMonth, startDay, endMonthRaw, endDay] = m;
  const endMonth = endMonthRaw ?? startMonth;
  const year = new Date(now).getUTCFullYear();
  const startMs = Date.parse(`${startMonth} ${startDay} ${year} 00:00:00 UTC`);
  let endMs = Date.parse(`${endMonth} ${endDay} ${year} 23:59:59 UTC`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  // Sprint that crosses Dec→Jan: end month wraps. Push end into next year.
  if (endMs < startMs) {
    endMs = Date.parse(
      `${endMonth} ${endDay} ${year + 1} 23:59:59 UTC`
    );
  }
  return { startMs, endMs };
}

export function inferCurrentSprint(
  rows: DevRow[],
  now: number = Date.now()
): string | null {
  // Strategy 1 (preferred): pick the sprint whose label-encoded date range
  // contains `now`. The label format is "Sprint NN: <start> - <end>" — when
  // it parses, the date range is authoritative. The activity heuristic below
  // can pick a future sprint that has more planned tickets than the actually-
  // in-flight one (e.g. when the current sprint just opened with nothing
  // moved over yet).
  const labels = new Set<string>();
  for (const r of rows) if (r.sprint) labels.add(r.sprint);
  const containing: { label: string; startMs: number }[] = [];
  for (const label of labels) {
    const range = parseSprintRange(label, now);
    if (!range) continue;
    if (now >= range.startMs && now <= range.endMs) {
      containing.push({ label, startMs: range.startMs });
    }
  }
  if (containing.length > 0) {
    // If multiple sprints overlap today (shouldn't normally happen), prefer
    // the one with the most recent start.
    containing.sort((a, b) => b.startMs - a.startMs);
    return containing[0].label;
  }

  // Strategy 2 (fallback): label doesn't parse or no sprint contains today.
  // Pick the one with the most active tickets.
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.sprint) continue;
    if (
      r.status === "In Progress" ||
      r.status === "In Review" ||
      r.status === "Ready" ||
      r.status === "Ready for Development"
    ) {
      counts.set(r.sprint, (counts.get(r.sprint) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [label, count] of counts) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}
