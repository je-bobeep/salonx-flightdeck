// Reader for KILLSWITCH.md. Generalised over workflow name so any background
// workflow can gate itself on a row in the same table.
//
// Fail-open if the file is unreadable (treat a missing/permission-denied
// KILLSWITCH.md as a deploy mishap, not a kill signal). Fail-closed if the
// workflow row is missing (adding the row is mandatory per KILLSWITCH.md).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KILLSWITCH_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../KILLSWITCH.md"
);

export function isWorkflowEnabled(workflowName: string): {
  enabled: boolean;
  reason?: string;
} {
  let content: string;
  try {
    content = fs.readFileSync(KILLSWITCH_PATH, "utf8");
  } catch {
    return { enabled: true, reason: "KILLSWITCH.md not readable, defaulting open" };
  }
  const needle = "`" + workflowName + "`";
  for (const line of content.split("\n")) {
    if (!line.startsWith("|") || !line.includes(needle)) continue;
    const cells = line.split("|").map((c) => c.trim());
    const status = cells.find((c) => c === "enabled" || c === "disabled");
    if (status) return { enabled: status === "enabled" };
  }
  return { enabled: false, reason: `workflow ${workflowName} not found in KILLSWITCH.md` };
}
