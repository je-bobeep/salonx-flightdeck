# Rethink — Implementation Plan (2026-05-07)

Companion to `docs/2026-05-07-rethink-and-plan.md`. Each task is independent enough to verify in isolation. Order is: schema → server-side reads → client surfaces. All schema migrations go in `lib/auth/db.ts` (canonical migration spot per `lib/services/lark-poller/state.ts:4-5`).

---

## Pre-flight

- Confirm `pnpm -r typecheck` passes from current `main`. (Will fail fast if my baseline is wrong.)
- Ground every change in the existing patterns: `getDb()` boots and migrates idempotently; new tables added there get auto-created on next dev-server start.

---

## Task 1 — Schema migrations

**Scope.** Idempotent CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN clauses for all new persistence introduced by tasks 2–5.

**Tables to add to `lib/auth/db.ts:getDb()`:**

```sql
CREATE TABLE IF NOT EXISTS lark_thread_cache (
  thread_id          TEXT PRIMARY KEY,
  bd_record_id       TEXT,
  messages_json      TEXT NOT NULL,
  summary_text       TEXT,
  fetched_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lark_thread_cache_bd
  ON lark_thread_cache(bd_record_id);

CREATE TABLE IF NOT EXISTS dev_internal_target (
  dev_record_id  TEXT PRIMARY KEY,
  target_date    TEXT NOT NULL,           -- ISO YYYY-MM-DD
  notes          TEXT,
  set_at         INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS theme_row_overrides (
  bd_record_id   TEXT PRIMARY KEY,
  theme_id       TEXT NOT NULL,
  set_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scoping_telemetry (
  session_id              TEXT PRIMARY KEY REFERENCES scoping_sessions(id),
  flow_type               TEXT NOT NULL,
  started_at              INTEGER NOT NULL,
  user_turn_count         INTEGER NOT NULL DEFAULT 0,
  proposal_count          INTEGER NOT NULL DEFAULT 0,
  approved_count          INTEGER NOT NULL DEFAULT 0,
  rejected_count          INTEGER NOT NULL DEFAULT 0,
  abandoned_at            INTEGER,
  last_event_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scoping_telemetry_started
  ON scoping_telemetry(started_at DESC);
```

**Verify.** `node -e "require('./lib/auth/db.ts')"` would fail because of TS — instead, just boot `pnpm dev` and check the SQLite file with `sqlite3 .data/tokens.db ".tables"` to confirm the new tables exist. Schema-drift script (`pnpm check:lark-schema`) is unaffected.

---

## Task 2 — Lark thread context fetch

**Files touched.**

- `lib/lark/im.ts` — extend `listChatMessages`:
  - Add `containerIdType?: "chat" | "thread"` (default `"chat"`).
  - Add `containerId?: string` to override `chatId` when fetching threads.
  - When `containerIdType === "thread"`, the request omits `chatId` and uses `containerId` as `container_id`.
- `lib/services/lark-poller/state.ts` — new helper:
  ```ts
  getIngestByBdRecordId(bdRecordId: string): IngestLogEntry | null
  ```
  Returns the most recent `poller_ingest_log` row joined to that BD record (we already have `bd_record_id` on the row). Sort by `message_create_ms DESC`, limit 1.
- `lib/lark/im.ts` — also need to surface `thread_id` already in the schema; no schema change.
- New module `apps/dashboard/lib/thread-context.ts`:
  - `getThreadForBd(bdRecordId): Promise<{ source: IngestLogEntry; messages: LarkMessage[]; summary: string | null; cacheAgeMs: number; cacheHit: boolean } | { source: null }>`
  - Reads `lark_thread_cache` keyed by `thread_id`. TTL 24h.
  - On cache miss / refresh: calls `listChatMessages({containerIdType: 'thread', containerId: thread_id})`. Parent message is the source ingest message itself; replies are everything else.
  - Generates a one-line summary via `runClaudeOneShot` with a 30-word system prompt (`extract a single-sentence headline of the thread; no JSON, no preamble`). Cached alongside the messages.
- New route `apps/dashboard/app/api/data/bd/[recordId]/thread/route.ts`:
  - `GET ?refresh=1` to force re-fetch.
  - Auth-gated via `getToken()`.
  - Returns `{ ok: true, source: {...}, messages: [...], summary, cacheAgeMs, cacheHit }` or `{ ok: false, reason: "no-source-thread" }` when no `poller_ingest_log` row exists.
