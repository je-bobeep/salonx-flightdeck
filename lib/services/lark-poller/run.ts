#!/usr/bin/env -S npx tsx
// CLI entrypoint for the BD-feedback poller.
//
// Usage:
//   pnpm --filter @flightdeck/poller once     # one cycle
//   pnpm --filter @flightdeck/poller start    # forever, every 15 min
//
// The script writes structured stdout per cycle and exits non-zero on fatal
// error. Auth is whatever's in .data/tokens.db — make sure you're signed in
// via the dashboard's /auth/lark/start flow first.

import { POLLER_CONFIG } from "./config";
import { pollOnce } from "./poll";
import { runClusterStep } from "./cluster-step";

function tsLog(s: string) {
  process.stdout.write(`${new Date().toISOString()} ${s}\n`);
}

async function runOnce() {
  const summary = await pollOnce({ log: tsLog });
  tsLog(
    `[poller] done — fetched=${summary.fetched} ingested=${summary.ingested} skipped=${summary.skipped} failed=${summary.failed} (${summary.finishedAt - summary.startedAt}ms)`
  );

  // Cluster step. Never throws; logs + persists its own outcome.
  const clusterResult = await runClusterStep({ log: tsLog });
  tsLog(
    `[poller] cluster done — mode=${clusterResult.mode} themes=${clusterResult.themesCount} newThemes=${clusterResult.newThemes}`
  );
}

const forever = process.argv.includes("--forever");
const once = process.argv.includes("--once") || !forever;

(async () => {
  try {
    await runOnce();
  } catch (e) {
    tsLog(`[poller] fatal: ${e instanceof Error ? e.stack : String(e)}`);
    if (!forever) process.exit(1);
  }

  if (forever) {
    tsLog(`[poller] entering forever mode — interval ${POLLER_CONFIG.intervalMs / 1000}s`);
    setInterval(async () => {
      try {
        await runOnce();
      } catch (e) {
        tsLog(`[poller] cycle error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, POLLER_CONFIG.intervalMs);
  } else if (!once) {
    process.exit(0);
  }
})();
