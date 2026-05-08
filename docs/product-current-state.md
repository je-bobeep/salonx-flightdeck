# salonx-flightdeck — current state (2026-05-06)

## What this is

Single-user PM ops tool for the SalonX product, run on `localhost:3000`. Two intertwined goals: a **pipeline dashboard** that turns the SalonX Phase 2 Tracker (Lark Base — BD Feedback + Feature Development) into a triage + planning surface, and an **automation home** for net-new Lark-driven workflows. v1 is local-only, single-user, no hosting.

## Mental model

Reframed 2026-05-05: flightdeck is a **thinking surface**, not a Lark Base re-skin. Lark Base remains the editor for routine fields. Flightdeck adds the layer Lark Base can't:

- **Theme clustering** is the cross-cutting primitive — every list view above the row level is theme-aware.
- **Today** = morning briefing (one headline + four briefing cards).
- **Triage** = inbox of unaddressed BD feedback.
- **Linkage** = coverage view (BD ↔ Dev pairs, theme-coverage breakdown, orphan Dev).
- **Roadmap** = "what's shipping when" (Now / Next / Soon / Later × theme).
- **Sprint** (sidebar label "This Week") = current-sprint health by assignee.
- **Sessions** = scoping-conversation history + pending-approvals inbox.

All reads come from Lark Base. The only writes are `propose-then-approve` actions persisted in a local `proposed_actions` SQLite table; nothing fires until the user clicks Approve.

## Cross-cutting primitive: theme clustering

Code: `/Users/jiaen/all-salonx-repo/salonx-flightdeck/lib/themes/cluster.ts` (Claude + fallback grouping); cache `/Users/jiaen/all-salonx-repo/salonx-flightdeck/lib/themes/cache.ts`; orchestration `/Users/jiaen/all-salonx-repo/salonx-flightdeck/apps/dashboard/lib/themes-server.ts`.

- **Sample**: always include all unaddressed BD rows (`!hasLinkedDev && !hasDayOfDeploying`); fill to `CLUSTER_MAX_ROWS = 80` by recency. Excludes `status === "Done"`.
- **Claude path**: `clusterBd()` → `runClaudeOneShot` with `sonnet` model and 90s timeout. TS derives `bdVolume`, `bdMedianAgeDays`, `rising` (≥3 members ≤14d old), and stable IDs via 70%-overlap heuristic vs. previous run.
- **Deterministic fallback** (`fallbackClusterBd`): on timeout / parse failure / zero themes, group by raw `Sub-category` (or `Category[0]`). IDs prefixed `auto-`. `rising` is always false.
- **Cache** (`lark_cache` table): per-day key `themes:bd:v1:<YYYY-MM-DD>` plus a `themes:bd:v1:last` pointer. Hits today first, falls back to "last" with `fresh: false`.
- **Fallback UI signal**: views detect via `themes.every(t => t.id.startsWith("auto-"))`. `TopThemes` shows `auto-grouped` badge + amber sub-banner, hides `Uncategorized`, suppresses `rising` badge; `TodayView` skips the rising-not-on-roadmap headline branch.

## Pages

### Today (`/today`)

**Job-to-be-done.** "What's the single most actionable signal this morning?"

**What you see.** One `HeadlineNumber` picked by a priority ladder, then four briefing cards (2-col): BD queue (unaddressed, POC count, stale 14–30d, stale >30d, last-7d); Current sprint (active/total, no-ETA %, stuck >7d, no-milestone, "Draft weekly stakeholder update" CTA); Roadmap shape (rising-not-on-roadmap, aging-themes-zero-coverage); Coverage (Immediate-priority %).

**What drives it.** Route `apps/dashboard/app/api/data/today/route.ts`; view `apps/dashboard/components/views/TodayView.tsx`. Headline ladder (`pickHeadline`): `bd.stale30d > 10` → `bd.pocStale >= 3` → `sprint.active >= 5 && sprint.noEta >= 3 && ratio >= 0.5` → `bd.stale30d > 0` → `immediateCoveragePct < 80` → `risingNotOnRoadmap > 0 && !fallbackThemes` → "All clear". Theme signals read from cache only.

