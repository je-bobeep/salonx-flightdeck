# Auto-cluster on new BD/Dev rows — design

Captured 2026-05-12. Implementation pending.

## Problem

Today, clustering is user-triggered only — the PM must click "Re-cluster" to see new BD rows bucketed. New Feature Development tickets get themes only transitively (via their linked BD rows); "push" Dev tickets (no BD link, strategy-driven) are invisible to the theme system entirely. On the Roadmap view, push tickets fall outside every theme chip and have no concern-bucketing surface at all.

The job-to-be-done: every new product-feedback signal — BD-feedback request from a merchant, or Feature Development ticket from engineering — should automatically land in an existing or new theme, with no manual ceremony.

## Locked decisions

Each row is a choice the user made during brainstorming; together they shape every later trade-off.

| # | Decision | Why |
|---|---|---|
| 1 | Themes are concern-buckets over a **unified pool** of BD non-Done + Dev non-shipped rows | Theme = underlying concern, not "which Lark table this row lives in." Push tickets share concerns with BD-driven work; the asymmetry where BD owns themes and Dev guests is what creates the push-ticket blind spot. |
| 2 | Auto-cluster **piggybacks on the BD poller cycle** (every 15 min) | One scheduler, no new process. Bounded cost — empty-delta cycles short-circuit. Worst-case 15-min latency from a Dev ticket being created in Lark Base to it appearing under a theme chip is acceptable. |
| 3 | Auto-cluster runs **incremental by default; auto-promotes to from-scratch** per existing drift signals | Same logic the manual Re-cluster button uses today (`themes-server.ts:421-449`). Means an unattended from-scratch can fire when last incremental minted a new theme or >7d since last full run. PM is comfortable with the cost shape (~$1 per promoted run, ~once/week realistic). |
| 4 | Auto-cluster is **KILLSWITCH-gated** with a new `auto-cluster` row | Lets the cluster step be disabled without touching the BD ingestion path. Same one-edit-one-commit pattern existing workflows use. |
| 5 | `devRecordIds` semantics change from **derived to directly-assigned** | Today: `bdRecordIds.flatMap(byId.get(id).linkedDevIds)`. New: whatever Claude put in each theme during clustering. Pull/push is read off the Dev row's own `hasFeedback` flag at render time. |
| 6 | No explicit **per-day Claude budget cap** in v1 | Empty-delta short-circuit + 15-min cadence are sufficient guardrails. Add a cap if real usage proves noisy. |

## Data substrate

### Clustering inputs

Today, `fetchAndSampleInputs()` in `apps/dashboard/lib/themes-server.ts:58-78` samples up to 80 BD non-Done rows, prioritising "unaddressed" (no linked Dev, not deployed), then filling with most-recently-created of the rest.

New version samples from the **union** of:

- BD non-Done rows (current path)
- Feature Development non-shipped rows (new fetch via a new `fetchAllDev()` modelled on `fetchAllBd()`)

Same 80-row cap. New priority order: unaddressed BD → push Dev (no BD link) → fill with most-recently-created of the remaining rows. The cap matters because the cluster prompt size is bounded by it; raising the cap is a separate cost-vs-quality call we don't make here.

Each input row gets a new `source: "bd" | "dev"` field plus existing item/translate/category/etc.

For Dev rows:
- `item` = Feature Development `Story description` (rich PRD-shaped text, plain string per `memory/reference_lark_base.md`)
- `category` = Dev `Module` MultiSelect (treated symmetrically to BD `Category`)
- `subCategory` = empty string (Dev rows have no analogue)
- `translate` = same as `item` (Dev rows are usually English already)
- `priority` = Dev `Priority` SingleSelect (string form, same as BD)
- `ageDays` = derived from Dev `Date Created`
- `linkedDevIds` = `[]` (a Dev row IS the dev row; the existing BD-side field stays meaningful for BD rows only)
- `dateCreatedMs` = Dev `Date Created` epoch ms

