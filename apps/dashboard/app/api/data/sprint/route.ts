import { NextResponse } from "next/server";
import { fetchAllDev, projectDev, inferCurrentSprint } from "@/lib/data-derive";
import type { DevRow, SprintData } from "@/lib/data-shapes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const raws = await fetchAllDev();
  const all = raws.map((r) => projectDev(r));
  const currentSprint = inferCurrentSprint(all);
  // We display "current" + adjacent sprints. Find sprint labels that contain
  // "S<n>" style numbers and pick the two nearest current.
  const sprintLabels = [...new Set(all.map((r) => r.sprint).filter(Boolean))];
  const ordered = sortSprintLabels(sprintLabels);
  const currentIdx = currentSprint ? ordered.indexOf(currentSprint) : -1;
  const visible =
    currentIdx >= 0
      ? [ordered[currentIdx], ordered[currentIdx + 1]].filter(Boolean)
      : ordered.slice(-2);

  // Project with sprint context so aging signals fire correctly.
  const rows = raws.map((r) =>
    projectDev(r, { currentSprintLabel: currentSprint ?? undefined })
  );

  const sprints = visible.map((label) => {
    const inSprint = rows.filter((r) => r.sprint === label);
    const byAssignee = new Map<string, DevRow[]>();
    for (const r of inSprint) {
      const name = r.assignees[0]?.name || "Unassigned";
      const arr = byAssignee.get(name) ?? [];
      arr.push(r);
      byAssignee.set(name, arr);
    }
    return {
      label,
      assignees: [...byAssignee.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, rows]) => ({ name, rows })),
    };
  });

  const data: SprintData = { sprints, currentSprintLabel: currentSprint };
  return NextResponse.json(data);
}

function sortSprintLabels(labels: string[]): string[] {
  return labels.slice().sort((a, b) => {
    const an = Number(a.match(/(\d+)/)?.[1] ?? 0);
    const bn = Number(b.match(/(\d+)/)?.[1] ?? 0);
    return an - bn || a.localeCompare(b);
  });
}
