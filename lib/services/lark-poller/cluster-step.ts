// Cluster step run after a successful BD poller cycle. Honours KILLSWITCH,
// acquires the cluster mutex, calls computeFreshThemes (incremental by
// default; auto-promotes per existing drift logic), and records outcome on
// poller_state. Never throws — failures are logged and persisted.

import { acquireClusterMutex, releaseClusterMutex } from "@flightdeck/auth/cluster-mutex";
import { computeFreshThemes } from "@flightdeck/themes-server/orchestrate";
import { isWorkflowEnabled } from "./killswitch";
import { updateClusterState } from "./state";
import { POLLER_CONFIG } from "./config";

export type ClusterStepResult = {
  // Note: "empty-delta" is described in the spec as a separable mode but
  // collapses to "claude" at this layer because computeIncremental returns
  // mode="claude" for both real runs and short-circuited empty-delta runs.
  // Distinguishing them would require plumbing a new return field through
  // computeFreshThemes — deferred until usage shows it's worth it.
  mode: "claude" | "unavailable" | "skipped" | "disabled";
  themesCount: number;
  newThemes: number;
  err?: string;
};

export async function runClusterStep(opts: {
  log?: (s: string) => void;
} = {}): Promise<ClusterStepResult> {
  const log = opts.log ?? (() => {});
  const chatId = POLLER_CONFIG.chatId;

  // KILLSWITCH first — before any DB or Lark work.
  const ks = isWorkflowEnabled("auto-cluster");
  if (!ks.enabled) {
    log(`[poller-cluster] disabled via KILLSWITCH${ks.reason ? ` (${ks.reason})` : ""}`);
    updateClusterState({ chatId, mode: "disabled", error: null });
    return { mode: "disabled", themesCount: 0, newThemes: 0 };
  }

  // Mutex — yield to user-triggered Re-cluster if one is in flight.
  if (!acquireClusterMutex("poller")) {
    log("[poller-cluster] skipped — user cluster in flight");
    updateClusterState({ chatId, mode: "skipped", error: null });
    return { mode: "skipped", themesCount: 0, newThemes: 0 };
  }

  let result: ClusterStepResult;
  try {
    const fresh = await computeFreshThemes();
    const mode = fresh.blob.mode; // "claude" | "unavailable"
    const themesCount = fresh.blob.themes.length;
    const newThemes = fresh.blob.provenance?.lastIncrementalNewThemeCount ?? 0;

    if (mode === "unavailable") {
      log(
        `[poller-cluster] unavailable — Claude failed or returned nothing parseable; prior blob retained`
      );
      updateClusterState({
        chatId,
        mode: "unavailable",
        error: "Claude unavailable or zero themes",
      });
      result = { mode: "unavailable", themesCount, newThemes };
    } else {
      // "claude" mode is returned both for real cluster runs and for the
      // empty-delta short-circuit in computeIncremental. We can't distinguish
      // those here from the outside; the log line is the same either way.
      log(`[poller-cluster] ok themes=${themesCount} mode=${mode} newThemes=${newThemes}`);
      updateClusterState({ chatId, mode: "claude", error: null });
      result = { mode: "claude", themesCount, newThemes };
    }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log(`[poller-cluster] error: ${err}`);
    updateClusterState({ chatId, mode: "unavailable", error: err.slice(0, 200) });
    result = { mode: "unavailable", themesCount: 0, newThemes: 0, err };
  } finally {
    releaseClusterMutex();
  }

  return result;
}