### Theme shape

Wire shape stays the same:
```ts
type Theme = {
  id, name, description,
  bdRecordIds: string[],
  devRecordIds: string[],
  dominantCategories, dominantSubCategories,
  bdVolume, bdMedianAgeDays,
  rising,
};
```

`devRecordIds` semantics change:

- **Today:** transitively derived inside `parseClaudeThemes` as `bdRecordIds.flatMap(byId.get(id).linkedDevIds)`. Always implied by BD membership.
- **New:** directly populated from Claude's output for the theme. A Dev row is in a theme because Claude put it there (either via a `clusterBd` from-scratch output or an `assignNewRows` incremental assignment).

The pull/push split lives on the Dev row itself (`hasFeedback` from `apps/dashboard/lib/data-shapes.ts:167`). Any UI that wants per-theme pull/push counts computes it on the fly by looking up each `devRecordIds[i]` in the Dev table snapshot.

`bdMedianAgeDays` stays BD-only (BD has reliable `ageDays`; Dev `ageDays` is less consistent).

`rising` widens from "≥3 new BD members in last 14 days" to **"≥3 new BD-or-Dev members in last 14 days"** so push-ticket spikes register on the flame badge.

### Cache versioning

Cache key prefix stays `themes:bd:v1:`. The wire shape doesn't change, so old blobs in the 14-day retention window remain readable — their `devRecordIds` is just the transitively-derived legacy set. The first auto-cluster run after this lands rewrites `:last` and today's daily bucket with directly-assigned membership. No migration script.

(Renaming the prefix to `themes:v1:` to reflect the wider substrate is tempting but not load-bearing; defer.)

## Prompt + cluster contract

### `clusterBdSystemPrompt` (from-scratch)

Reframed lead sentence: "You cluster product-feedback signals from a SalonX intake log into a small set of THEMES. Each signal is either a BD-feedback request from a merchant or a Feature Development ticket from engineering."

Input description gains the `source` field:

```
The user message contains a JSON array of feedback signals. Each row has:
  { record_id, source, item, translate, category, subCategory, priority, ageDays }
where source is either "bd" (BD-feedback request) or "dev" (Feature Development ticket).
```

Output schema adds `devRecordIds`:

```json
{
  "themes": [{
    "name": "...",
    "description": "...",
    "bdRecordIds": ["rec..."],
    "devRecordIds": ["rec..."],
    "dominantCategories": [...],
    "dominantSubCategories": [...]
  }]
}
```

Constraint added: "Every input record_id (BD or Dev) must appear in exactly ONE theme. Source has no bearing on grouping — group by concern, not by source. A BD complaint about mobile calendar slowness and a Dev ticket 'Make calendar mobile-responsive' belong in the same theme."

The 14 candidate themes in `lib/themes/taxonomy.ts` stay unchanged — they're already framed as concerns. "Other (cross-cutting)" stays as the escape valve.

The brand-new-name cap of 2/run stays. Strict-retry stays. Fail-closed on second cap violation stays.

### `assignBdSystemPrompt` (incremental)

Same reframe: "You assign NEW feedback signals to an EXISTING set of themes…"

Catalog entries for existing themes gain a hint per example item indicating the source (BD vs Dev). Example items per theme stay capped at 3.

Output schema: `assignments[]` entries can carry either a BD or Dev `record_id`; `newThemes[].bdRecordIds` becomes `newThemes[].members: Array<{ id: string, source: "bd" | "dev" }>`. The `placed` Set in `parseAssignOutput` already enforces cross-theme uniqueness — it just operates over a wider universe now.

### Post-parse validation

Inside `parseClaudeThemes` and `parseAssignOutput`:

- The `byId` / `validRecordIds` Set is now the union of input BD ids + input Dev ids.
- Hallucinated record IDs continue to be dropped silently.
- Dedup within a theme stays.
- Cross-theme uniqueness in `parseAssignOutput` widens to the union universe (no code change — the `placed` Set already handles it).
- `dominantCategories` and `dominantSubCategories` continue to be trimmed to top-2 each.
- `rising` recompute uses the unified member set (BD + Dev).

