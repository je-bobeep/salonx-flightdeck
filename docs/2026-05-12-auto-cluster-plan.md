# Auto-cluster on new BD/Dev rows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-cluster new BD-feedback and Feature-Development rows into themes at the end of every BD poller cycle (15-min cadence), with both BD and Dev rows treated as first-class theme members so push tickets show up under theme chips on the Roadmap.

**Architecture:** Move cluster orchestration into a new workspace package (`@flightdeck/themes-server`) so the standalone poller can import it. Widen the cluster input from BD-only to a union of BD non-Done + Dev non-shipped, tagged by source. Theme shape stays the same on the wire (`bdRecordIds`, `devRecordIds`), but `devRecordIds` semantics flip from "transitively derived from BD members' linkedDevIds" to "directly assigned by Claude during clustering." A SQLite-backed mutex (`cluster_mutex` table) prevents the poller-side cluster and the user-side `/api/data/themes` POST from racing.

**Tech Stack:** TypeScript end-to-end, pnpm workspace, better-sqlite3 for persistence, Claude CLI subprocess via `runClaudeOneShot`, Lark Bitable via existing `@flightdeck/lark` package. **No test framework in this repo** — verification is via `pnpm typecheck`, one-off `tsx` smoke scripts (existing pattern: `scripts/probe-write-scopes.mjs`), and the dashboard's live `/api/health` endpoint.

**Spec reference:** `docs/2026-05-12-auto-cluster-design.md`

---

## Phase 0 — Pre-requisite refactor: extract themes-server into a workspace package

The standalone poller (`@flightdeck/poller`) can't import from `apps/dashboard/lib/` — that's an app, not a package. Move cluster orchestration into a new workspace package so both processes can use it.

### Task 0.1: Scaffold `@flightdeck/themes-server` package

**Files:**
- Create: `lib/themes-server/package.json`
- Create: `lib/themes-server/orchestrate.ts` (placeholder, fleshed out in Task 0.2)
- Create: `lib/themes-server/fetch.ts` (placeholder, fleshed out in Task 0.3)
- Create: `lib/themes-server/tsconfig.json`

- [ ] **Step 1: Create `lib/themes-server/package.json`**

```json
{
  "name": "@flightdeck/themes-server",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": {
    "./orchestrate": "./orchestrate.ts",
    "./fetch": "./fetch.ts"
  },
  "dependencies": {
    "@flightdeck/auth": "workspace:*",
    "@flightdeck/claude": "workspace:*",
    "@flightdeck/lark": "workspace:*",
    "@flightdeck/themes": "workspace:*"
  }
}
```

- [ ] **Step 2: Create `lib/themes-server/tsconfig.json`**

Mirror the pattern from `lib/themes/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create placeholder `lib/themes-server/orchestrate.ts`**

```ts
// Cluster orchestration. Glues Lark fetch + projection + clusterBd/assignNewRows
// from @flightdeck/themes. Imported by both the dashboard route handlers and
// the BD poller's cluster step.
export {};
```

- [ ] **Step 4: Create placeholder `lib/themes-server/fetch.ts`**

```ts
// Lark fetch + projection helpers for cluster inputs. BD and Dev.
export {};
```

- [ ] **Step 5: Add workspace member to root `pnpm-workspace.yaml` if not already covered by a glob**

Check the existing file:

```bash
cat pnpm-workspace.yaml
```

If it already has `lib/*` or similar glob, no edit needed. Otherwise add `lib/themes-server` to the list.

- [ ] **Step 6: Install + typecheck**

```bash
pnpm install
pnpm typecheck
```

Expected: clean. No code uses the new package yet.

- [ ] **Step 7: Commit**

```bash
git add lib/themes-server/ pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore(themes-server): scaffold workspace package"
```

---

### Task 0.2: Relocate `themes-server.ts` into the new package

**Files:**
- Modify (full rewrite, copy from): `apps/dashboard/lib/themes-server.ts`
- Create (paste contents from above): `lib/themes-server/orchestrate.ts`

- [ ] **Step 1: Copy the full contents of `apps/dashboard/lib/themes-server.ts` into `lib/themes-server/orchestrate.ts`, then update its two relative imports**

Open `apps/dashboard/lib/themes-server.ts`, replace the contents of `lib/themes-server/orchestrate.ts` with it. The current file starts:

```ts
import { fetchAllBd, projectBd } from "./data-derive";
```

Change that to:

```ts
import { fetchAllBd, projectBd } from "./fetch";
```

Also change:

```ts
import { listRowOverrides } from "./theme-overrides-db";
import { recordProposals } from "./taxonomy-proposals-db";
```

These two helpers stay in `apps/dashboard/lib/` for now — they're SQLite-tied and not load-bearing for the orchestrate's logic. We import them in a follow-up: for now, **temporarily inline minimal stubs** at the top of `orchestrate.ts`:

```ts
// TEMP: until Task 0.4 reshuffles overrides/proposals helpers into this package.
function listRowOverrides(): Map<string, { themeId: string; themeName?: string }> {
  return new Map();
}
function recordProposals(_names: string[], _counts: Record<string, number>): void {
  // no-op until Task 0.4
}
```

(Yes, this temporarily disables overrides + proposals at the new entry point. Task 0.4 reconnects them after we've validated the relocation in isolation.)

- [ ] **Step 2: Typecheck the new file in isolation**

```bash
pnpm typecheck
```

Expected: clean. `apps/dashboard/lib/themes-server.ts` is unchanged and still works for the dashboard.

- [ ] **Step 3: Commit**

```bash
git add lib/themes-server/orchestrate.ts
git commit -m "chore(themes-server): copy orchestration logic into new package (overrides/proposals stubbed)"
```

---

### Task 0.3: Move `fetchAllBd` + `projectBd` (and the existing `fetchAllDev` + `projectDev`) into the new package

The dashboard's `data-derive.ts` is consumed by Triage/Roadmap/Linkage too — we can't move it whole. Extract just the four functions the cluster path needs into the new package and have `data-derive.ts` re-export them.

**Files:**
- Modify: `apps/dashboard/lib/data-derive.ts:50-165` (the four functions and their immediate dependencies)
- Create: `lib/themes-server/fetch.ts` (gets the four functions)

- [ ] **Step 1: Identify which helpers `fetchAllBd`/`projectBd`/`fetchAllDev`/`projectDev` need**

Read `apps/dashboard/lib/data-derive.ts:1-30` to see what's imported (`listRecords`, `RawRecord`, `TRACKER`, `BD_FIELDS`, `FD_FIELDS`, the `read*` helpers, `bdAgingSignals`, `devAgingSignals`, types `BdRow` and `DevRow`). All of these come from `@flightdeck/lark` or `./data-shapes` — both reachable from the new package (`@flightdeck/lark` is a workspace dep; for `data-shapes` we have two options).

Option A (chosen): copy the relevant type-only imports (`BdRow`, `DevRow`) from `./data-shapes` into a new `lib/themes-server/types.ts` so the new package doesn't have a back-reference into `apps/dashboard/lib/`. The wire shapes are the canonical contract; duplicating type definitions is acceptable because TypeScript will catch drift via the dashboard's continued use of the originals.

- [ ] **Step 2: Create `lib/themes-server/types.ts` with the relevant type re-exports**

```ts
// Type-only re-exports so the package doesn't depend on apps/dashboard/lib/.
// Source of truth for the wire shape stays apps/dashboard/lib/data-shapes.ts;
// any drift will be caught by the dashboard import in Task 0.5.

import type { AgingSignal } from "@flightdeck/lark/aging";

export type BdRow = {
  recordId: string;
  number: string;
  item: string;
  translate: string;
  category: string[];
  subCategory: string;
  fromPocMerchant: boolean;
  status: string;
  priority: string;
  dateCreatedMs: number | null;
  dateRecordedMs: number | null;
  ageDays: number | null;
  createdByName: string;
  hasLinkedDev: boolean;
  linkedDevIds: string[];
  hasDayOfDeploying: boolean;
  aging: AgingSignal[];
};

export type DevRow = {
  recordId: string;
  description: string;
  storyDescription: string;
  status: string;
  priority: string;
  milestone: string;
  sprint: string;
  module: string[];
  product: string[];
  requestType: string;
  customerFeedback: boolean;
  assignees: { id: string; name?: string }[];
  bdLinkIds: string[];
  eta: string;
  releaseDate: string;
  internalTargetDate: string;
  lastModifiedMs: number | null;
  aging: AgingSignal[];
};
```

- [ ] **Step 3: Replace the contents of `lib/themes-server/fetch.ts` with the four functions, copied verbatim from `apps/dashboard/lib/data-derive.ts:50-165`**

Copy `fetchAllBd`, `projectBd`, `fetchAllDev`, `projectDev` verbatim, plus their helper constants `DAY_MS`, `DATE_CREATED_AUTHORITATIVE_FROM_MS`, and the `msToIsoDate` function. Update the `BdRow`/`DevRow` imports at the top to point at the new `./types`:

```ts
import type { BdRow, DevRow } from "./types";
```

All other imports (`listRecords`, `RawRecord`, `TRACKER`, `BD_FIELDS`, etc.) come from `@flightdeck/lark` and resolve cleanly.

- [ ] **Step 4: Have `apps/dashboard/lib/data-derive.ts` re-export from the new package, dropping the duplicated bodies**

In `apps/dashboard/lib/data-derive.ts`, **remove** the four functions' bodies (and the duplicated helpers `msToIsoDate`, `DATE_CREATED_AUTHORITATIVE_FROM_MS`, `DAY_MS`), and **add** re-exports near the top:

```ts
export { fetchAllBd, projectBd, fetchAllDev, projectDev } from "@flightdeck/themes-server/fetch";
```

Leave everything else in `data-derive.ts` (the sprint-parsing helpers, the more complex consumers of these functions) untouched.

- [ ] **Step 5: Add `@flightdeck/themes-server` to `apps/dashboard/package.json`**

```bash
grep -n "@flightdeck/themes" apps/dashboard/package.json
```

Add `"@flightdeck/themes-server": "workspace:*"` to the dependencies block, alphabetically. Then:

```bash
pnpm install
```

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: clean. Any drift between the duplicated type definitions and the dashboard's `data-shapes.ts` `BdRow`/`DevRow` will manifest as a TS error here. If so, fix the type duplication by making both files structurally compatible. (They should be — we copied verbatim.)

- [ ] **Step 7: Commit**

```bash
git add lib/themes-server/ apps/dashboard/lib/data-derive.ts apps/dashboard/package.json pnpm-lock.yaml
git commit -m "chore(themes-server): relocate fetchAllBd/Dev + projectBd/Dev into package"
```

---

### Task 0.4: Move `theme-overrides-db.ts` and `taxonomy-proposals-db.ts` into the package, reconnect orchestrate

**Files:**
- Modify: `apps/dashboard/lib/theme-overrides-db.ts` (becomes a re-export)
- Modify: `apps/dashboard/lib/taxonomy-proposals-db.ts` (becomes a re-export)
- Create: `lib/themes-server/theme-overrides-db.ts`
- Create: `lib/themes-server/taxonomy-proposals-db.ts`
- Modify: `lib/themes-server/orchestrate.ts:1-20` (remove the temporary stubs, re-import)

- [ ] **Step 1: Move file contents**

Copy `apps/dashboard/lib/theme-overrides-db.ts` → `lib/themes-server/theme-overrides-db.ts` verbatim. Same for `taxonomy-proposals-db.ts`. Both already use `@flightdeck/auth/db` for their SQLite access, so no import paths change.

- [ ] **Step 2: Replace the dashboard-side files with re-exports**

`apps/dashboard/lib/theme-overrides-db.ts` becomes:

```ts
export * from "@flightdeck/themes-server/theme-overrides-db";
```

Same shape for `taxonomy-proposals-db.ts`.

- [ ] **Step 3: Add the named exports for each file to the package's `exports` field**

Update `lib/themes-server/package.json`:

```json
"exports": {
  "./orchestrate": "./orchestrate.ts",
  "./fetch": "./fetch.ts",
  "./theme-overrides-db": "./theme-overrides-db.ts",
  "./taxonomy-proposals-db": "./taxonomy-proposals-db.ts"
}
```

- [ ] **Step 4: Remove the temporary stubs from `lib/themes-server/orchestrate.ts`, restore real imports**

Replace the TEMP stub block at the top of `orchestrate.ts` with:

```ts
import { listRowOverrides } from "./theme-overrides-db";
import { recordProposals } from "./taxonomy-proposals-db";
```

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Smoke-test that the dashboard can still serve the existing themes route**

```bash
cd apps/dashboard && pnpm dev &
DEV_PID=$!
sleep 8
curl -s -m 10 http://localhost:3000/api/health | head -c 300
kill $DEV_PID 2>/dev/null
wait 2>/dev/null
```

Expected: `{"ok":true,...}` — the dashboard starts cleanly with the new imports.

- [ ] **Step 7: Commit**

```bash
git add lib/themes-server/ apps/dashboard/lib/theme-overrides-db.ts apps/dashboard/lib/taxonomy-proposals-db.ts
git commit -m "chore(themes-server): relocate overrides + proposals DB helpers"
```

---

### Task 0.5: Update dashboard route handlers to import from the new package

**Files:**
- Modify: `apps/dashboard/app/api/data/themes/route.ts`
- Modify: `apps/dashboard/app/api/data/themes/override/route.ts`
- Modify: `apps/dashboard/app/api/data/themes/proposals/route.ts`
- Modify: `apps/dashboard/app/api/data/roadmap/route.ts`
- Modify: `apps/dashboard/app/api/data/linkage/route.ts`
- Delete: `apps/dashboard/lib/themes-server.ts`

- [ ] **Step 1: Find all internal consumers of the old path**

```bash
grep -rn '"@/lib/themes-server"\|"./themes-server"\|"../themes-server"' apps/dashboard/ 2>/dev/null
```

- [ ] **Step 2: Replace each `@/lib/themes-server` import with `@flightdeck/themes-server/orchestrate`**

For each file the grep listed, update the import line. Example:

Before:
```ts
import { computeFreshThemes, computeUnavailableNow, readThemesCachedOnly } from "@/lib/themes-server";
```

After:
```ts
import { computeFreshThemes, computeUnavailableNow, readThemesCachedOnly } from "@flightdeck/themes-server/orchestrate";
```

- [ ] **Step 3: Delete the now-duplicate `apps/dashboard/lib/themes-server.ts`**

```bash
rm apps/dashboard/lib/themes-server.ts
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: clean. Any remaining stale reference manifests here.

- [ ] **Step 5: Smoke-test**

```bash
cd apps/dashboard && pnpm dev &
DEV_PID=$!
sleep 8
curl -s -m 10 http://localhost:3000/api/health | head -c 300
kill $DEV_PID 2>/dev/null
wait 2>/dev/null
```

Expected: `{"ok":true,...}`.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/
git commit -m "refactor(themes-server): route handlers import from @flightdeck/themes-server"
```

---

## Phase 1 — Widen cluster inputs to BD + Dev

### Task 1.1: Add `FeedbackInputRow` type with `source` discriminator, extend `clusterBd`/`assignNewRows` signatures

**Files:**
- Modify: `lib/themes/cluster.ts:25-46` (input type definition)

- [ ] **Step 1: Replace `BdInputRow` with a union-friendly shape**

In `lib/themes/cluster.ts:26-37`, change:

```ts
export type BdInputRow = {
  recordId: string;
  item: string;
  translate: string;
  category: string[];
  subCategory: string;
  priority: string;
  ageDays: number | null;
  linkedDevIds: string[];
  dateCreatedMs: number | null;
};
```

To:

```ts
export type FeedbackInputRow = {
  recordId: string;
  source: "bd" | "dev";
  item: string;
  translate: string;
  category: string[];
  subCategory: string;
  priority: string;
  ageDays: number | null;
  /** For BD rows: the linked Dev record ids. For Dev rows: always []. */
  linkedDevIds: string[];
  dateCreatedMs: number | null;
};