**Interactions.** Cards link to their respective routes. Headline CTA navigates accordingly. The "Draft weekly stakeholder update" button links to `/sprint?flow=weekly-review` which auto-starts the session.

**Edge cases / known gaps.** `bd.newLast7d` is a static count and uninformative (S19 deferred). Diff preview on approve cards not added (S20 deferred).

---

### Triage (`/triage`)

**Job-to-be-done.** "What BD feedback is sitting unaddressed, and which themes are clustering?"

**What you see.** `HeadlineNumber` (stale30 → stale14 → visible-rows fallback); `TopThemes` strip with chips scoped to the unaddressed set and a `Re-cluster` button; optional blue filter banner when a theme is selected; priority bands (Immediate → High → Medium → Low → "—") grouped by sub-category, sorted by age desc — each row shows `#number`, item/translate text, theme tag, category badges, POC badge, age in days, aging signal badges, `Scope` button.

**What drives it.** Route `apps/dashboard/app/api/data/triage/route.ts`; themes via `apps/dashboard/app/api/data/themes/route.ts`; view `apps/dashboard/components/views/TriageView.tsx`. "Unaddressed" = `!hasLinkedDev && !hasDayOfDeploying` (status-agnostic). Theme chips scoped to triage row IDs via `TopThemes` `scopeBdIds` so chip counts match what clicking yields.

**Interactions.** Click a theme chip → filter bands. Click a row → opens slide-over panel (`?panel=<bd>&kind=bd`). Click `Scope` button → opens panel with `flow=bd-to-dev` to auto-start the bd-to-dev scoping flow.

**Edge cases / known gaps.** Long Japanese-translation text wraps awkwardly (S7 deferred). Sub-group labels don't carry POC/aged/oldest counts (S8 deferred). "Scope this whole theme" CTA on Triage not added (S9 deferred).

---

### Roadmap (`/roadmap`)

**Job-to-be-done.** "What's shipping when, framed by theme, with pull (BD-driven) vs push (strategy-driven) split?"

**What you see.** Header with current/next sprint labels; pull/push summary bar (totals); `TopThemes` filter strip; optional amber `RisingBanner` listing rising themes with low coverage ratio + "Scope a theme" CTA; four columns — Now / Next / Soon / Later — each containing per-theme cells (or unthemed sub-buckets) showing theme name + rising badge + per-cell pull/push bar + ticket list with status dot, description, overdue dot, assignee initials, ETA.

**What drives it.** Route `apps/dashboard/app/api/data/roadmap/route.ts`; view `apps/dashboard/components/views/RoadmapView.tsx`. Banding (`bandFor`): sprint match wins (current → Now, next → Next); else ETA-based (≤14d Now, ≤30d Next, ≤90d Soon, else Later); past-ETA in-flight stays in Now with `overdue: true`, past-ETA inactive drops to Later. Shipped tickets filtered (`isShipped`: status bucket `done` OR `releaseDate <= now`). Theme assignment scores: direct devRecordId (5) + linked-BD overlap (1 each) + module/product ↔ dominant\* overlap (2). Unthemed tickets sub-bucket by `module[0]` → `milestone` → "Other". `risingNotScheduled` = `t.rising && coveredBdCount / max(bdVolume, 1) < 0.3`.

**Interactions.** Click a theme chip → filter columns to that theme. Click a ticket → opens panel (`?panel=<dev>&kind=dev`). RisingBanner "Scope a theme" navigates to `/triage`.

**Edge cases / known gaps.** Linkage "duplicate pairs" issue is a sibling problem (S13 deferred); does not affect Roadmap. No coverage-ratio chip on per-cell (out of scope).

---

### Linkage (`/linkage`)

**Job-to-be-done.** "Which BD feedback is being addressed, which themes are under-served, what's orphan Dev work?"

**What you see.** `HeadlineNumber` — Immediate-priority BD coverage % (color-graded). **Coverage by theme** — collapsible cards, one per theme, sorted by uncoveredBdCount desc; expand reveals linked Dev tickets + uncovered BD rows. **Active linkages** — BD ↔ Dev pairs whose Dev is not Released (one row per `(bd, dev)` — duplicates when one Dev links to many BDs). **Tickets without feedback** — orphan Dev (push work). **Archive (released linkages)** — collapsed by default.