## Trigger — poller integration

### Pre-requisite refactor: extract themes-server out of `apps/dashboard/`

`computeFreshThemes` and `fetchAllBd` currently live at `apps/dashboard/lib/themes-server.ts` and `apps/dashboard/lib/data-derive.ts`. The BD poller is a separate workspace package (`@flightdeck/poller` at `lib/services/lark-poller/`) and can't import from `apps/dashboard/lib/` — that's an app, not a package.

Refactor: move the data-fetch + cluster-orchestration code into a new workspace package `@flightdeck/themes-server` at `lib/themes-server/`:

- `lib/themes-server/orchestrate.ts` ← `apps/dashboard/lib/themes-server.ts` (no logic change; just relocate)
- `lib/themes-server/fetch.ts` ← the BD-relevant parts of `apps/dashboard/lib/data-derive.ts` (`fetchAllBd`, `projectBd`, plus the new `fetchAllDev` + `projectDev`)
- `lib/themes-server/package.json` declaring exports for both files

The dashboard's existing route handlers (`apps/dashboard/app/api/data/themes/route.ts` etc.) update their imports from `@/lib/themes-server` to `@flightdeck/themes-server/orchestrate`. The dashboard's other consumers of `data-derive.ts` (Triage/Roadmap/Linkage data routes) keep pulling fetch helpers from their existing location — only the BD-fetch + cluster-orchestration parts move. This minimises the blast radius of the refactor.

The poller then imports `computeFreshThemes` and `fetchAllDev` from `@flightdeck/themes-server/orchestrate` directly. Same Node process boundary, same SQLite DB, same Claude subprocess auth — just a workspace re-shape.

### New file: `lib/services/lark-poller/cluster-step.ts`

```ts
export async function runClusterStep(): Promise<{
  mode: "claude" | "unavailable" | "skipped" | "disabled" | "empty-delta";
  themesCount: number;
  err?: string;
}>;
```

Called from the BD poller's main cycle after BD ingestion completes successfully. Sequence:

1. Read `KILLSWITCH.md`, check `auto-cluster` row. If `disabled` → return `{ mode: "disabled", themesCount: 0 }`.
2. Try to acquire a SQLite-backed `cluster_mutex` (new table, same pattern as `refresh_mutex` in `lib/auth/db.ts`). If held → return `{ mode: "skipped", themesCount: 0 }`. Log `[poller-cluster] skipped — user cluster in flight`.
3. Call `computeFreshThemes()` from `apps/dashboard/lib/themes-server.ts`. Default mode is incremental; the existing drift-promote logic auto-fires from-scratch when prior blob isn't `mode: "claude"`, or >7d since `lastFullAt`, or last incremental minted any new themes.
4. On success, log `[poller-cluster] ok themesCount=N mode=X newThemes=Y`. Release mutex.
5. On `mode: "unavailable"` (Claude unparseable, timeout, or fail-closed on cap violation): log warning, store `last_cluster_error` in `poller_state`. Do NOT throw — the poller cycle still succeeds.
6. Update `poller_state` row with `last_cluster_at`, `last_cluster_mode`, `last_cluster_error` (nullable).

The cluster step is wrapped in try/finally so the mutex always gets released, even if `computeFreshThemes` throws.

### Mutex

`cluster_mutex` table — single-row pattern, atomic INSERT-or-ignore on a fixed primary key, with `acquired_at INTEGER` and `holder TEXT` (`"poller"` or `"user"`). Released by DELETE. Stale-lock guard: if `acquired_at` > 10 minutes ago, treat as orphaned and overwrite. (10 min comfortably exceeds the 300s cluster timeout + bookkeeping.)