- New component `apps/dashboard/components/panel/BdThreadCard.tsx`:
  - Collapsed by default with `[Fetch thread]` button if not yet loaded; expanded inline once loaded.
  - Renders summary (single line, italic), then transcript: each row is sender (open_id last 6 chars if no name resolves) · timestamp · text.
  - Non-text msg types render as a labelled placeholder: `[image]`, `[file: …]`, `[post]`, `[other: msg_type=share_chat]`. Use `extractMessageText`'s null return as the trigger.
  - "Refresh" button triggers `?refresh=1`.
  - Show `cached <Nm ago>` chip when `cacheAgeMs > 60_000`.
- `apps/dashboard/components/panel/TicketPanel.tsx`:
  - Inside `BdSummary`, after the existing fields, render `<BdThreadCard bdRecordId={...} />`.
  - Only for the BD view (skip for Dev tickets).

**Surfaces unchanged.** TriageView, RoadmapView. No badges, no signal extraction.

**Verify.**
- `pnpm typecheck` passes.
- Boot dev server, open a BD row that came from the poller (any logged after the poller started), click panel; "Fetch thread" loads transcript.
- Open a BD row with no poller_ingest_log entry (manually-created row); see "No source thread for this row".

---

## Task 3 — Incremental re-cluster

**Files touched.**

- `lib/themes/shapes.ts`:
  - Add `provenance` to `ThemesBlob`:
    ```ts
    provenance?: {
      lastFullAt: string;
      lastIncrementalAt: string | null;
      incrementalSinceFull: number;
    };
    ```
- `lib/themes/cache.ts`:
  - `writeThemesCache(themes, mode, runKind: "full" | "incremental")` — updates `provenance`. When called with `runKind="full"`, resets `incrementalSinceFull` to 0 and stamps `lastFullAt`. When `"incremental"`, increments counter and stamps `lastIncrementalAt`. Reads previous blob's provenance to carry forward.
- `lib/themes/cluster.ts`:
  - Add `mode: "incremental" | "from-scratch"` to `ClusterOptions` (default `"from-scratch"` to preserve `clusterBd` semantics for any direct callers, including unit tests).
  - Add new exported function `assignNewRows({ newRows, existingThemes, abortSignal, model })`. Sends Claude only `newRows` + a compact theme catalog (id, name, description, ≤3 example items per theme). Output schema: `{ assignments: [{ record_id, theme_id }], newThemes: [{ tempId, name, description, bdRecordIds }] }`.
  - When `mode==='incremental'`:
    - Compute `existingAssignedSet = new Set(prevThemes.flatMap(t => t.bdRecordIds))`.
    - `newRows = rows.filter(r => !existingAssignedSet.has(r.recordId))`.
    - If `newRows.length === 0`, just rebuild metrics (volume, median age, rising) over current rows and return — no Claude call needed.
    - Else call `assignNewRows`. Append assigned rows to the matching `prevTheme.bdRecordIds`. Mint new themes. Recompute metrics over the merged member list.
  - **Hard guard:** if `previousBlob.mode === "fallback"`, ignore the requested incremental mode and force `from-scratch`. Log a warning.
- `lib/themes/prompts/cluster-bd.ts`:
  - Add new exported function `assignBdSystemPrompt({ existingThemes, count })` returning the assign-only prompt. Smaller, ≤500 chars.
- `apps/dashboard/lib/themes-server.ts`:
  - `computeFreshThemes(opts: { mode: "incremental" | "from-scratch" })`. Default to `"incremental"` for the dashboard route.
  - When the cache is missing entirely (no `lastFullAt`), force `from-scratch`.
- `apps/dashboard/app/api/data/themes/route.ts` (the POST endpoint that triggers a recompute):
  - Read `mode` from body. Default `"incremental"`. Call `computeFreshThemes({ mode })`.
- `apps/dashboard/components/views/TopThemes.tsx`:
  - Primary "Re-cluster" button stays — but its `onClick` now calls the mutation with `mode: "incremental"`. Tooltip: "Add new BD rows to existing themes."
  - Below it (or in an overflow), small text-link "Cluster from scratch" with a `confirm()` dialog ("This will reassign every BD row. Use when themes feel wrong."). Calls mutation with `mode: "from-scratch"`.
  - Show a small chip "From scratch — N days ago" reading from `provenance.lastFullAt`.