/** @deprecated alias retained until callers migrate. */
export type BdInputRow = FeedbackInputRow;
```

- [ ] **Step 2: Update `ClusterOptions.rows` and `IncrementalAssignOptions.newRows`/`rowLookup` to use the new union type**

In `lib/themes/cluster.ts:40-64`, change `BdInputRow` references to `FeedbackInputRow`. The deprecated alias keeps callers compiling.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean. All existing callers still pass BD-only rows, which now implicitly have `source: "bd"`—but the type would fail to compile because `source` is missing. So this step **will** error.

That's the signal to either (a) make `source` optional with default `"bd"` for back-compat, or (b) update callers in the same task.

**Pick (b).** Find every callsite that builds an `*InputRow` and add `source: "bd"`:

```bash
grep -rn "linkedDevIds:\|recordId:.*r.recordId" lib/themes-server/ lib/themes/ apps/dashboard/lib/ 2>/dev/null | grep -v node_modules
```

In `lib/themes-server/orchestrate.ts` `projectInputs`, add `source: "bd"` to the returned object. After this, `pnpm typecheck` should be clean.

- [ ] **Step 4: Commit**

```bash
git add lib/themes/cluster.ts lib/themes-server/orchestrate.ts
git commit -m "feat(themes): introduce FeedbackInputRow with source discriminator"
```

---

### Task 1.2: Add `projectDevForCluster` projector + extend sampling to BD ∪ Dev

**Files:**
- Modify: `lib/themes-server/orchestrate.ts:42-78` (`projectInputs`, `fetchAndSampleInputs`)
- Modify: `lib/themes-server/orchestrate.ts:267-300` (`computeIncremental` — `existingAssignedIds` set widens to BD + Dev members)

- [ ] **Step 1: Add a `projectDevForCluster` helper just above `projectInputs`**

Inside `lib/themes-server/orchestrate.ts`, add:

```ts
import type { DevRow } from "./types";
import { projectDev } from "./fetch";
// (add at top of file alongside existing imports)

