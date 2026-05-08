import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Single source of truth for resolving the salonx-flightdeck workspace root
 * from any module under `lib/`. Counts up two levels from this file's URL.
 *
 * Imported by mcp-config.ts and the proposed-action approve route — the
 * latter previously counted "../" levels by hand, which broke when the file
 * moved. Use this everywhere instead.
 */
export function workspaceRoot(): string {
  // lib/claude/paths.ts → ../.. = workspace root
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

/** scoping-outputs/ — where weekly-review writes Markdown files.
 *  Honors FLIGHTDECK_OUTPUT_DIR for deployments where the workspace is read-only
 *  (e.g. systemd unit on hubbibi writing to /srv/flightdeck/scoping-outputs/). */
export function scopingOutputsDir(): string {
  if (process.env.FLIGHTDECK_OUTPUT_DIR) {
    return path.resolve(process.env.FLIGHTDECK_OUTPUT_DIR);
  }
  return path.join(workspaceRoot(), "scoping-outputs");
}

/** .data/ — gitignored ephemeral state (SQLite, mcp-config.json). */
export function dataDir(): string {
  return path.join(workspaceRoot(), ".data");
}