- `apps/dashboard/lib/queries/data.ts` (or wherever `useRefreshThemes` lives — find it):
  - Mutation accepts `mode`.
- **Per-row "Move to theme" override:**
  - `apps/dashboard/lib/queries/data.ts` — new mutation `useSetRowThemeOverride({ bdRecordId, themeId })`.
  - New route `POST /api/data/themes/override` — writes/deletes a row in `theme_row_overrides`.
  - In `themes-server.ts`, after compute, apply overrides: read `theme_row_overrides`, move each `bd_record_id` to its `theme_id` (if the theme exists in the current blob — drop silently otherwise; log).
  - In `TicketPanel.tsx` for BD rows, add a small "Theme: <name> [Move…]" line. Click → small select with the existing themes. On submit, mutation fires.
- **Shadow-recluster diff (data only — UI surfacing in v1.5).** Skip for now; the `provenance.incrementalSinceFull` counter exists so we can wire the diff card in the next iteration without another schema change.

**Verify.**
- Open dashboard, click "Re-cluster" — payload to `/api/data/themes` has `mode: "incremental"`. Existing themes preserved; only new rows reassigned.
- Add a fake new BD row in Lark with `[ExistingThemeName] X` prefix — verify it lands in that theme (incremental Claude call should put it there, no regex needed).
- Click "Cluster from scratch", confirm dialog, payload has `mode: "from-scratch"`. Full recompute fires.
- After scratch, `provenance.lastFullAt` is now and `incrementalSinceFull` is 0.

---

## Task 4 — Internal target date

**Files touched.**

- `apps/dashboard/lib/data-shapes.ts`:
  - Add `internalTargetDate: string | null` to `DevRow`. Add to `RoadmapTicket`. Add `internalOverdue: boolean` and `externalOverdue: boolean` to `RoadmapTicket` (replacing the single `overdue`).
- New module `apps/dashboard/lib/internal-target-db.ts`:
  - `getInternalTarget(devRecordId): { targetDate: string; notes: string | null; setAt: number } | null`
  - `setInternalTarget(devRecordId, targetDate, notes?)` — upserts.
  - `clearInternalTarget(devRecordId)` — deletes the row.
  - `listInternalTargets(devRecordIds): Map<string, string>` — bulk read for view-time merge.
- `apps/dashboard/lib/data-derive.ts`:
  - `projectDev` (search the file) gains `internalTargetDate` lookup. Bulk-fetch via `listInternalTargets` at the route layer to avoid N+1.
- `lib/lark/aging.ts`:
  - Add two new aging signals to the `AgingSignal` discriminated union:
    - `{ kind: "dev-internal-target-passed"; daysOverdue: number }`
    - `{ kind: "dev-internal-target-imminent"; daysToTarget: number }` (≤ 3)
  - Compute logic in the existing `agingForDev` function (or wherever `aging` is computed for Dev rows).
- `apps/dashboard/components/panel/TicketPanel.tsx`:
  - For Dev rows, after the existing ETA `<EditableField>`, add an "Internal target" `<EditableField type="date">`.
  - On save: POST to a new route `/api/data/dev/[recordId]/internal-target` with `{ targetDate, notes? }`. Optimistic update via TanStack Query.
  - Below the two date fields, a one-line drift chip *only when* external > internal date AND external recently changed: "External moved to YYYY-MM-DD; internal target still YYYY-MM-DD." (We don't track external-edits separately, so a simpler rule: if `internalDate < externalDate` strictly, show the chip in subdued grey saying "Buffer: N days". If `internalDate > externalDate`, show in red saying "Internal target after external commitment.")
- New route `apps/dashboard/app/api/data/dev/[recordId]/internal-target/route.ts`:
  - `POST { targetDate, notes? }` → `setInternalTarget`.
  - `DELETE` → `clearInternalTarget`.
- `apps/dashboard/components/views/RoadmapView.tsx`:
  - In the ticket row (`RoadmapCellView`), display **internal target** as the primary date (right-aligned where ETA is today). Tooltip: `External: YYYY-MM-DD`. If no internal target set, fall back to displaying external (current behavior).
  - Red dot if `internalOverdue`. Amber dot if internal-passed but external is in the future. Existing red-dot for external-overdue.
- `apps/dashboard/components/views/SprintView.tsx`:
  - The existing `noEta` aging signal (or filter logic) flips to "no internal target". External absence is a separate, lower-severity badge. (Cross-check `aging.ts` first — there may be a `dev-no-eta` kind already.)
- `apps/dashboard/lib/data-shapes.ts`'s `TodayData.sprint.noEta` continues to count rows missing internal target (semantic shift: it's now the planning-relevant absence).