function projectDevForCluster(rows: DevRow[]): FeedbackInputRow[] {
  return rows.map((r) => ({
    recordId: r.recordId,
    source: "dev" as const,
    item: r.storyDescription || r.description || "",
    translate: r.storyDescription || r.description || "",
    category: r.module,
    subCategory: "",
    priority: r.priority,
    ageDays: null, // Dev ageDays not reliable; left null so it's ignored by median calc
    linkedDevIds: [],
    dateCreatedMs: r.lastModifiedMs, // best-available signal for "rising"
  }));
}
```

Make sure `FeedbackInputRow` is imported from `@flightdeck/themes/cluster`.

- [ ] **Step 2: Widen `fetchAndSampleInputs` to fetch both tables and union them**

Replace the body of `fetchAndSampleInputs` (`lib/themes-server/orchestrate.ts:58-78`) with:

```ts
async function fetchAndSampleInputs(): Promise<FeedbackInputRow[]> {
  const [bdRaws, devRaws] = await Promise.all([fetchAllBd(), fetchAllDev()]);
  const bdRows = bdRaws.map((r) => projectBd(r));
  const devRows = devRaws.map((r) => projectDev(r));

  // BD: status != "Done"
  const bdCandidates = bdRows.filter((r) => r.status !== "Done");

  // Dev: "non-shipped" filter. Reuse the same logic as RoadmapView — see
  // apps/dashboard/components/views/RoadmapView.tsx:43 for the canonical
  // description. Rows are non-shipped when status is NOT in the terminal set
  // AND releaseDate is empty. Use whatever the existing isDevShipped helper
  // is named; if it doesn't exist, inline the predicate here.
  const TERMINAL_DEV_STATUSES = new Set(["Live", "Closed", "Released", "Done"]);
  const devCandidates = devRows.filter(
    (r) => !TERMINAL_DEV_STATUSES.has(r.status) && !r.releaseDate
  );

  // Sample priority order: unaddressed BD → push Dev (no BD link) → fill with
  // most-recent of the rest of both populations.
  const unaddressedBd = bdCandidates.filter(
    (r) => !r.hasLinkedDev && !r.hasDayOfDeploying
  );
  const pushDev = devCandidates.filter((r) => r.bdLinkIds.length === 0);

  const restBd = bdCandidates.filter(
    (r) => r.hasLinkedDev || r.hasDayOfDeploying
  );
  const pullDev = devCandidates.filter((r) => r.bdLinkIds.length > 0);
  const rest = [...restBd, ...pullDev].sort((a, b) => {
    const am =
      ("dateCreatedMs" in a ? a.dateCreatedMs : null) ??
      ("dateRecordedMs" in a ? (a as { dateRecordedMs: number | null }).dateRecordedMs : null) ??
      ("lastModifiedMs" in a ? (a as { lastModifiedMs: number | null }).lastModifiedMs : null) ??
      0;
    const bm =
      ("dateCreatedMs" in b ? b.dateCreatedMs : null) ??
      ("dateRecordedMs" in b ? (b as { dateRecordedMs: number | null }).dateRecordedMs : null) ??
      ("lastModifiedMs" in b ? (b as { lastModifiedMs: number | null }).lastModifiedMs : null) ??
      0;
    return bm - am;
  });

  const CLUSTER_MAX_ROWS_LOCAL = CLUSTER_MAX_ROWS; // reuse the existing constant
  const sampled = [...unaddressedBd, ...pushDev, ...rest].slice(
    0,
    CLUSTER_MAX_ROWS_LOCAL
  );

  // sampled is a mixed array of BdRow | DevRow. Project each by its origin.
  const bdSampled = sampled.filter((r): r is typeof bdRows[number] => "number" in r);
  const devSampled = sampled.filter((r): r is typeof devRows[number] => "storyDescription" in r);
  return [...projectInputs(bdSampled), ...projectDevForCluster(devSampled)];
}
```

The two discriminating type guards (`"number" in r` for BD, `"storyDescription" in r` for Dev) work because the `BdRow` and `DevRow` shapes have those mutually-exclusive fields. Verify by re-reading `lib/themes-server/types.ts`.

- [ ] **Step 3: Widen `computeIncremental`'s `existingAssignedIds` set**

In `lib/themes-server/orchestrate.ts:280-284`, the loop currently is:

```ts
for (const t of prevBlob.themes) {
  for (const id of t.bdRecordIds) existingAssignedIds.add(id);
}
```

Add Dev members:

```ts
for (const t of prevBlob.themes) {
  for (const id of t.bdRecordIds) existingAssignedIds.add(id);
  for (const id of t.devRecordIds) existingAssignedIds.add(id);
}
```

- [ ] **Step 4: Confirm `TERMINAL_DEV_STATUSES` matches actual Lark Base data**

```bash
grep -rn "Live\|Closed\|Released\|status === " apps/dashboard/lib/data-derive.ts apps/dashboard/components/views/RoadmapView.tsx 2>/dev/null | head
```

If the existing roadmap code uses different terminal strings, adjust the `TERMINAL_DEV_STATUSES` set accordingly. The exact strings are determined by the SingleSelect options in the Feature Development `Status` field on Lark — verify against `memory/reference_lark_base.md` if uncertain.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Smoke-test the cluster prompt input shape by writing a small probe script**

Create `scripts/probe-cluster-inputs.mjs` (mirrors `scripts/probe-write-scopes.mjs` pattern):

```js
#!/usr/bin/env node
import { fetchAllBd, projectBd, fetchAllDev, projectDev } from "@flightdeck/themes-server/fetch";

const bd = await fetchAllBd();
const dev = await fetchAllDev();
console.log(`BD rows: ${bd.length}`);
console.log(`Dev rows: ${dev.length}`);
const projectedBd = bd.slice(0, 3).map(projectBd);
const projectedDev = dev.slice(0, 3).map(projectDev);
console.log("Sample BD:", JSON.stringify(projectedBd[0], null, 2).slice(0, 400));
console.log("Sample Dev:", JSON.stringify(projectedDev[0], null, 2).slice(0, 400));
```

Run:

```bash
cd apps/dashboard && pnpm exec tsx ../../scripts/probe-cluster-inputs.mjs
```

Expected: non-zero BD and Dev counts, structured projection output. (This requires a valid session in `.data/tokens.db`; run via the dashboard sign-in flow first.)

- [ ] **Step 7: Commit**

```bash
git add lib/themes-server/orchestrate.ts scripts/probe-cluster-inputs.mjs
git commit -m "feat(themes-server): widen cluster inputs to BD ∪ Dev"
```

---

## Phase 2 — Update cluster prompts and post-parse validation

### Task 2.1: Update `clusterBdSystemPrompt` and `assignBdSystemPrompt` for source field + devRecordIds output

**Files:**
- Modify: `lib/themes/prompts/cluster-bd.ts:42-148`

- [ ] **Step 1: Update the `clusterBdSystemPrompt` lead, input description, and output schema**

In `lib/themes/prompts/cluster-bd.ts:50`, change the lead sentence and the INPUT and OUTPUT sections. Replace lines 50-85 (the body of `clusterBdSystemPrompt`'s return) with:

```ts
return `You cluster product-feedback signals from a SalonX intake log into a small set of THEMES.

Each signal is either:
  - a BD-feedback request from a merchant (source = "bd"), or
  - a Feature Development ticket from engineering (source = "dev").

A theme is a coherent user-facing CONCERN. Examples: "Timezone correctness", "WhatsApp delivery", "Split-bill UX", "Staff scheduling conflicts". A theme is NOT a category like "Bug" or "Enhancement" — those are too coarse. Group by underlying concern, NOT by source: a BD complaint about mobile calendar slowness and a Dev ticket titled "Make calendar mobile-responsive" belong in the same theme.

CANDIDATE_THEMES
You MUST prefer choosing names from the list below. Emit a brand-new name ONLY when no candidate fits. Total themes 5–15. The number of brand-new (non-candidate) names is capped at ${MAX_NEW_THEMES_PER_RUN} per run. Going over the cap will cause your response to be rejected.

${renderCandidateList()}

INPUT
The user message contains a JSON array of feedback signals. Each row has:
  { record_id, source, item, translate, category, subCategory, priority, ageDays }
where source is "bd" or "dev".

OUTPUT
Return ONLY valid JSON in this exact shape (no prose, no markdown fences):
{
  "themes": [
    {
      "name": "<short label, ≤ 4 words, Title Case — prefer a CANDIDATE_THEMES name>",
      "description": "<one sentence explaining what unifies these signals>",
      "bdRecordIds": ["rec...", "rec..."],
      "devRecordIds": ["rec...", "rec..."],
      "dominantCategories": ["<top 1–2 from member rows>"],
      "dominantSubCategories": ["<top 1–2 from member rows>"]
    }
  ]
}

CONSTRAINTS
- 5 to 15 themes total. If the input is small (<10 rows), fewer is fine but at least 2 distinct themes.
- Every input record_id (BD or Dev) must appear in exactly ONE theme. No duplicates across themes, no omissions.
- BD record_ids go in bdRecordIds; Dev record_ids go in devRecordIds. NEVER put a "bd"-source record in devRecordIds or vice versa.
- Theme names: ≤ 4 words, Title Case, no trailing punctuation.
- Description: 1 short sentence (≤ 20 words).
- Group by underlying CONCERN, not surface phrasing — translate into the same theme even if rows are in different languages.
- Brand-new (non-candidate) names: at most ${MAX_NEW_THEMES_PER_RUN} per response.${strictFooter}

DO NOT include any commentary, reasoning, or markdown. Output JUST the JSON object.`;
```

- [ ] **Step 2: Update `assignBdSystemPrompt` similarly**

In `lib/themes/prompts/cluster-bd.ts:101-148`, the assign prompt needs:

1. Reframed lead: "You assign NEW product-feedback signals to an EXISTING set of themes…"
2. Input row shape gains `source`.
3. Output `newThemes[]` entries gain a `members` array with source-tagged ids, replacing the old `bdRecordIds`-only field.

Replace the body of `assignBdSystemPrompt` with:

```ts
return `You assign NEW product-feedback signals to an EXISTING set of themes. Existing assignments are STICKY — never reshuffle them. Prefer assignment to an existing theme over creating a new one.

Each new signal is either source = "bd" (BD-feedback request from a merchant) or source = "dev" (Feature Development ticket from engineering). Source has no bearing on grouping — group by underlying concern.

EXISTING THEMES (use these theme_ids verbatim when assigning):
${catalog}

CANDIDATE_THEMES (reference vocabulary)
When you must mint a new theme (cap: ${MAX_NEW_THEMES_PER_RUN}/call), prefer names from the curated list below. Existing themes that match a candidate take precedence.

${renderCandidateList()}

INPUT: a JSON array of new signals: [{ record_id, source, item, translate, category, subCategory, priority, ageDays }]

OUTPUT: strict JSON of this exact shape (no markdown, no prose):
{
  "assignments": [
    { "record_id": "rec...", "source": "bd" | "dev", "theme_id": "<existing theme_id>" }
  ],
  "newThemes": [
    {
      "tempId": "new-1",
      "name": "<short Title Case label, ≤ 4 words — prefer a CANDIDATE_THEMES name>",
      "description": "<one sentence, ≤ 20 words>",
      "members": [ { "id": "rec...", "source": "bd" | "dev" } ]
    }
  ]
}

CONSTRAINTS
- Every input record_id appears in EXACTLY ONE place: either an "assignments" entry pointing at an existing theme_id, or in a newTheme.members array.
- Cap newThemes at ${MAX_NEW_THEMES_PER_RUN} per call. Force-fit a row into an existing theme unless truly no theme is a fit.
- New theme names: ≤ 4 words, Title Case, distinct from any existing theme name.
- Group by underlying CONCERN, not by category labels like "Bug" or "Enhancement".${strictFooter}

Output JUST the JSON object.`;
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean (the prompts are just strings; the type changes from Task 1.1 already landed).