**What drives it.** Route `apps/dashboard/app/api/data/linkage/route.ts`; view `apps/dashboard/components/views/LinkageView.tsx`. Pairs collected from BD `linkedDevIds` + reverse-direction. `coverage` computed only if a theme cache exists (no auto-recompute — points users to Re-cluster in Triage). Pairs sorted by Dev ETA asc then BD age desc; orphan Dev by `lastModifiedMs` desc.

**Interactions.** Click a coverage card → expand/collapse. Click a coverage Dev row, BD row, or pair row → opens panel (`?panel=<id>&kind=...`). Click `Sanity` button on an active pair → opens panel with `flow=pair-sanity`.

**Edge cases / known gaps.** Active linkages duplicates pairs when one Dev maps to many BDs (S13 deferred). The "did we forget Asano-san" angle isn't a headline here.

---

### Sprint (`/sprint`, sidebar label "This Week")

**Job-to-be-done.** "Is the current sprint commitment credible, and who's loaded with what?"

**What you see.** `HeadlineNumber` — `noEta% >= 50` (danger) → `stuck > 0` (warn) → "All active have ETAs" (success). CTA = "Draft weekly update". Two columns side-by-side — current sprint + detected next (placeholder card if none); per-assignee blocks (`active · in progress · done`) with rows showing status badge, description, ETA (or `no ETA` warn badge), `pair-sanity` inline link if BD links exist, aging badges.

**What drives it.** Route `apps/dashboard/app/api/data/sprint/route.ts`; view `apps/dashboard/components/views/SprintView.tsx`. Current sprint via `inferCurrentSprint`; visible labels = `[current, current+1]` from numerically-sorted set. Rows grouped by `assignees[0]?.name || "Unassigned"`. Headline `stuck` only counts `kind === "dev-status-stale"`.

**Interactions.** Click a row → opens Dev panel. Click `pair-sanity` text link → opens pair panel with `flow=pair-sanity`. Headline CTA `POST /api/scoping/session` with `flowType: "weekly-review"` then redirects to the new session URL.

**Edge cases / known gaps.** Not theme-aware (S16 deferred). pair-sanity is a tiny inline text link instead of a proper button (S17 deferred). The side-by-side "Next" duplicates Roadmap (S18 deferred). `stuck` headline misses non-`dev-status-stale` aging kinds (S21 deferred).

---

### Sessions (`/sessions`)

**Job-to-be-done.** "Resume an in-flight scoping session or clear pending approvals."

**What you see.** A single list (last 200 sessions). Each row: flow-type badge, ticket title (or `Ticket <id>` / `(detached)`), model, optional `<n> pending` warn badge, status badge (`active` / others), relative timestamp. Empty state directs to Triage/Linkage.

**What drives it.** Route `apps/dashboard/app/api/data/sessions/route.ts`; view `apps/dashboard/components/views/SessionsView.tsx`. SQL: `scoping_sessions` LEFT JOIN `proposed_actions` counting `state = 'pending'`. Client sorts pending desc, then `updatedAtMs` desc — pending-approvals inbox.

**Interactions.** Click a row → `resumeHrefFor(s)` builds a URL that re-opens the originating panel: `weekly-review` → `/sprint?session=<id>`; `pair-sanity` → `/linkage?session=<id>&panel=<bdId>&kind=pair&pair=<devId>`; otherwise → `/triage?session=<id>&panel=<recordId>&kind=<kind>`.

**Edge cases / known gaps.** No filter chips or row-level menu (mark-closed / delete) (S24 deferred). No duplicate-session hint when `(flowType, ticketRecordId)` matches multiple actives (S24 deferred).

## Scope flow (LLM-driven thinking surface)

**Trigger surfaces.**
- `bd-to-dev` — Triage row → `Scope` button (or generic row click then "Scope this for dev" inside the panel).
- `pair-sanity` — Linkage Active linkages "Sanity" button; Sprint row inline `pair-sanity` link (uses `bdLinkIds[0]`).
- `weekly-review` — Today "Draft weekly stakeholder update" CTA (links into Sprint with `flow=weekly-review`); Sprint headline "Draft weekly update" button.