**Verify.**
- Open a Dev row in TicketPanel, set Internal target to 3 days from now. Aging badge "imminent" appears.
- Set Internal target to yesterday. Red dot in roadmap, "passed" aging badge.
- Set External 2 weeks out, Internal 3 days out → external red dot fires for *internal*; tooltip shows external date.

---

## Task 5 — Scoping telemetry (instrument-only)

**Files touched.**

- New module `apps/dashboard/lib/scoping-telemetry.ts`:
  - `recordSessionStart(sessionId, flowType)`
  - `recordUserTurn(sessionId)`
  - `recordProposal(sessionId)`
  - `recordApproval(sessionId)`
  - `recordRejection(sessionId)`
  - `getTelemetryRollup(daysBack: number)` — returns `{ totalSessions, byFlowType: Record<string, number>, sessionsWithProposal, approvedActions, abandonedSessions, avgUserTurns }`.
- Wire calls into existing routes:
  - `apps/dashboard/app/api/scoping/session/route.ts` — `recordSessionStart` after row insert.
  - `apps/dashboard/app/api/scoping/turn/route.ts` — `recordUserTurn` once per request.
  - `apps/dashboard/app/api/lark/proposed-action/[id]/approve/route.ts` — `recordApproval` after the Lark write succeeds.
  - `apps/dashboard/app/api/lark/proposed-action/[id]/reject/route.ts` — `recordRejection`.
  - `lib/mcp-tools/tools/propose.ts` — `recordProposal` when a row is inserted into `proposed_actions`.
- `apps/dashboard/components/views/SessionsView.tsx`:
  - Add a small tile at the top: "Last 30 days: N sessions, M with proposal, K approved, J abandoned." Single line, neutral styling, anchored above the existing list. Read from a new `/api/data/scoping-telemetry` route.

**Verify.**
- Start a scoping session, make a turn, propose an action, approve it. Inspect the SQLite row:
  ```
  sqlite3 .data/tokens.db "SELECT * FROM scoping_telemetry"
  ```
- Tile renders correct counts on `/sessions`.

---

## Task 6 — Verification + smoke

After all five tasks:

- `pnpm -r typecheck` clean.
- Boot `pnpm dev` from `apps/dashboard/`. Confirm:
  - SQLite tables created on first request (sqlite3 `.tables`).
  - Triage page loads, panel opens, BD thread card renders.
  - Re-cluster button fires incremental mode; from-scratch link confirms + reclusters.
  - Dev row Internal target editable; aging badge fires correctly.
  - Sessions view tile renders.
- Static check: `grep -rn "internalTargetDate\|lark_thread_cache\|theme_row_overrides\|scoping_telemetry" apps/dashboard lib | wc -l` — non-zero everywhere expected.

---

## Out of plan (explicitly)

- Killing/replacing the Scope feature — telemetry only.
- Lark Base schema changes — none.
- Structured signal extraction from threads — not built.
- Prefix-tag short-circuit — not built.
- Gantt timeline view, capacity bars, T-shirt-sized buffer auto-suggest — not built.
- Shadow-recluster diff card UI — data only (the counter), wire UI in v1.5.

---

## Execution constraints

- **Idempotency.** Every schema migration must be idempotent so the dev server can bounce safely.
- **No `Lark Base` writes from the new code paths** beyond what already existed. Internal target stays SQLite-local.
- **Don't break the lark-poller.** It uses `runClaudeOneShot` and shares the same SQLite. Test path: poll cycle still ingests after schema changes.
- **Don't break the existing scope flows.** Telemetry hooks must be no-op safe — wrap each `record*()` call in try/catch and `console.warn` on failure; never bubble.