User-triggered `Re-cluster` and `Cluster from scratch` in the POST `/api/data/themes` route handler also acquire the mutex (new code) so the two paths can't race. If the poller-side step is mid-run, the user-side route returns a 409 with `"clustering already in progress — try again in a moment"`; the dashboard's existing error-toast path surfaces this verbatim via the existing `useRefreshThemes` error handling.

### KILLSWITCH row

Append to `KILLSWITCH.md` workflow table:

```
| `auto-cluster` | After every lark-bd-poller cycle | salonx-flightdeck | enabled | — | Fires computeFreshThemes() at the end of each successful BD poller cycle. Auto-promotes to from-scratch per drift signals. Disable here to make the next cycle skip clustering without touching the BD ingestion path. |
```

### Dev row detection

Every cluster step fetches both tables fresh — `fetchAllBd()` + new `fetchAllDev()`. The "delta" computation already lives implicitly inside `computeIncremental`: `existingAssignedIds` is the prior blob's union of `bdRecordIds + devRecordIds`, so any record_id (BD or Dev) not in that set is treated as a new row. No separate diff table.

Empty-delta short-circuit (`themes-server.ts:289-300`) returns the prior blob with refreshed metrics and no Claude call — meaning quiet cycles cost nothing.

## UI impact

### TopThemes (`apps/dashboard/components/views/TopThemes.tsx`)

- **Chip count:** `bdRecordIds.length + devRecordIds.length` instead of `bdVolume`. Default `countLabel` becomes `"signals"` (was `"BD rows"`).
- **Tooltip:** `"<N> BD rows · <M> Dev tickets (pull P · push Q)"`. Pull/push computed from each `devRecordIds[i]` against the Dev table snapshot's `hasFeedback` flag.
- **Median-age badge:** unchanged — `bdMedianAgeDays`, BD-only.
- **Rising badge:** unchanged in UI; the underlying `rising` flag now incorporates Dev members.
- The `scopeBdIds` prop (used by Triage to scope chips to in-view BD rows) becomes `scopeRecordIds` with no source distinction, so chips can be scoped by either table's view.

### Roadmap (`apps/dashboard/components/views/RoadmapView.tsx`)