- [ ] **Step 4: Commit**

```bash
git add lib/themes/prompts/cluster-bd.ts
git commit -m "feat(themes): widen cluster prompts to BD + Dev sources"
```

---

### Task 2.2: Update `parseClaudeThemes` to read `devRecordIds`, dedup across themes, and validate source

**Files:**
- Modify: `lib/themes/cluster.ts:90-100` (output type)
- Modify: `lib/themes/cluster.ts:108-190` (`parseClaudeThemes`)

- [ ] **Step 1: Update `ClaudeOutput` type to include `devRecordIds`**

In `lib/themes/cluster.ts:92-100`, change:

```ts
type ClaudeOutput = {
  themes?: {
    name?: unknown;
    description?: unknown;
    bdRecordIds?: unknown;
    dominantCategories?: unknown;
    dominantSubCategories?: unknown;
  }[];
};
```

To:

```ts
type ClaudeOutput = {
  themes?: {
    name?: unknown;
    description?: unknown;
    bdRecordIds?: unknown;
    devRecordIds?: unknown;
    dominantCategories?: unknown;
    dominantSubCategories?: unknown;
  }[];
};
```

- [ ] **Step 2: Update `parseClaudeThemes` to read both id lists and enforce cross-theme uniqueness**

The signature today is `parseClaudeThemes(out, byId: Map<string, BdInputRow>, ...)`. After Task 1.1, `BdInputRow` is an alias for `FeedbackInputRow` and compiles fine, but for clarity, change the parameter type explicitly to `Map<string, FeedbackInputRow>` in the new body below.

Replace `parseClaudeThemes` (the function from line 109 to its end at ~line 190) with the following version. The changes vs. existing:

1. Signature parameter type changes to `Map<string, FeedbackInputRow>`.
2. Split `byId` lookups by source (we know which ids are BD and which are Dev from the input).
3. Read `devRecordIds` from Claude's output and validate them against the Dev-id Set.
4. Maintain a `seenAcrossThemes` Set so a record_id that appears in two themes only stays in the first one encountered.
5. Recompute `devRecordIds` directly from Claude's output (no longer derived from `linkedDevIds`).

```ts
function parseClaudeThemes(
  out: ClaudeOutput,
  byId: Map<string, FeedbackInputRow>,
  previousThemes: ClusterOptions["previousThemes"]
): Theme[] | null {
  if (!Array.isArray(out.themes)) {
    console.warn(
      "[themes/cluster] Claude JSON missing 'themes' array. keys=%s",
      Object.keys(out).join(",")
    );
    return null;
  }

  const validBdIds = new Set<string>();
  const validDevIds = new Set<string>();
  for (const [id, row] of byId) {
    if (row.source === "bd") validBdIds.add(id);
    else validDevIds.add(id);
  }

  const seenAcrossThemes = new Set<string>();
  const now = Date.now();
  const themes: Theme[] = [];

  for (const raw of out.themes) {
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const description =
      typeof raw.description === "string" ? raw.description.trim() : "";

    const bdRecordIdsRaw = Array.isArray(raw.bdRecordIds)
      ? raw.bdRecordIds.filter(
          (s): s is string =>
            typeof s === "string" && validBdIds.has(s) && !seenAcrossThemes.has(s)
        )
      : [];
    const devRecordIdsRaw = Array.isArray(raw.devRecordIds)
      ? raw.devRecordIds.filter(
          (s): s is string =>
            typeof s === "string" && validDevIds.has(s) && !seenAcrossThemes.has(s)
        )
      : [];

    const dominantCategories = Array.isArray(raw.dominantCategories)
      ? raw.dominantCategories.filter((s): s is string => typeof s === "string")
      : [];
    const dominantSubCategories = Array.isArray(raw.dominantSubCategories)
      ? raw.dominantSubCategories.filter(
          (s): s is string => typeof s === "string"
        )
      : [];

    if (!name || (bdRecordIdsRaw.length === 0 && devRecordIdsRaw.length === 0)) {
      continue;
    }

    const bdRecordIds = [...new Set(bdRecordIdsRaw)];
    const devRecordIds = [...new Set(devRecordIdsRaw)];
    for (const id of bdRecordIds) seenAcrossThemes.add(id);
    for (const id of devRecordIds) seenAcrossThemes.add(id);

    // Median age days: BD only (Dev ageDays not reliable).
    const ages = bdRecordIds
      .map((id) => byId.get(id)?.ageDays)
      .filter((v): v is number => typeof v === "number")
      .sort((a, b) => a - b);
    const bdMedianAgeDays =
      ages.length === 0 ? null : ages[Math.floor(ages.length / 2)];

    // Rising: ≥3 BD-or-Dev members with dateCreatedMs in the last 14 days.
    const allMemberIds = [...bdRecordIds, ...devRecordIds];
    const newCount = allMemberIds.reduce((acc, id) => {
      const ms = byId.get(id)?.dateCreatedMs;
      if (typeof ms === "number" && now - ms < 14 * DAY_MS) return acc + 1;
      return acc;
    }, 0);
    const rising = newCount >= 3;

    const id = pickStableId(
      [...bdRecordIds, ...devRecordIds],
      name,
      previousThemes
    );

    themes.push({
      id,
      name,
      description,
      bdRecordIds,
      devRecordIds,
      dominantCategories: dedup(dominantCategories).slice(0, 2),
      dominantSubCategories: dedup(dominantSubCategories).slice(0, 2),
      bdVolume: bdRecordIds.length,
      bdMedianAgeDays,
      rising,
    });
  }

  return themes;
}
```

Note: `pickStableId` now receives the combined member list — slug-only candidate names continue to use `slugify(name)` directly so their id is independent of member set. Ad-hoc names' 70%-overlap heuristic now compares against the union (BD + Dev) of the previous theme's members vs. the new theme's members. This is intentional — it stabilises ids correctly through the BD-only → BD+Dev transition.

- [ ] **Step 3: Update `pickStableId` to take the union member list**

`pickStableId` signature already takes `string[]` for `bdRecordIds`; no signature change needed. The body uses set membership which works fine with union ids — the overlap heuristic at `cluster.ts:485-501` operates over whatever string array it gets.

For safety, audit the call from `parseClaudeThemes` is now passing `[...bdRecordIds, ...devRecordIds]` and the `previousThemes` parameter still passes `bdRecordIds` from the prior blob. For the first cluster run after this lands, the previous blob's `bdRecordIds` won't overlap with the new themes' `devRecordIds` (Dev ids weren't in the old structure that way), so the heuristic naturally falls back to "no overlap → mint new id." This is correct — the union substrate is a new clustering universe.

For subsequent runs (after the first new-shape blob lands), the heuristic compares unions to unions. Also correct.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/themes/cluster.ts
git commit -m "feat(themes): parse devRecordIds + enforce cross-theme uniqueness in from-scratch path"
```

---

### Task 2.3: Update `parseAssignOutput` to handle source-tagged assignments and `members[]` in newThemes

**Files:**
- Modify: `lib/themes/cluster.ts:65-90` (`AssignClaudeOutput` type + `IncrementalAssignResult.newThemes` shape)
- Modify: `lib/themes/cluster.ts:299-340` (`parseAssignOutput`)
- Modify: `lib/themes/cluster.ts:350-462` (`assignNewRows`)
- Modify: `lib/themes-server/orchestrate.ts:340-405` (`computeIncremental`'s merge step)

- [ ] **Step 1: Update `AssignClaudeOutput` and `IncrementalAssignResult.newThemes`**

In `lib/themes/cluster.ts:66-90`, change:

```ts
type AssignClaudeOutput = {
  assignments?: { record_id?: unknown; theme_id?: unknown }[];
  newThemes?: {
    tempId?: unknown;
    name?: unknown;
    description?: unknown;
    bdRecordIds?: unknown;
  }[];
};

export type IncrementalAssignResult = {
  additions: Map<string, string[]>;
  newThemes: Array<{
    tempId: string;
    name: string;
    description: string;
    bdRecordIds: string[];
  }>;
  unplaced: string[];
};
```

To:

```ts
type AssignClaudeOutput = {
  assignments?: { record_id?: unknown; source?: unknown; theme_id?: unknown }[];
  newThemes?: {
    tempId?: unknown;
    name?: unknown;
    description?: unknown;
    members?: unknown;
  }[];
};

