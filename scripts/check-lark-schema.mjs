#!/usr/bin/env node
// Schema-drift guard. Reads live Lark Base field metadata for the BD Feedback
// and Feature Development tables and asserts that every name in BD_FIELDS /
// FD_FIELDS still exists. Run before any approve-path edit:
//
//   pnpm tsx scripts/check-lark-schema.mjs
//
// Exits non-zero on drift so it can be wired into CI later. Requires a valid
// signed-in token in .data/tokens.db (the dashboard's OAuth session).

import { listFields } from "../lib/lark/bitable.ts";
import { TRACKER } from "../lib/lark/wiki.ts";
import { BD_FIELDS, FD_FIELDS } from "../lib/lark/schemas.ts";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";
const YELLOW = "\x1b[33m";

async function check(label, tableId, expected) {
  const live = await listFields(TRACKER.appToken, tableId);
  const liveNames = new Set(live.map((f) => f.fieldName));
  const missing = [];
  const found = [];
  for (const [key, expectedName] of Object.entries(expected)) {
    if (liveNames.has(expectedName)) {
      found.push(`  ✓ ${key.padEnd(24)} → ${JSON.stringify(expectedName)}`);
    } else {
      missing.push(
        `  ✗ ${key.padEnd(24)} → ${JSON.stringify(expectedName)}  (NOT FOUND in Lark)`
      );
    }
  }
  console.log(
    `\n${label} — ${live.length} fields live, checking ${Object.keys(expected).length} expected names`
  );
  for (const line of found) console.log(GREEN + line + RESET);
  for (const line of missing) console.log(RED + line + RESET);
  // Show fields that exist in Lark but aren't in our expected set — useful
  // for spotting newly-added fields we may want to consume.
  const expectedNames = new Set(Object.values(expected));
  const unknown = live
    .map((f) => f.fieldName)
    .filter((n) => !expectedNames.has(n));
  if (unknown.length > 0) {
    console.log(YELLOW + `\n  Live fields not yet in our schema:` + RESET);
    for (const n of unknown) console.log(YELLOW + `    • ${n}` + RESET);
  }
  return missing.length === 0;
}

let okBd = false;
let okFd = false;
try {
  okBd = await check("BD Feedback", TRACKER.tables.bdFeedback, BD_FIELDS);
  okFd = await check(
    "Feature Development",
    TRACKER.tables.featureDevelopment,
    FD_FIELDS
  );
} catch (e) {
  if (e?.name === "LarkAuthError") {
    console.log(
      `\n${YELLOW}Cannot check schema — no signed-in Lark token in .data/tokens.db.${RESET}`
    );
    console.log(
      `${YELLOW}Sign in at http://localhost:3000/auth/lark/start (with the dashboard running) and re-run.${RESET}\n`
    );
    process.exit(2);
  }
  console.log(
    `\n${RED}✗ schema check errored: ${e?.message ?? String(e)}${RESET}\n`
  );
  process.exit(3);
}

if (okBd && okFd) {
  console.log(`\n${GREEN}✓ all expected fields resolve.${RESET}\n`);
  process.exit(0);
}
console.log(
  `\n${RED}✗ schema drift detected. Update lib/lark/schemas.ts and any code that writes the renamed fields BEFORE running approve flows.${RESET}\n`
);
process.exit(1);