- Theme chip filtering: a theme matches a Dev ticket via direct `devRecordIds` membership rather than the legacy `bdToTheme` lookup.
- The existing `PullPushBar` (`RoadmapView.tsx:688`) already splits pull/push counts; under unified clustering it naturally includes push tickets per theme.
- Themes with zero BD members but >0 Dev members become valid chips (previously hidden because the chip's count would be 0).

### Linkage (`apps/dashboard/components/views/LinkageView.tsx`)

- Push tickets get a new `"Push (no BD link)"` row under each theme they belong to, alongside the existing pull pairs.
- Theme chip filtering uses the unified `devRecordIds` membership.

### Triage

No changes. Triage filters BD-only by definition. The unified pool just means new BD rows get themed within 15 minutes instead of waiting for a manual click.

### `/themes/history` and proposals pages

No shape changes. Historical blobs in the 14-day retention window from before this lands have empty-or-derived `devRecordIds`; they render fine. The history page will start showing richer per-theme counts once the auto-cluster has populated a few days of new blobs.

### Refresh behavior

TanStack's existing `refetchOnWindowFocus: true` + 5-min `staleTime` on the themes query surfaces auto-cluster results within seconds of tab focus. No new client-side polling needed.

## Failure handling

Inside `runClusterStep`:

| Failure | Behavior |
|---|---|
| Claude returns unparseable JSON | `computeFreshThemes()` returns `mode: "unavailable"` blob. `writeThemesCache` refuses to persist. Prior good blob retained. Step logs `[poller-cluster] unavailable — Claude failed, prior blob retained`. |
| 300s timeout | AbortController fires inside `computeFromScratch` / `computeIncremental`. Same `unavailable` path. |
| Brand-new name cap violation after strict retry | `clusterBd` returns null → `mode: "unavailable"`. Same path. |
| Mutex held by user-triggered call | Step returns `mode: "skipped"`. Logged. Next cycle (15 min later) retries. |
| Empty delta (no new BD/Dev rows since last cluster) | `computeIncremental` short-circuits at `themes-server.ts:289-300`. No Claude call. Metrics refreshed over current rows. |
| KILLSWITCH disabled | Step returns `mode: "disabled"`. Logged. |

None of these throw out of `runClusterStep`; the poller cycle always finishes cleanly. The `poller_state.last_cluster_error` field captures the most recent failure for `/api/health` to surface.

## Observability

### SQLite schema migrations (`lib/auth/db.ts` + `lib/services/lark-poller/state.ts`)

Add columns to `poller_state` (nullable, no defaults needed since each row is per-chat_id and gets updated on every cycle):

```sql
ALTER TABLE poller_state ADD COLUMN last_cluster_at INTEGER;
ALTER TABLE poller_state ADD COLUMN last_cluster_error TEXT;
ALTER TABLE poller_state ADD COLUMN last_cluster_mode TEXT;
```

New table:

```sql
CREATE TABLE IF NOT EXISTS cluster_mutex (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  holder TEXT NOT NULL,
  acquired_at INTEGER NOT NULL
);
```

Both migrations idempotent via `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` wrapped in a `PRAGMA table_info` check (same pattern existing migrations use).

### `/api/health` (`apps/dashboard/app/api/health/route.ts`)

Add a `cluster` block to the response:

```ts
cluster: {
  lastRunAt: number | null,
  lastRunMsAgo: number | null,
  lastRunMode: string | null,    // "claude" | "unavailable" | "skipped" | "disabled" | "empty-delta"
  lastRunError: string | null,
};
```

Still unauthenticated. No PII added.

### Console logs

All cluster-step output prefixed `[poller-cluster]` for easy `journalctl -u flightdeck-poller.service | grep` access.

## What's NOT in scope

- **Per-row override UI for Dev tickets.** The existing `theme_row_overrides` table is keyed on BD record IDs only. Extending overrides to Dev rows is a separate piece of work; for v1 the auto-cluster's output stands without per-Dev-row manual reassignment. Workaround: re-link the Dev ticket to the right BD row in Lark Base and let the next cluster re-pick.
- **Realtime Dev row detection.** No Lark webhook; 15-min poll cadence is the freshness floor.
- **Cost cap.** Empty-delta short-circuit + 15-min cadence are sufficient v1 guardrails.
- **Dev-specific clustering proposals.** The `taxonomy_proposals` flow stays BD-driven in its UI affordance, even though brand-new theme names minted by an auto-cluster run can be triggered by Dev rows. Proposal cards don't need to know which source triggered them.
- **Renaming the cache prefix.** `themes:bd:v1:` becomes a slight misnomer (the substrate now includes Dev) but the rename is cosmetic and risks breaking the 14-day retention window. Defer.

## Open questions

- The exact wording of the reframed `clusterBdSystemPrompt` lead sentences is best fine-tuned during implementation against real BD+Dev sample inputs. The shape locked here is non-negotiable; the prose is iterative.
- The auto-promote drift-detection thresholds (>7d since `lastFullAt`, `lastIncrementalNewThemeCount > 0`) currently fire on every Re-cluster click. Under auto-cluster they fire unattended too. If the from-scratch path turns out to fire too often in practice (>2/week unattended), revisit by adjusting the thresholds, not by gating the auto path.

## Acceptance criteria

A new BD row ingested by the poller appears under a theme chip within 15 minutes of ingestion. Same latency for a new Feature Development ticket created in Lark Base. Push tickets show up on the Roadmap under their theme chip. KILLSWITCH `auto-cluster=disabled` makes the next poller cycle skip the cluster step entirely while still ingesting BD rows. `/api/health` reports `cluster.lastRunAt` and `cluster.lastRunMode` after each cycle.