export type IncrementalAssignResult = {
  /** existing-theme membership additions, separated by source.
   *  Maps theme_id -> { bd: [...], dev: [...] }. */
  additions: Map<string, { bd: string[]; dev: string[] }>;
  newThemes: Array<{
    tempId: string;
    name: string;
    description: string;
    bdMembers: string[];
    devMembers: string[];
  }>;
  unplaced: string[];
};
```

- [ ] **Step 2: Rewrite `parseAssignOutput` to honour the new shape**

Replace the function body (lines ~300-340) with:

```ts
function parseAssignOutput(
  out: AssignClaudeOutput,
  validBdIds: Set<string>,
  validDevIds: Set<string>,
  validThemeIds: Set<string>
): IncrementalAssignResult {
  const placed = new Set<string>();
  const additions = new Map<string, { bd: string[]; dev: string[] }>();

  for (const a of out.assignments ?? []) {
    const recordId = typeof a.record_id === "string" ? a.record_id : null;
    const source = a.source === "dev" ? "dev" : a.source === "bd" ? "bd" : null;
    const themeId = typeof a.theme_id === "string" ? a.theme_id : null;
    if (!recordId || !themeId || !source) continue;
    if (source === "bd" && !validBdIds.has(recordId)) continue;
    if (source === "dev" && !validDevIds.has(recordId)) continue;
    if (!validThemeIds.has(themeId)) continue;
    if (placed.has(recordId)) continue;
    placed.add(recordId);
    const slot = additions.get(themeId) ?? { bd: [], dev: [] };
    if (source === "bd") slot.bd.push(recordId);
    else slot.dev.push(recordId);
    additions.set(themeId, slot);
  }

  const newThemes: IncrementalAssignResult["newThemes"] = [];
  for (const raw of out.newThemes ?? []) {
    const tempId = typeof raw.tempId === "string" ? raw.tempId : "";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const description =
      typeof raw.description === "string" ? raw.description.trim() : "";
    const members = Array.isArray(raw.members) ? raw.members : [];

    const bdMembers: string[] = [];
    const devMembers: string[] = [];
    for (const m of members) {
      if (!m || typeof m !== "object") continue;
      const mObj = m as { id?: unknown; source?: unknown };
      const id = typeof mObj.id === "string" ? mObj.id : null;
      const src = mObj.source === "dev" ? "dev" : mObj.source === "bd" ? "bd" : null;
      if (!id || !src) continue;
      if (placed.has(id)) continue;
      if (src === "bd" && !validBdIds.has(id)) continue;
      if (src === "dev" && !validDevIds.has(id)) continue;
      placed.add(id);
      if (src === "bd") bdMembers.push(id);
      else devMembers.push(id);
    }

    if (!name || (bdMembers.length === 0 && devMembers.length === 0)) continue;
    newThemes.push({
      tempId,
      name,
      description,
      bdMembers: [...new Set(bdMembers)],
      devMembers: [...new Set(devMembers)],
    });
  }

  const allValid = new Set<string>([...validBdIds, ...validDevIds]);
  const unplaced = [...allValid].filter((id) => !placed.has(id));
  return { additions, newThemes, unplaced };
}
```

- [ ] **Step 3: Update `assignNewRows`'s `validRecordIds` building and `runOnce` to feed the new validator signature**

In `lib/themes/cluster.ts:399-400`, replace:

```ts
const validRecordIds = new Set(opts.newRows.map((r) => r.recordId));
```

With:

```ts
const validBdIds = new Set(opts.newRows.filter((r) => r.source === "bd").map((r) => r.recordId));
const validDevIds = new Set(opts.newRows.filter((r) => r.source === "dev").map((r) => r.recordId));
```

And in the inner `runOnce` function (around line 420), change:

```ts
return parseAssignOutput(
  result.json as AssignClaudeOutput,
  validRecordIds,
  validThemeIds
);
```

To:

```ts
return parseAssignOutput(
  result.json as AssignClaudeOutput,
  validBdIds,
  validDevIds,
  validThemeIds
);
```

- [ ] **Step 4: Update `computeIncremental` to consume the new `additions` shape and `bdMembers`/`devMembers`**

In `lib/themes-server/orchestrate.ts`, update the merge step (currently iterating `additions.entries()` and pushing onto `target.bdRecordIds`). Find the block:

```ts
for (const [themeId, ids] of assignResult.additions) {
  const target = themeIndex.get(themeId);
  if (!target) continue;
  for (const id of ids) {
    if (!target.bdRecordIds.includes(id)) target.bdRecordIds.push(id);
  }
}
```

Replace with:

```ts
for (const [themeId, slot] of assignResult.additions) {
  const target = themeIndex.get(themeId);
  if (!target) continue;
  for (const id of slot.bd) {
    if (!target.bdRecordIds.includes(id)) target.bdRecordIds.push(id);
  }
  for (const id of slot.dev) {
    if (!target.devRecordIds.includes(id)) target.devRecordIds.push(id);
  }
}
```

Then update the new-theme minting block (currently uses `nt.bdRecordIds`). Find:

```ts
for (const nt of assignResult.newThemes) {
  const slug = slugify(nt.name);
  const collision = existingNameSlugs.get(slug);
  if (collision) {
    const target = themeIndex.get(collision);
    if (target) {
      for (const id of nt.bdRecordIds) {
        if (!target.bdRecordIds.includes(id)) target.bdRecordIds.push(id);
      }
    }
    continue;
  }
  const newTheme: Theme = {
    id: `${slug}-${shortHash(nt.bdRecordIds)}`,
    name: nt.name,
    description: nt.description,
    bdRecordIds: [...new Set(nt.bdRecordIds)],
    devRecordIds: [],
    ...
  };
  ...
}
```

Replace with:

```ts
for (const nt of assignResult.newThemes) {
  const slug = slugify(nt.name);
  const collision = existingNameSlugs.get(slug);
  if (collision) {
    const target = themeIndex.get(collision);
    if (target) {
      for (const id of nt.bdMembers) {
        if (!target.bdRecordIds.includes(id)) target.bdRecordIds.push(id);
      }
      for (const id of nt.devMembers) {
        if (!target.devRecordIds.includes(id)) target.devRecordIds.push(id);
      }
    }
    continue;
  }
  const newTheme: Theme = {
    id: `${slug}-${shortHash([...nt.bdMembers, ...nt.devMembers])}`,
    name: nt.name,
    description: nt.description,
    bdRecordIds: [...new Set(nt.bdMembers)],
    devRecordIds: [...new Set(nt.devMembers)],
    dominantCategories: [],
    dominantSubCategories: [],
    bdVolume: 0,
    bdMedianAgeDays: null,
    rising: false,
  };
  merged.push(newTheme);
  themeIndex.set(newTheme.id, newTheme);
  existingNameSlugs.set(slug, newTheme.id);
  mintedThemeCount += 1;
}
```

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/themes/cluster.ts lib/themes-server/orchestrate.ts
git commit -m "feat(themes): source-tagged assignments + members[] in newThemes"
```

---

### Task 2.4: Update `recomputeMetrics` to consider Dev members for `rising` and `devRecordIds` retention

**Files:**
- Modify: `lib/themes-server/orchestrate.ts:128-155` (`recomputeMetrics`)

- [ ] **Step 1: Rewrite `recomputeMetrics` to handle both sources**

Find `recomputeMetrics` in `lib/themes-server/orchestrate.ts:128-155`. Replace its body:

```ts
function recomputeMetrics(themes: Theme[], byId: Map<string, FeedbackInputRow>): Theme[] {
  const now = Date.now();
  return themes.map((t) => {
    const bdMembers = t.bdRecordIds
      .map((id) => byId.get(id))
      .filter((r): r is FeedbackInputRow => !!r && r.source === "bd");
    const devMembers = t.devRecordIds
      .map((id) => byId.get(id))
      .filter((r): r is FeedbackInputRow => !!r && r.source === "dev");

    // Median age: BD only.
    const ages = bdMembers
      .map((r) => r.ageDays)
      .filter((v): v is number => typeof v === "number")
      .sort((a, b) => a - b);

    // Rising: ≥3 BD-or-Dev members with dateCreatedMs in last 14 days.
    const newCount = [...bdMembers, ...devMembers].reduce((acc, r) => {
      if (typeof r.dateCreatedMs === "number" && now - r.dateCreatedMs < 14 * DAY_MS)
        return acc + 1;
      return acc;
    }, 0);

    return {
      ...t,
      bdRecordIds: bdMembers.map((r) => r.recordId),
      devRecordIds: devMembers.map((r) => r.recordId),
      bdVolume: bdMembers.length,
      bdMedianAgeDays:
        ages.length === 0 ? null : ages[Math.floor(ages.length / 2)],
      rising: newCount >= 3,
    };
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/themes-server/orchestrate.ts
git commit -m "feat(themes-server): recompute rising over BD ∪ Dev members"
```

---

### Task 2.5: Update `applyRowOverrides` to leave Dev members untouched (BD-only for now)

The `theme_row_overrides` table is BD-keyed today. Out of scope for this milestone to extend it. Just make sure Dev members on a theme aren't stripped when overrides apply.

**Files:**
- Modify: `lib/themes-server/orchestrate.ts:168-209` (`applyRowOverrides`)

- [ ] **Step 1: Inspect the function and confirm Dev members are already untouched**

Read `applyRowOverrides`. It stripes `bdRecordIds.filter((id) => !overrideIds.has(id))` and re-adds the overridden id to the target theme's `bdRecordIds`. Dev members are never touched. No code change needed; verify by re-reading.

- [ ] **Step 2: Add a clarifying comment to the top of the function**

```ts
/**
 * ...existing JSDoc...
 *
 * Dev members on each theme are not touched here — overrides are BD-keyed
 * only. Dev re-assignment would require extending the theme_row_overrides
 * schema; deliberately out of scope.
 */
```

- [ ] **Step 3: Commit**

```bash
git add lib/themes-server/orchestrate.ts
git commit -m "docs(themes-server): clarify overrides are BD-only"
```

---

## Phase 3 — SQLite migrations and KILLSWITCH

### Task 3.1: Add `cluster_mutex` table + `last_cluster_*` columns on `poller_state`

**Files:**
- Modify: `lib/auth/db.ts` (schema migration function)
- Modify: `lib/services/lark-poller/state.ts:1-30` (extend `getPollerState` return shape + upsert signature)

- [ ] **Step 1: Find the existing migration runner in `lib/auth/db.ts`**

```bash
grep -n "CREATE TABLE\|ALTER TABLE\|PRAGMA table_info" lib/auth/db.ts | head -30
```

Find the function that runs `CREATE TABLE IF NOT EXISTS` statements at module load (or via `initSchema()` if there's an explicit init). Append the new schema there.

- [ ] **Step 2: Append the new table + column migrations**

Add to the schema init block:

```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS cluster_mutex (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    holder TEXT NOT NULL,
    acquired_at INTEGER NOT NULL
  );
`);