**Lifecycle.**
1. `POST /api/scoping/session` (`apps/dashboard/app/api/scoping/session/route.ts`): mints `sessionId`, fetches Lark records, builds the flow's system prompt with `sessionId` baked in, persists session row + opener as first assistant message.
2. User types in `ChatShell` → `POST /api/scoping/turn` (`apps/dashboard/app/api/scoping/turn/route.ts`) streams NDJSON.
3. `runClaudeTurn` spawns `claude -p` with the local stdio MCP server. First turn passes system prompt; later turns use `--resume` via the persisted `claude_session_uuid`.
4. Claude calls read-only tools freely; a `propose_*` call persists a row in `proposed_actions` with `state = 'pending'` and disables the composer.
5. **Approve** in `ProposedActionCard` → `POST /api/lark/proposed-action/[id]/approve` (`apps/dashboard/app/api/lark/proposed-action/[id]/approve/route.ts`) does the actual Lark create/update/link or stakeholder MD file write, flips state to `fired`. Reject route flips to `rejected`.

**Tool palette** (`lib/mcp-tools/server.ts`): reads — `lark_read_bd_feedback`, `lark_read_feature_dev`, `lark_search_feature_dev`. Cross-repo — `siblings_read_index`, `siblings_search_prd_index`, `siblings_read_file`, `siblings_git_log_grep`, `siblings_gh_pr_search`, `siblings_kb_search`. Proposes — `propose_create_dev_ticket`, `propose_update_bd_status`, `propose_create_bd_dev_link`, `propose_write_stakeholder_md`.

**Hard invariants.**
- `session_id` is baked into every system prompt at session-create time (`sessionId` field on every prompt context).
- `propose_*` tools never write directly — they persist pending rows.
- Composer disables while any pending action exists for the session.
- "Propose at most one action per assistant turn" rule embedded in pair-sanity prompt; bd-to-dev requires draft-confirmation before proposing.
- Approve route is the only path that does real Lark/file writes.
- Stakeholder MD writes never overwrite — numeric-suffix collision avoidance.

## Out of scope (intentional)

- Not hosted. Local-only, single-user.
- Not a replacement for Lark Base UI — Lark stays the editor for routine field changes.
- Not real-time. Polling only; no webhooks.
- Not a home for SalonX product PRDs.
- Themes as a Lark Base column (revisit after ~3 months).
- Inline Status/Priority/Sprint/Milestone edits, bulk edits, drag-to-reschedule (dropped in 2026-05-05 pivot).
- Lark bot UX, multi-user auth, comments on Lark rows from the dashboard, generic create-row UI (only via approved scoping proposals).
- `ANTHROPIC_API_KEY` — Claude is via the `claude -p` CLI subscription.

## Recent changes (2026-05-05 → 2026-05-06)

- **S1**: `sessionId` minted up front and baked into every flow's system prompt — fixes silent `propose_*` failures.
- **S2**: `fallbackThemes` flag drives `TopThemes` `auto-grouped` badge, amber sub-banner, hidden "Uncategorized", suppressed `rising`.
- **S3 + S6**: Sessions rows clickable (`resumeHrefFor`); `pendingActions` warn badge; pending-first sort.
- **S4**: `bd.pocStale` (POC asks >14d) headline branch on Today.
- **S5**: Today ladder requires `sprint.active >= 5 && sprint.noEta >= 3 && ratio >= 0.5`; adds `bd.stale30d > 10` highest-priority branch.
- **S10**: Roadmap unthemed tickets sub-bucket by `module[0]` → `milestone` → "Other"; `pickThemeForDev` matches module/product against dominant\*.
- **S11**: Past-ETA in-flight stays in "Now" with `overdue: true` red dot.
- **S12**: `risingNotScheduled` fires when coverage ratio < 30% (was: any token Dev silenced banner).
- **S14 + S15**: bd-to-dev mandates duplicate-search before drafting + plain-text draft confirmation; pair-sanity adds "at most one action per assistant turn".
- Triage chips scoped to in-view BD IDs (no more "11 in chip, 0 on click"); Triage hook order stabilized; Roadmap drops `Released` via `isShipped`.
