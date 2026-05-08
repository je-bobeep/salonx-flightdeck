// Sprint label naming + ordering helpers.
//
// Sprint labels in this Lark Base typically look like "SP-23", "S25", or
// "Sprint 7". We sort by the embedded numeric and use that to find adjacent
// sprints (next, previous).

export function sortSprintLabels(labels: string[]): string[] {
  return labels.slice().sort((a, b) => {
    const an = Number(a.match(/(\d+)/)?.[1] ?? 0);
    const bn = Number(b.match(/(\d+)/)?.[1] ?? 0);
    return an - bn || a.localeCompare(b);
  });
}

/**
 * Given the current sprint label and the full set of distinct sprint labels
 * seen across Dev rows, return the label of the sprint immediately after the
 * current one. Falls back to null if no later sprint is observed.
 */
export function nextSprintLabel(
  currentLabel: string | null,
  allLabels: string[]
): string | null {
  if (!currentLabel) return null;
  const ordered = sortSprintLabels([...new Set(allLabels.filter(Boolean))]);
  const idx = ordered.indexOf(currentLabel);
  if (idx < 0) return null;
  return ordered[idx + 1] ?? null;
}