// Idempotent column additions on poller_state. SQLite ALTER TABLE ADD COLUMN
// errors if the column exists, so guard with PRAGMA table_info.
const pollerCols = db.prepare("PRAGMA table_info(poller_state)").all() as Array<{ name: string }>;
const pollerColNames = new Set(pollerCols.map((c) => c.name));
if (!pollerColNames.has("last_cluster_at")) {
  db.exec("ALTER TABLE poller_state ADD COLUMN last_cluster_at INTEGER");
}
if (!pollerColNames.has("last_cluster_error")) {
  db.exec("ALTER TABLE poller_state ADD COLUMN last_cluster_error TEXT");
}
if (!pollerColNames.has("last_cluster_mode")) {
  db.exec("ALTER TABLE poller_state ADD COLUMN last_cluster_mode TEXT");
}
```

- [ ] **Step 3: Extend `getPollerState` and `upsertPollerState` in `lib/services/lark-poller/state.ts`**

Open `state.ts` and:

1. Add the three new fields to the `PollerState` type (or whatever the return shape is named — read the file to confirm).
2. Update the `getPollerState` SQL to select the three new columns.
3. Add a new `updateClusterState(chatId, mode, error)` function that does a targeted UPDATE rather than expanding the existing `upsertPollerState` signature.

```ts
export function updateClusterState(args: {
  chatId: string;
  mode: string;
  error: string | null;
}): void {
  const db = getDb();
  db.prepare(
    "UPDATE poller_state SET last_cluster_at = ?, last_cluster_mode = ?, last_cluster_error = ? WHERE chat_id = ?"
  ).run(Date.now(), args.mode, args.error, args.chatId);
}
```

Export it from the package.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 5: Run the migration locally to verify it lands**

```bash
sqlite3 .data/tokens.db ".schema cluster_mutex"
```

Expected: empty (table not yet created — migration runs at next process start).

Trigger the migration by booting the dashboard once:

```bash
cd apps/dashboard && pnpm dev &
DEV_PID=$!
sleep 5
kill $DEV_PID 2>/dev/null
wait 2>/dev/null
```

Then verify:

```bash
sqlite3 .data/tokens.db ".schema cluster_mutex"
sqlite3 .data/tokens.db "PRAGMA table_info(poller_state)"
```

Expected: `cluster_mutex` table present; `poller_state` has the three new columns.

- [ ] **Step 6: Commit**

```bash
git add lib/auth/db.ts lib/services/lark-poller/state.ts
git commit -m "feat(db): add cluster_mutex table + last_cluster_* columns on poller_state"
```

---

### Task 3.2: Implement `acquireClusterMutex` / `releaseClusterMutex`

**Files:**
- Modify: `lib/auth/db.ts` (add the two functions and re-export them)
- Or: add a small new file `lib/auth/cluster-mutex.ts` to keep concerns separate

- [ ] **Step 1: Add the helpers in `lib/auth/cluster-mutex.ts`**

Create `lib/auth/cluster-mutex.ts`:

```ts
import { getDb } from "./db";

const STALE_AGE_MS = 10 * 60 * 1000; // 10 min — comfortably exceeds 5-min cluster timeout

/**
 * Try to acquire the cluster mutex. Returns true on success, false if held by
 * another holder. Auto-overrides a "stale" lock older than STALE_AGE_MS — the
 * holder probably crashed.
 */
export function acquireClusterMutex(holder: "poller" | "user"): boolean {
  const db = getDb();
  const now = Date.now();
  const existing = db
    .prepare("SELECT holder, acquired_at FROM cluster_mutex WHERE id = 1")
    .get() as { holder: string; acquired_at: number } | undefined;

  if (existing) {
    if (now - existing.acquired_at < STALE_AGE_MS) return false;
    console.warn(
      "[cluster-mutex] overriding stale lock held by %s since %s",
      existing.holder,
      new Date(existing.acquired_at).toISOString()
    );
  }

  db.prepare(
    "INSERT INTO cluster_mutex (id, holder, acquired_at) VALUES (1, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET holder = excluded.holder, acquired_at = excluded.acquired_at"
  ).run(holder, now);

  return true;
}

export function releaseClusterMutex(): void {
  const db = getDb();
  db.prepare("DELETE FROM cluster_mutex WHERE id = 1").run();
}
```

- [ ] **Step 2: Export from `@flightdeck/auth`**

In `lib/auth/package.json`, add to `exports`:

```json
"./cluster-mutex": "./cluster-mutex.ts"
```

(If the package doesn't currently use `exports`, follow the existing pattern in that file.)

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add lib/auth/cluster-mutex.ts lib/auth/package.json
git commit -m "feat(auth): cluster_mutex acquire/release helpers"
```

---

### Task 3.3: Add the `auto-cluster` KILLSWITCH row + reader helper

**Files:**
- Modify: `KILLSWITCH.md` (add row)
- Create: `lib/services/lark-poller/killswitch.ts` (generalised reader)

- [ ] **Step 1: Add the row to KILLSWITCH.md**

Open `KILLSWITCH.md`. The existing table has columns `Workflow | Trigger | Home repo | Status | Last run | Notes`. Add this row beneath `lark-bd-poller`:

```
| `auto-cluster` | After every successful lark-bd-poller cycle | salonx-flightdeck | enabled | — | Fires computeFreshThemes() at the end of each successful BD poller cycle. Reads BD + Dev rows, clusters new arrivals into existing themes (or mints up to 2 brand-new themes per call, drift-promotes to from-scratch when prior incremental minted any). Disable here to make the next cycle skip the cluster step without touching BD ingestion. |
```

- [ ] **Step 2: Generalise the KILLSWITCH reader**

`lib/services/lark-poller/poll.ts:79-100` has `isPollerEnabled(workflowName)`-style logic but the function is hard-coded to `lark-bd-poller`. Extract a reusable helper into a new file `lib/services/lark-poller/killswitch.ts`:

```ts
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
```

- [ ] **Step 3: Update `lib/services/lark-poller/poll.ts:79-100` to use the new helper**

Replace `isPollerEnabled` (lines 79-100) with:

```ts
import { isWorkflowEnabled } from "./killswitch";
// ...
const ks = isWorkflowEnabled("lark-bd-poller");
```

Remove the now-redundant `KILLSWITCH_PATH` constant from `poll.ts`.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add KILLSWITCH.md lib/services/lark-poller/killswitch.ts lib/services/lark-poller/poll.ts
git commit -m "feat(poller): generalise KILLSWITCH reader + add auto-cluster row"
```

---

## Phase 4 — Cluster step in the poller

### Task 4.1: Implement `runClusterStep` in the poller

**Files:**
- Create: `lib/services/lark-poller/cluster-step.ts`
- Modify: `lib/services/lark-poller/package.json` (add `@flightdeck/themes-server` dep)

- [ ] **Step 1: Add the package dependency**

Edit `lib/services/lark-poller/package.json`, add to `dependencies`:

```json
"@flightdeck/themes-server": "workspace:*"
```

Then:

```bash
pnpm install
```

- [ ] **Step 2: Create `lib/services/lark-poller/cluster-step.ts`**

```ts
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
```

- [ ] **Step 3: Add `./cluster-step` to the poller package exports**

In `lib/services/lark-poller/package.json`:

```json
"exports": {
  "./poll": "./poll.ts",
  "./classify": "./classify.ts",
  "./state": "./state.ts",
  "./config": "./config.ts",
  "./cluster-step": "./cluster-step.ts",
  "./killswitch": "./killswitch.ts"
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/services/lark-poller/cluster-step.ts lib/services/lark-poller/package.json
git commit -m "feat(poller): runClusterStep — KILLSWITCH + mutex + computeFreshThemes"
```

---

### Task 4.2: Wire `runClusterStep` into `run.ts` after each successful poll cycle

**Files:**
- Modify: `lib/services/lark-poller/run.ts:19-23` (extend `runOnce` to call cluster step)

- [ ] **Step 1: Update `runOnce` in `run.ts`**

Replace:

```ts
async function runOnce() {
  const summary = await pollOnce({ log: tsLog });
  tsLog(
    `[poller] done — fetched=${summary.fetched} ingested=${summary.ingested} skipped=${summary.skipped} failed=${summary.failed} (${summary.finishedAt - summary.startedAt}ms)`
  );
}
```

With:

```ts
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
```

Add the import at the top:

```ts
import { runClusterStep } from "./cluster-step";
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Smoke-test locally (single cycle)**

```bash
pnpm --filter @flightdeck/poller once 2>&1 | tail -40
```

Expected stdout lines:
- `[poller] chat=oc_545d... since=...`
- `[poller] fetched 0 message(s)` (or however many)
- `[poller] done — fetched=...`
- `[poller-cluster] ok themes=N mode=claude newThemes=Y` (or `disabled` / `skipped` / `unavailable`)
- `[poller] cluster done — mode=...`

Verify cluster step actually ran:

```bash
sqlite3 .data/tokens.db "SELECT chat_id, last_cluster_at, last_cluster_mode, last_cluster_error FROM poller_state"
```

Expected: `last_cluster_at` is recent (within seconds), `last_cluster_mode` is `claude` or `disabled`/`skipped`.

- [ ] **Step 4: Commit**

```bash
git add lib/services/lark-poller/run.ts
git commit -m "feat(poller): run cluster step after each poll cycle"
```

---

### Task 4.3: Have the dashboard's POST `/api/data/themes` route also acquire the mutex

**Files:**
- Modify: `apps/dashboard/app/api/data/themes/route.ts:48-108` (POST handler)

- [ ] **Step 1: Wrap the `computeFreshThemes` call in the route handler with the mutex**

In `apps/dashboard/app/api/data/themes/route.ts`, locate the POST handler's try block (around line 99-108). Replace:

```ts
try {
  const fresh = await computeFreshThemes({ mode });
  return NextResponse.json({ ok: true, ...fresh });
} catch (e) {
  return NextResponse.json(
    { ok: false, error: e instanceof Error ? e.message : String(e) },
    { status: 500 }
  );
}
```

With:

```ts
if (!acquireClusterMutex("user")) {
  return NextResponse.json(
    {
      ok: false,
      error: "Clustering already in progress (poller-side run). Try again in a moment.",
    },
    { status: 409, headers: { "retry-after": "30" } }
  );
}

try {
  const fresh = await computeFreshThemes({ mode });
  return NextResponse.json({ ok: true, ...fresh });
} catch (e) {
  return NextResponse.json(
    { ok: false, error: e instanceof Error ? e.message : String(e) },
    { status: 500 }
  );
} finally {
  releaseClusterMutex();
}
```

Add the import:

```ts
import { acquireClusterMutex, releaseClusterMutex } from "@flightdeck/auth/cluster-mutex";
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Smoke-test**

Run the dashboard in one shell, run the poller once in another, and verify only one cluster fires:

```bash
# Shell 1
cd apps/dashboard && pnpm dev
```

```bash
# Shell 2 — click Re-cluster in the dashboard UI, then immediately fire:
pnpm --filter @flightdeck/poller once
```

Look for `[poller-cluster] skipped — user cluster in flight` in shell 2 if the timing lines up, OR a 409 toast in the dashboard if you fired the poller first.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/app/api/data/themes/route.ts
git commit -m "feat(themes): user-side POST acquires cluster mutex"
```

---

## Phase 5 — Health endpoint + observability

### Task 5.1: Add `cluster` block to `/api/health` response

**Files:**
- Modify: `apps/dashboard/app/api/health/route.ts`

- [ ] **Step 1: Extend the `Health` type**

In `apps/dashboard/app/api/health/route.ts:13-41`, add:

```ts
type Health = {
  ok: boolean;
  dashboard: { uptimeMs: number; nodeVersion: string };
  token: { present: boolean; accessExpiresInMs: number | null; refreshExpiresInMs: number | null };
  sessions: { active: number };
  poller: {
    chats: Array<{
      chatId: string;
      lastRunAt: number | null;
      lastRunMsAgo: number | null;
      lastRunProcessed: number | null;
      lastRunError: string | null;
      lastSeenCreateMs: number;
    }>;
    recent24h: { ingested: number; failed: number };
  };
  cluster: {
    lastRunAt: number | null;
    lastRunMsAgo: number | null;
    lastRunMode: string | null;
    lastRunError: string | null;
  };
};
```

- [ ] **Step 2: Populate the cluster block from `poller_state`**

In the same file, find the existing block that reads `poller_state`. Right after it, add:

```ts
// Cluster block — read most-recent cluster outcome from any poller_state row.
const clusterRow = db
  .prepare(
    "SELECT last_cluster_at, last_cluster_mode, last_cluster_error FROM poller_state WHERE last_cluster_at IS NOT NULL ORDER BY last_cluster_at DESC LIMIT 1"
  )
  .get() as
  | { last_cluster_at: number; last_cluster_mode: string | null; last_cluster_error: string | null }
  | undefined;

out.cluster = {
  lastRunAt: clusterRow?.last_cluster_at ?? null,
  lastRunMsAgo: clusterRow?.last_cluster_at ? now - clusterRow.last_cluster_at : null,
  lastRunMode: clusterRow?.last_cluster_mode ?? null,
  lastRunError: clusterRow?.last_cluster_error ?? null,
};
```

And initialise it on the `out` object near the top:

```ts
const out: Health = {
  // ... existing fields ...
  cluster: { lastRunAt: null, lastRunMsAgo: null, lastRunMode: null, lastRunError: null },
};
```

- [ ] **Step 3: Typecheck + smoke-test**

```bash
pnpm typecheck
cd apps/dashboard && pnpm dev &
DEV_PID=$!
sleep 8
curl -s -m 10 http://localhost:3000/api/health | head -c 800
kill $DEV_PID 2>/dev/null
wait 2>/dev/null
```

Expected: JSON includes a `cluster` block. After running the poller at least once, `cluster.lastRunAt` should be populated.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/app/api/health/route.ts
git commit -m "feat(health): surface cluster.lastRun{At,Mode,Error}"
```

---

## Phase 6 — UI updates for unified theme members

### Task 6.1: `TopThemes` chip count uses BD + Dev membership

**Files:**
- Modify: `apps/dashboard/components/views/TopThemes.tsx:142-159` (scoped theme metric derivation)
- Modify: `apps/dashboard/components/views/TopThemes.tsx:303-313` (tooltip text)

- [ ] **Step 1: Derive a `displayCount` that's BD + Dev by default**

Find the `scopedThemes` derivation around line 142:

```ts
const scopedThemes: ScopedTheme[] = allThemes.map((t) => {
  if (!scopeBdIds) {
    return {
      ...t,
      scopedCount: t.bdVolume,
      scopedMedianAgeDays: t.bdMedianAgeDays,
    };
  }
  const inScope = t.bdRecordIds.filter((id) => scopeBdIds.has(id));
  return {
    ...t,
    scopedCount: inScope.length,
    scopedMedianAgeDays: inScope.length > 0 ? t.bdMedianAgeDays : null,
  };
});
```

Replace with:

```ts
const scopedThemes: ScopedTheme[] = allThemes.map((t) => {
  if (!scopeBdIds) {
    return {
      ...t,
      scopedCount: t.bdRecordIds.length + t.devRecordIds.length,
      scopedMedianAgeDays: t.bdMedianAgeDays,
    };
  }
  const inScope = t.bdRecordIds.filter((id) => scopeBdIds.has(id));
  return {
    ...t,
    scopedCount: inScope.length,
    scopedMedianAgeDays: inScope.length > 0 ? t.bdMedianAgeDays : null,
  };
});
```

Note: `scopeBdIds` semantics stay BD-only. That's deliberate — the Triage view scopes to in-view BD rows, and the chip count there represents BD coverage of the visible set. The unscoped global view (Roadmap, etc.) is what shifts to BD + Dev.

- [ ] **Step 2: Update the chip tooltip**

Around `TopThemes.tsx:303-313` the `title` attribute reads `${t.bdVolume} BD rows in this theme`. Replace with a BD+Dev-aware tooltip:

```ts
title={
  effectiveSortMode === "dev"
    ? `${count} ${countLabel} (${t.bdRecordIds.length} BD · ${t.devRecordIds.length} Dev in cluster)`
    : scopeBdIds
      ? `${count} in this view (${t.bdRecordIds.length} BD · ${t.devRecordIds.length} Dev total in cluster)`
      : `${t.bdRecordIds.length} BD rows · ${t.devRecordIds.length} Dev tickets in this theme`
}
```

- [ ] **Step 3: Typecheck + smoke-test**

```bash
pnpm typecheck
cd apps/dashboard && pnpm dev
```

Visit `http://localhost:3000/triage` and `http://localhost:3000/roadmap` in a browser. Verify chip counts include Dev members on Roadmap (where unscoped) and stay BD-only on Triage (where `scopeBdIds` is set). Hover a chip to see the tooltip's source breakdown.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/components/views/TopThemes.tsx
git commit -m "feat(top-themes): chip count + tooltip reflect BD + Dev members"
```

---

### Task 6.2: `RoadmapView` looks up theme membership via `devRecordIds` (direct), not via BD-link transitive lookup

**Files:**
- Modify: `apps/dashboard/components/views/RoadmapView.tsx` (theme→dev lookup)

- [ ] **Step 1: Find the existing transitive lookup**

```bash
grep -n "bdToTheme\|devToTheme\|theme.*devRecordIds\|theme.*bdRecordIds" apps/dashboard/components/views/RoadmapView.tsx
```

Identify where the view decides whether a Dev ticket belongs to a theme. Today it's likely using a chain like `devToTheme[devId] = bdToTheme[devLinkedBdIds[0]]` (transitive). Replace with direct membership: iterate themes and build `devToTheme[devId] = theme` for every `devId in theme.devRecordIds`.

- [ ] **Step 2: Rewrite the lookup**

Build a `devToTheme: Map<string, Theme>` from the themes blob's `devRecordIds`:

```ts
const devToTheme = React.useMemo(() => {
  const m = new Map<string, Theme>();
  for (const t of themes) {
    for (const id of t.devRecordIds) m.set(id, t);
  }
  return m;
}, [themes]);
```

Use this map wherever the view currently looks up "which theme is this Dev ticket in?" Drop the transitive `bdToTheme` lookup for Dev tickets — it's only needed for the BD-side membership now (Triage/Linkage use it for BD).

- [ ] **Step 3: Update theme-chip visibility filter**

In `RoadmapView.tsx` around the theme chips section, the `scopeThemeIds` prop is built from "themes that have un-shipped Dev tickets." That logic stays correct because it iterates Dev tickets and looks them up in `devToTheme`. Confirm by re-reading.

- [ ] **Step 4: Typecheck + smoke-test in browser**

```bash
pnpm typecheck
cd apps/dashboard && pnpm dev
```

Visit `/roadmap`. Verify that:

1. Push tickets (no BD link) now appear under a theme chip when filtered.
2. Themes with zero BD members but >0 Dev members are visible as chips.
3. Pull/Push split bar (`PullPushBar`) still renders correctly per theme.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/components/views/RoadmapView.tsx
git commit -m "feat(roadmap): use direct devRecordIds for theme membership"
```

---

### Task 6.3: `LinkageView` surfaces push tickets per theme

**Files:**
- Modify: `apps/dashboard/components/views/LinkageView.tsx`
- Modify: `apps/dashboard/app/api/data/linkage/route.ts` (if it computes `orphanDev` or `coverage` server-side — extend with push tickets per theme)

- [ ] **Step 1: Inspect the existing linkage data flow**

```bash
grep -n "orphanDev\|pairs\|coverage\|devToTheme" apps/dashboard/components/views/LinkageView.tsx apps/dashboard/app/api/data/linkage/route.ts
```

Identify where `orphanDev` (push tickets — Dev tickets without a BD pair) is computed and rendered.

- [ ] **Step 2: Group `orphanDev` by theme in the server response**

In `apps/dashboard/app/api/data/linkage/route.ts`, when building the `LinkageData` payload, group `orphanDev` by their direct theme membership:

```ts
const devToTheme = new Map<string, Theme>();
for (const t of themes) {
  for (const id of t.devRecordIds) devToTheme.set(id, t);
}

// orphanDev is already computed. Reshape it into a per-theme map:
const orphanDevByTheme: Record<string, DevRow[]> = {};
for (const dev of orphanDev) {
  const t = devToTheme.get(dev.recordId);
  const key = t?.id ?? "_no_theme";
  (orphanDevByTheme[key] ??= []).push(dev);
}
```

Add `orphanDevByTheme` to the `LinkageData` shape in `apps/dashboard/lib/data-shapes.ts`. Update the view to render an additional "Push (no BD link)" row per theme that has any push tickets.

- [ ] **Step 3: Typecheck + smoke-test**

```bash
pnpm typecheck
cd apps/dashboard && pnpm dev
```

Visit `/linkage`. Verify that push tickets now appear under their theme rather than in a flat "orphan Dev" bucket.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/components/views/LinkageView.tsx apps/dashboard/app/api/data/linkage/route.ts apps/dashboard/lib/data-shapes.ts
git commit -m "feat(linkage): show push tickets grouped by theme"
```

---

## Phase 7 — Deploy + verify on hubbibi

### Task 7.1: Local end-to-end verification

- [ ] **Step 1: Run the dashboard + poller together**

In one shell:

```bash
cd apps/dashboard && pnpm dev
```

In another:

```bash
pnpm --filter @flightdeck/poller once
```

Verify all the expected log lines appear (`[poller-cluster] ok ...` etc.).

- [ ] **Step 2: Click "Re-cluster" in the UI**

Watch the journal:
- POST `/api/data/themes` should return ok with new themes
- `cluster` block in `/api/health` updates
- Chips show BD + Dev counts

- [ ] **Step 3: Disable via KILLSWITCH**

Edit `KILLSWITCH.md`, flip `auto-cluster` to `disabled`. Run the poller once:

```bash
pnpm --filter @flightdeck/poller once
```

Expected log line: `[poller-cluster] disabled via KILLSWITCH`. `cluster.lastRunMode` in `/api/health` becomes `disabled`.

Revert the KILLSWITCH change before committing the next task.

- [ ] **Step 4: Commit (if anything changed since the last task)**

```bash
git status
```

If clean, skip the commit.

---

### Task 7.2: Deploy to hubbibi

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

(Rsync from the desktop picks it up within 15 minutes; or fire the rsync cron manually.)

- [ ] **Step 2: Rebuild dashboard on hubbibi**

```bash
ssh flightdeck@100.113.34.13 'cd ~/repos/salonx-flightdeck && /srv/flightdeck/.local/share/pnpm/bin/pnpm install --frozen-lockfile && /srv/flightdeck/.local/share/pnpm/bin/pnpm --filter salonx-flightdeck-dashboard build 2>&1 | tail -50'
```

Verify build success.

- [ ] **Step 3: Restart the dashboard**

```bash
ssh elwin@100.113.34.13 'sudo -n systemctl restart flightdeck.service'
sleep 5
curl -s -m 10 http://100.113.34.13:3002/api/health | head -c 800
```

Expected: `cluster` block present, `lastRunMode` is `null` initially.

- [ ] **Step 4: Restart the poller**

```bash
ssh elwin@100.113.34.13 'sudo -n systemctl restart flightdeck-poller.service'
```

- [ ] **Step 5: Wait one poller cycle + verify**

```bash
sleep 90  # poller cycle is 15 min; one-off start triggers an immediate cycle
ssh elwin@100.113.34.13 'sudo -n journalctl -u flightdeck-poller.service -n 50 --no-pager | grep "poller-cluster"'
```

Expected: at least one `[poller-cluster] ok themes=...` line.

- [ ] **Step 6: Verify in browser**

Open `https://flightdeck.hubbibi.online/roadmap`. Confirm push tickets appear under theme chips.

---

## Phase 8 — Subagent verification of the implementation

After all preceding phases are complete and deployed, dispatch two subagents (in parallel) to independently verify the implementation. The user specifically asked for this — do not trust the implementer's self-report; verify externally.

### Task 8.1: Dispatch a "code review" subagent

Use `code-review-specialist`. Brief it with:

- The spec path: `docs/2026-05-12-auto-cluster-design.md`
- The plan path: `docs/2026-05-12-auto-cluster-plan.md`
- Git range to review: from the commit at the start of Phase 0 (e.g. `git log --oneline | grep "scaffold workspace package"`) to HEAD.
- Verification checklist (paste verbatim into the prompt):
  1. Every spec section has a corresponding code change. Identify gaps.
  2. The `parseClaudeThemes` cross-theme uniqueness check actually drops duplicate ids (verify by reading `lib/themes/cluster.ts` post-change). Confirm `seenAcrossThemes` Set is referenced in every per-theme filter.
  3. The `cluster_mutex` is correctly acquired AND released on every code path through `runClusterStep` AND the POST `/api/data/themes` route. Stale-lock override at 10 min is present.
  4. The KILLSWITCH `auto-cluster` row is parseable by `isWorkflowEnabled` — fail-closed behavior fires when the row is missing.
  5. `fetchAndSampleInputs` reads both BD and Dev tables, dedupes correctly within the 80-row cap, prioritises unaddressed BD → push Dev → fill, and never returns the same record_id twice.
  6. Dev-row "non-shipped" filter uses the right terminal status set. Cross-check `memory/reference_lark_base.md` or actual Lark data.
  7. `parseAssignOutput`'s new `members[]` parsing correctly separates BD and Dev members, never accepts an id whose declared `source` doesn't match the valid Set.
  8. The dashboard's `TopThemes`, `RoadmapView`, `LinkageView` all read `devRecordIds` for direct theme membership, NOT the legacy transitive `linkedDevIds` chain.
  9. Type changes don't break the `Theme` wire shape on the histogram view (`/themes/history`).
  10. Any failure mode in `runClusterStep` (including `acquireClusterMutex` returning false) reaches the `releaseClusterMutex()` call OR doesn't reach it (depending on whether it held the lock). No double-release. No leaked lock.

Output format: PASS/PARTIAL/FAIL summary, followed by per-checklist verdict.

### Task 8.2: Dispatch a "deployment validator" subagent

Use `general-purpose` with bash + ssh access. Brief it with:

- Hubbibi access via Tailscale: `ssh flightdeck@100.113.34.13` (non-interactive) + `ssh elwin@100.113.34.13` (has `sudo -n`).
- Verification steps (paste verbatim into the prompt):
  1. Confirm the deployed `.next/BUILD_ID` is fresh (timestamp from the last hour, not stale).
  2. Confirm both `flightdeck.service` and `flightdeck-poller.service` are `active (running)` with PIDs younger than 10 min.
  3. Confirm v2 + auto-cluster markers are present in the compiled bundle:
     - `grep -r "FeedbackInputRow" /srv/flightdeck/repos/salonx-flightdeck/apps/dashboard/.next/server/` returns at least 1 hit.
     - `grep -r "poller-cluster" /srv/flightdeck/repos/salonx-flightdeck/lib/services/lark-poller/cluster-step.ts` returns the file content.
  4. `curl http://100.113.34.13:3002/api/health` returns a `cluster` block with non-null `lastRunAt` (an actual cluster has run).
  5. `journalctl -u flightdeck-poller.service -n 100` shows at least one `[poller-cluster] ok themes=...` line in the last 30 min.
  6. SQLite check: `sqlite3 /srv/flightdeck/data/tokens.db "SELECT cache_key, json_extract(payload_json, '\$.mode') FROM lark_cache WHERE cache_key LIKE 'themes:%' ORDER BY fetched_at DESC LIMIT 3"` — confirm the most-recent blob is `mode='claude'`, has both `bdRecordIds` and `devRecordIds` populated on its themes (`SELECT json_extract(payload_json, '\$.themes[0].devRecordIds') FROM lark_cache WHERE cache_key='themes:bd:v1:last'`).
  7. KILLSWITCH end-to-end test: edit `KILLSWITCH.md` on hubbibi to set `auto-cluster` to `disabled`, fire `pnpm --filter @flightdeck/poller once`, confirm `[poller-cluster] disabled via KILLSWITCH` in logs, then revert KILLSWITCH and confirm the next cycle resumes normally.
  8. Concurrency test: while a poller cycle is running, fire `curl -X POST http://100.113.34.13:3002/api/data/themes` with a session cookie. Expect 409. OR if the user-side fires first, observe `[poller-cluster] skipped` in the journal.

Output format: PASS/PARTIAL/FAIL summary, per-step verdict, and any surprising findings.

- [ ] **Step 1: Run Task 8.1 and Task 8.2 in parallel via two `Agent` tool calls in a single message**
- [ ] **Step 2: Read both reports. If both PASS, you're done. If either reports issues, fix them inline and re-run the relevant verification subagent.**
- [ ] **Step 3: Update `KILLSWITCH.md` `auto-cluster` row's "Last run" column with a verification timestamp (e.g. "verified 2026-05-DD") and commit.**

```bash
git add KILLSWITCH.md
git commit -m "chore: record auto-cluster verification timestamp"
```

---

## Self-review against the spec

After all phases are committed, walk the design doc section-by-section and tick off coverage:

- [ ] Spec "Data substrate" → Tasks 1.1, 1.2, 2.4
- [ ] Spec "Prompt + cluster contract" → Tasks 2.1, 2.2, 2.3
- [ ] Spec "Trigger — poller integration" → Tasks 0.1-0.5 (refactor) + 4.1, 4.2, 3.2 (mutex)
- [ ] Spec "Pre-requisite refactor" → Tasks 0.1-0.5
- [ ] Spec "UI impact" → Tasks 6.1, 6.2, 6.3 (Triage explicitly unchanged per design)
- [ ] Spec "Failure handling" → Task 4.1 (runClusterStep's mode taxonomy)
- [ ] Spec "Observability" → Tasks 3.1 (DB columns), 5.1 (/api/health)
- [ ] Spec "Acceptance criteria" → Task 7.1 + 7.2
- [ ] Independent verification by subagents → Phase 8 (Tasks 8.1, 8.2)

If any spec requirement has no corresponding task, add one inline before handoff.
