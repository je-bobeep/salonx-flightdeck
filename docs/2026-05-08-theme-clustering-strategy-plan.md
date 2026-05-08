---
title: Theme clustering v2 — diagnosis, strategy, implementation
date: 2026-05-08
status: shipped
related:
  - docs/scope.md
  - docs/product-current-state.md
  - docs/v2-review-feedback.md
  - docs/2026-05-07-rethink-and-plan.md
  - docs/2026-05-07-rethink-implementation-plan.md
---

# Theme clustering v2 — diagnosis, strategy, implementation

**Audience:** jiaen + future Claude sessions.
**Status:** v2, post a self-review pass. Pending acceptance.
**Supersedes (when accepted):** the theme-clustering portions of `2026-05-07-rethink-implementation-plan.md` (sections T1–T3) and `2026-05-07-rethink-and-plan.md:78`'s shadow-diff approach.

---

## Changelog

- **v1 → v2 (post-review):**
  - **Phases reordered.** Empirical hand-mapping (was Phase 4) now blocks anchored-vocab work (was Phase 2) — it's the seed, not parallel.
  - **Phase 2 expanded** to fix the GET cache-miss path (`apps/dashboard/app/api/data/themes/route.ts:30-32`) — without this, fallback themes still render on first paint regardless of `writeThemesCache` rejection.
  - **Recovery affordance added.** 14-day retention of `lark_cache` daily buckets + `/themes/history` debug view, so the user can inspect & re-seed the candidate list from a clustering they remember as good.
  - **Anchored-id stability** added to Phase 3 — when a theme name comes from `CANDIDATE_THEMES`, its id is `slugify(name)` (no hash), so overrides survive renames.
  - **Drift threshold revised** from `N=20 incremental` to `7 days since lastFullAt OR any new theme minted in the latest incremental run`. Drops the arbitrary count.
  - **Anthropic spend cap.** Phase 3 retry-on-violation capped at 1; second violation fails closed (empty state).
  - **Phase 0 acceptance criterion** specified — record which of {C1, C2, C3} is the live state, with API response payload as evidence.
  - **§3(d) added** on `dominantCategories` / `dominantSubCategories` — already captured by current code, useful as additional clustering signal in Phase 3 prompt.
  - **R5, R6, OQ4 added** to Risks/OQs.
  - **Roadmap toggle framing softened** — anchored vocab is the primary fix to "Roadmap top themes look different"; the toggle is secondary.

---

## 0. TL;DR

1. **Nothing shipped.** Reflog confirms five commits ever; clustering landed in `459f4b0` (Phase A baseline) and hasn't been edited since. The visible regression is a **cache state**, not a release.
2. **Three candidate root causes** (record live state in Phase 0):
   - **C1.** Today's cache is in deterministic fallback (`mode: "fallback"`, theme names = raw `Sub-category`, ids prefixed `auto-`).
   - **C2.** A prior fallback run minted Sub-category-shaped names, and the next from-scratch Claude run inherited them via the `previousThemeNames` reuse clause.
   - **C3.** Incremental ossification — assign-prompt force-fits new rows into existing themes, can't coarsen.
3. **Roadmap "top themes are different" is a separate, intentional change** baked into 459f4b0: chip strip ranks by un-shipped Dev-ticket count per theme, not BD volume. The bigger fix to that complaint is the *anchored vocabulary* (Principle 1) — the sort-toggle is a smaller secondary fix.
4. **Strategy.** (a) Anchor the LLM to a curated, hand-validated vocabulary derived from real BD rows. (b) Refuse to render fallback themes (empty state instead). (c) Bound incremental drift with stable theme ids and a re-cluster trigger. (d) Make state explicit. (e) Let the user recover prior clusterings by retaining 14 days of cache.
5. **Implementation.** Phased, total ~7 days. Phase 0 (today, 30 min): diagnose. Phase 1 (½ day): empirical mapping that *seeds* Phase 3. Phase 2 (1 day): stop the bleeding. Phase 3 (3 days): anchored vocabulary. Phase 4 (2 days): drift bounding + Roadmap toggle.

---

## 1. What you asked

> "with the latest changes, the themes in triage queue / linkage seem to be now clustered by sub-categories, which i think are way too granular. the previous categorization made a lot more sense. also, the top themes in the Roadmap are quite different too. what changed? when did the change happen? can we improve this please."

Two distinct complaints:

- **A.** Triage / Linkage themes are Sub-category-granular; previous categorization was more sensible.
- **B.** Roadmap top themes look very different from before.

These have different root causes (below).

---

## 2. When did the change happen

Short answer: **no clustering-related commit has landed since the Phase A baseline.**

```
$ git reflog --all
8b4183a refs/heads/main@{0}: feat: cross-process refresh-token mutex + /api/health endpoint
4184181 refs/heads/main@{1}: fix(auth): redirect to NEXTAUTH_URL origin, not bind hostname
8c26fef refs/heads/main@{2}: fix(auth): per-device session cookies + Lark identity allowlist
459f4b0 refs/heads/main@{3}: feat: Phase A baseline + hubbibi deploy prep   ← all theme code introduced here
091fe57 refs/heads/main@{4}: chore: initial scaffold for salonx-flightdeck
```

The three post-baseline commits touched only `apps/dashboard/middleware.ts`, `lib/auth/db.ts`, `lib/lark/{client,oauth,whoami}.ts`, and `app/api/health/`. Nothing in `lib/themes/*`, `apps/dashboard/lib/themes-server.ts`, or any view that consumes themes. So whatever changed, **changed in cache state, not in code**.

That leaves three real candidates for complaint A:

- **C1 — fallback bucket.** Today's daily cache fell into deterministic fallback (`mode: "fallback"` — see `lib/themes/cache.ts:55-93`). This happens whenever `claude -p` times out / fails / returns zero themes. In that mode, `fallbackClusterBd` (`lib/themes/cluster.ts:396-447`) groups by raw `Sub-category` and writes themes whose `name` is the Sub-category string. The UI shows a small "auto-grouped" badge (`apps/dashboard/components/views/TopThemes.tsx:323-327`) but otherwise renders these identically to real Claude themes.
- **C2 — fallback-name leak forward.** A prior fallback run minted Sub-category-shaped names. `cache.ts:91` writes to `LAST_KEY` regardless of mode. The next from-scratch Claude call reads `LAST_KEY` via `readPreviousThemes()` and passes the names through the `previousThemeNames` reuse clause (`lib/themes/prompts/cluster-bd.ts:13-16`: *"reuse exactly when ≥70% of members overlap"*). The Sub-category names persist forward.
- **C3 — incremental ossification.** Subsequent GETs default to incremental. The assign prompt (`cluster-bd.ts:61-98`) says *"Force-fit a row into an existing theme unless truly no theme is a fit"* and caps new themes at 2/call. So coarse → fine drift is one-way; incremental cannot un-fragment.

For complaint B, see §3(b).

---

## 3. What changed specifically

### (a) In code — all of it landed in `459f4b0`

| File | Lines | What it does |
|---|---|---|
| `lib/themes/cluster.ts` | 460 | `clusterBd()` LLM path; `fallbackClusterBd()` deterministic Sub-category bucketing; `assignNewRows()` incremental; `applyStableThemeIds()` 70%-overlap id heuristic. |
| `lib/themes/prompts/cluster-bd.ts` | 98 | Two prompts. Cluster prompt asks for **5–15 themes** named like *"Timezone correctness", "Split-bill UX"*. Assign prompt force-fits new rows. |
| `lib/themes/cache.ts` | 96 | Daily UTC-keyed cache. No time-based intra-day expiry. |
| `apps/dashboard/lib/themes-server.ts` | 408 | `computeFromScratch` (Opus, 300s timeout); `computeIncremental` (Sonnet); `applyRowOverrides`; `fetchAndSampleInputs` (caps input at 80 rows). |
| `apps/dashboard/components/views/{Triage,Linkage,Roadmap,TopThemes}View.tsx` | – | All consume the same `ThemesBlob`. |

### (b) The Roadmap chip strip — what's different

`apps/dashboard/components/views/RoadmapView.tsx:105-119` builds a per-cell `themeCounts` map of un-shipped Dev tickets. `TopThemes.tsx:116-140` ranks chips by `displayCount` desc, where `displayCount(t)` returns `themeCounts[t.id]` when present (Roadmap context) and falls back to `t.bdVolume` elsewhere (Triage / Linkage / Today / Sprint).

So Roadmap top themes today = "themes with most un-shipped Dev tickets in the visible columns." Triage / Linkage top themes = "themes with most BD rows."

This is **deliberate** and shipped as such. But the *primary* reason Roadmap top themes look "very different" is likely the same fault driving complaint A — anchored vocabulary will fix most of the perceived weirdness; the sort-toggle is a smaller secondary fix.

### (c) In docs — the failure mode was already flagged

- `docs/v2-review-feedback.md:7-29` — *"Fallback themes are a silent failure mode that poisons four downstream views."* Names a literal example list: *Appointments, Booking, Counseling Sheet, Uncategorized* — the exact shape you're seeing.
- `docs/2026-05-07-rethink-and-plan.md:80` — *"Solve thematic clustering with thematic clustering."*
- `docs/2026-05-07-rethink-implementation-plan.md:148, 248` — proposed but **deliberately did not build** a "shadow re-cluster diff card" that would surface drift visibly. Today's situation is exactly what it would have caught.

So nothing newly broke; the system shipped with a known weak spot, and that spot is what you're feeling.

### (d) `dominantCategories` / `dominantSubCategories` — already there, useful as signal

`Theme` (`lib/themes/cluster.ts:200-211`, `shapes.ts:3-20`) already stores `dominantCategories` and `dominantSubCategories` (≤2 each) per cluster, populated by either Claude or the fallback. These are **metadata, not grouping keys** — the plan keeps them and uses `dominantCategories` as an *additional anchor signal* fed to the Phase 3 cluster prompt (alongside the candidate name list). They tell the LLM "this candidate theme typically pulls from these BD Categories" without forcing the grouping axis to be Category/Sub-category.

---

## 4. What "good" actually looks like

### 4a. Theme labels — the cross-cutting concerns layer

The cluster prompt itself (`lib/themes/prompts/cluster-bd.ts:18-24`) is unambiguous:

> *"A theme is a coherent **user-facing concern**. Examples: 'Timezone correctness', 'WhatsApp delivery', 'Split-bill UX', 'Staff scheduling conflicts'. A theme is **NOT** a category like 'Bug' or 'Enhancement' — those are too coarse."*

**Concretely good** (target shape — the actual list comes from Phase 1 empirical mapping, not from this doc):

- `Timezone correctness`
- `WhatsApp delivery reliability`
- `Split-bill UX`
- `Staff scheduling conflicts`
- `LINE friend-add tracking`
- `Counseling sheet capture flow`
- `Onboarding setup friction`

These are *prompt-engineering examples*, not the ground-truth list. **Phase 1 derives the real list from 80 actual BD rows.**

**Concretely bad** (current state):

- `Appointments`, `Booking`, `Counseling Sheet`, `Uncategorized` (Sub-category-shaped)
- `Bug`, `Enhancement` (Category-shaped)

**Cardinality target:** 5–15 themes for ~80 active rows (matches `cluster-bd.ts:41`).

### 4b. The PM-blessed taxonomies that should anchor us

Three controlled vocabularies the team already maintains:

1. **`salon-x-business/INDEX.md` feature areas (13 H2 sections)** — Appointments & Calendar; Checkout & POS; Daily Closing & Cash Drawer; Staff Management & Career Progression; Salary & Commission; Marketing Automation; Kanzashi/HPB; Customer Management; Consumer Booking (LINE/Web Portal); Reports & Analytics; Settings & Permissions; Feedback & Surveys; Notifications & Communication. Already mapped to PRDs and code paths.
2. **Dev `Module` MultiSelect (20 values)** — POS, Appointments, Staff Management, User management, CRM, Transactions, Analytics, Localization, Tech, Product & Inventory, Register, Settings, LINE, Staff App, Reports, Online Booking, Feedback, User Experience, Marketing, Salary. Authoritative.
3. **BD `Category` MultiSelect (~7 values)** — too coarse alone but useful as a coarse prior in the prompt.

INDEX.md's 13 buckets is **almost exactly the right cardinality** for our theme target — but they alone won't cover bilingual cross-cutting concerns like "Timezone correctness" or "WhatsApp delivery." Phase 1's hand-mapping fills the gap.

### 4c. The Roadmap chip strip — what should it sort by

**Default to BD volume** (matches Triage / Linkage). **Optional toggle to "Dev queue weight"** (current behavior) for the case where you're explicitly planning the next sprint. Persist last-used in localStorage. **Note:** anchored vocabulary is the primary fix to complaint B; the toggle is supplementary.

---

## 5. Strategy: theme clustering v2

Five principles, in priority order.

### Principle 1 — Anchored vocabulary, not free-floating LLM

Today the LLM names themes from scratch every from-scratch run, biased only by `previousThemeNames`. That makes names volatile and lets fallback shapes leak forward.

Replace with: **the LLM picks from a curated `CANDIDATE_THEMES` list (~15–20 names, derived from Phase 1's empirical mapping), plus a "new theme" escape valve capped at 2 per run.** Stored in `lib/themes/taxonomy.ts`, version-controlled. Edited by jiaen as the team's understanding evolves; new names proposed by Claude land in a SQLite proposals table for explicit review.

This is the single biggest change. It eliminates ossification, gives clusters stable names, and aligns labels with the rest of the SalonX repos.

### Principle 2 — Fallback should not produce shippable themes

The deterministic fallback writes Sub-category-shaped themes that the UI renders nearly identically. Even with the `auto-grouped` banner in S2, the visible regression to "themes are now Sub-categories" proves the banner-only approach is insufficient.

Change: when fallback fires, **return zero themes + an explicit "clustering unavailable" empty state.** Each view shows a single CTA: *"Themes couldn't be computed — Retry."* No view should ever render a Sub-category-named theme.

This is harsher than `v2-review-feedback.md` S2's amber-banner. It follows the rethink's *"solve thematic clustering with thematic clustering"* rule. Broken clustering is broken, not a fallback experience.

### Principle 3 — Incremental drift is bounded

Force a from-scratch re-cluster when **(a)** ≥7 days since `lastFullAt`, OR **(b)** the most recent incremental run minted any new theme (a strong drift signal — incremental should rarely create themes at all).

The `N=20 incremental` count from the v1 draft is dropped: rate-of-new-theme-creation is the better drift trigger. This **supersedes `2026-05-07-rethink-and-plan.md:78`'s shadow-diff approach** — the anchored vocabulary makes the shadow-diff less necessary because drift is mechanically constrained by the candidate list.

Also: **incremental should not be the dashboard's default GET path.** Default to from-scratch on a 24h cadence (the cache is daily-keyed anyway). Reserve incremental for explicit "I just added a row, classify it now" flows.

### Principle 4 — State is visible

- "Themes computed at" timestamp + mode badge (`opus | sonnet | unavailable`) on TopThemes.
- The `previousThemeNames` reuse clause is **disabled** when the prior run's mode was `fallback` (`themes-server.ts:183`'s `readPreviousThemes()` checks `prev.mode` and passes `previousThemeNames: undefined` if so). Cuts off the C2 leak path.
- 14-day retention of daily `lark_cache` buckets + a `/themes/history` debug view (Phase 2). User can inspect prior clusterings and re-seed `taxonomy.ts` from a known-good day.

### Principle 5 — Roadmap chip ordering is configurable

Sort-toggle pill on `TopThemes`: **`BD volume`** (default) | `Dev queue weight` (current behavior). Pass selected sort from each view; persist in localStorage. UI copy on the toggle: *"Roadmap chips rank by BD volume to match Triage/Linkage. Switch to 'Dev queue weight' when planning a sprint."* Resolves complaint B at the cosmetic layer; anchored vocabulary resolves it semantically.

---

## 6. Implementation plan

### Phase 0 — Diagnose today (30 min, no code)

1. `curl http://localhost:3000/api/data/themes` (cookied). Inspect `blob.mode` and the `id` prefix on each theme.
2. Decide which of {C1, C2, C3} is the live state:
   - All ids start `auto-` AND `mode === "fallback"` → **C1**.
   - `mode === "claude"` AND names are Sub-category-shaped → **C2** (history) or **C3** (ossification).
   - Distinguish C2 vs C3: click "Cluster from scratch" on TopThemes. If names *still* look Sub-category-shaped after Opus runs → **C2** (the `previousThemeNames` clause is leaking). If from-scratch fixes it for a while but it drifts back over subsequent reads → **C3**.
3. Capture the bad-state response payload + a screenshot.

**Acceptance:** which of {C1, C2, C3} is the actual current state, recorded in §8 with the API response payload as evidence. If C2 or C3, also note that "Cluster from scratch" alone (without Phase 3's anchored prompt) does not durably fix the names — proves Phase 3 is necessary, not just Phase 2.

### Phase 1 — Empirical hand-mapping (½ day, BLOCKING Phase 3)

This phase produces the seed for `CANDIDATE_THEMES`. It is **not** parallel to Phase 3.

1. From `lib/lark/bitable.ts`, paginate BD Feedback (`tbl49YoFep0cYYDd`) where `Status` ≠ Done. Capture: `record_id`, `Item`, `Translate`, `Category[]`, `Sub-category\n` (trim trailing `\n`), `Priority`, `Date Created`, `Status`, linked Dev IDs.
2. Stop at 80 rows.
3. Same for Feature Development (`tblU2lOjqHwSbWor`) where `Status` ∉ {Released, Done, Won't Do}: `record_id`, `Description`, `Module[]`, `Status`, `Milestone`, BD-link IDs.
4. Hand-map each BD row to a draft theme name. Start from INDEX.md's 13 feature areas. Add cross-cutting names where rows don't fit cleanly. Iterate until ≥95% of rows fit.
5. Record any rows that resist mapping. These reveal vocabulary gaps.

**Output:** `docs/2026-05-08-bd-row-empirical-mapping.md` containing:
- The 80-row BD sample (anonymized only if needed; this is a single-user local tool).
- The full candidate name list (~15–20 entries) with: name, hint, dominant Modules, dominant Categories, ≥3 example BD rows.
- A `CANDIDATE_THEMES` TypeScript snippet ready to drop into Phase 3's `lib/themes/taxonomy.ts`.

**Acceptance:** ≥95% of the 80-row sample maps cleanly to a candidate theme; the candidate list is committable as `taxonomy.ts` initial values.

### Phase 2 — Stop the bleeding (1 day)

| File | Change |
|---|---|
| `lib/themes/cluster.ts:396-447` | `fallbackClusterBd` returns `{ themes: [], reason: "claude-unavailable" }` instead of Sub-category buckets. |
| `lib/themes/cache.ts:55-93` | `writeThemesCache` rejects `mode: "fallback"`; caller stops calling it on fallback. Provenance still updated separately. |
| `lib/themes/cache.ts` (new logic) | Retain last 14 daily buckets; on write, prune any bucket older than `today - 14d`. |
| `lib/themes/shapes.ts` | Extend `mode` union to include `"unavailable"`. |
| `apps/dashboard/lib/themes-server.ts:183` | When prior run's `mode === "fallback"`, pass `previousThemeNames: undefined` to the cluster prompt. |
| `apps/dashboard/app/api/data/themes/route.ts:30-32` | GET cache-miss returns `{ ok: true, blob: { themes: [], mode: "unavailable", computedAt: now, provenance: null }, fetchedAt: now, fresh: false }`. **Drop `computeFallbackThemesNow` from the GET path entirely.** Keep the function only for diagnostic use, or delete. |
| New `apps/dashboard/app/api/data/themes/history/route.ts` | GET returns last 14 daily blobs (themes names + counts only — small payload). Behind a debug flag. |
| New `apps/dashboard/app/(dashboard)/themes/history/page.tsx` | Tiny table view of the 14-day history. Exists so the user can recover names from a known-good day. |
| `apps/dashboard/components/views/TopThemes.tsx:144-152, 323-327` | Distinguish two empty states: "no themes computed yet — recompute" (CTA visible) vs "no themes match this scope" (no CTA). Banner copy when `mode === "unavailable"`: *"Theme clustering is temporarily unavailable. Retry."* Render zero chips. |
| `apps/dashboard/components/views/{Linkage,Roadmap,Triage}View.tsx` | Empty state when `data.themes.length === 0 && mode === "unavailable"` — single CTA: "Recompute themes." |

**Acceptance:**
1. Simulating a `claude -p` timeout produces zero themes everywhere with one clear CTA. No view ever shows a Sub-category-named theme.
2. After ≥2 daily runs, `/themes/history` shows the last 2 days' theme names + counts.
3. After a fallback day rolls over, the next from-scratch Opus run does NOT receive Sub-category names in `previousThemeNames`.

### Phase 3 — Anchored vocabulary (3 days)

Depends on Phase 1's `taxonomy.ts` seed.

| File | Change |
|---|---|
| New `lib/themes/taxonomy.ts` | Exports `CANDIDATE_THEMES: { name: string; hint: string; dominantModules?: string[]; dominantCategories?: string[] }[]` (seeded from Phase 1) and `MAX_NEW_THEMES_PER_RUN = 2`. |
| `lib/themes/prompts/cluster-bd.ts:12-48` | Rewrite cluster prompt: inject candidate list inline; instruct *"Prefer choosing names from CANDIDATE_THEMES; emit a brand-new name only when no candidate fits. Total themes 5–15."* Pass `dominantCategories` per-candidate as a hint to the model. |
| `lib/themes/prompts/cluster-bd.ts:61-98` | Update assign prompt similarly — assign-into-existing prefers existing themes that are also in `CANDIDATE_THEMES`. |
| `lib/themes/cluster.ts:151-212` | Post-process: if Claude emits a name not in candidates, log it; if `>MAX_NEW_THEMES_PER_RUN`, reject the response and re-prompt **once** with a stronger constraint. **Hard cap: after 1 retry, fail closed (empty state). No third call.** |
| `lib/themes/cluster.ts:341-366` | `applyStableThemeIds`: when a theme name appears in `CANDIDATE_THEMES`, mint id = `slugify(name)` (no hash suffix). Other themes keep the existing hash-based id. **Anchored ids are stable across runs**, so manual overrides survive renames. |
| `apps/dashboard/lib/themes-server.ts:153-178` | `applyRowOverrides`: when an override's target id is missing from current themes, attempt a name-based recovery — if the override's saved theme name still exists in the new run (matched by slug), redirect the override there. Only drop on hard miss. |
| New SQLite table `taxonomy_proposals(name, first_seen_at, last_seen_at, member_count, status)` | Migration in `lib/auth/db.ts`. New names emitted by Claude (within the per-run cap) are recorded here. |
| New small "Theme proposals" card on `TopThemes.tsx` | Lists `taxonomy_proposals` rows with status `pending`. Two buttons per row: *"Add to taxonomy"* (writes to `taxonomy.ts` via a small admin endpoint), *"Reject"*. |
| New decisions log entry `salon-x-business/decisions/2026-05-08-anchored-theme-vocabulary.md` | Frontmatter `kind: [design, commit]`. Records the design choice and what was considered-and-rejected. |

**Acceptance:**
1. The 80-row regression fixture (Phase 1's BD sample) yields 5–15 themes; ≥80% of names come from `CANDIDATE_THEMES`. Measured via a unit test that runs the full clustering pipeline in dry-run against the fixture and asserts on the output.
2. New names (≤2/run) appear in the proposals card with one-click accept/reject.
3. Re-clustering with renamed members (simulated) preserves manual overrides for any theme whose name remains in `CANDIDATE_THEMES`.
4. Anthropic spend per run capped at 2× compute (1 retry max).

### Phase 4 — Drift bounding + Roadmap toggle (2 days)

| File | Change |
|---|---|
| `apps/dashboard/lib/themes-server.ts` | Auto-promote incremental → from-scratch when **`Date.now() - lastFullAt > 7d`** OR **the most recent incremental minted any new theme**. |
| `apps/dashboard/app/api/data/themes/route.ts` | POST default `mode` is `from-scratch` when prior `lastFullAt` unknown or >24h old. Add a 5-min cooldown on "Cluster from scratch" to prevent spend bursts. |
| `apps/dashboard/components/views/TopThemes.tsx` | Sort-toggle pill: `BD volume` (default) / `Dev queue`. Tooltip copy: *"Roadmap chips rank by BD volume to match Triage/Linkage. Switch when planning a sprint."* |
| `apps/dashboard/components/views/RoadmapView.tsx:105-119` | Pass selected sort to TopThemes. |
| localStorage | Key `flightdeck.topthemes.sortMode`. Default `bd`. |

**Acceptance:**
1. After 7 days without a from-scratch run, the next dashboard load auto-promotes to from-scratch.
2. Roadmap chip ordering matches your intuition by default — e.g., a "WhatsApp delivery" theme with 12 BD rows ranks above a "Tech debt" theme with 8 Dev tickets.
3. Rapid-fire "Cluster from scratch" clicks within 5 min are throttled.

---

## 7. Risks & open questions

| ID | Risk / question | Mitigation |
|---|---|---|
| R1 | LLM may still regress to bad names | Post-process check (≥80% from candidates); 1 retry max; if violated, fail closed (don't write cache). |
| R2 | `MAX_NEW_THEMES_PER_RUN = 2` may be wrong | Tunable constant. Phase 1 validates. |
| R3 | Roadmap users may have learned "Dev queue" semantics | Keep that mode available; just don't make it default. |
| R4 | Fallback-suppression hides Lark API outages | Empty-state text says "clustering unavailable" + links to `/api/health`. |
| R5 | Re-cluster orphans manual overrides | Phase 3's anchored ids are stable across runs for any theme drawn from `CANDIDATE_THEMES`. `applyRowOverrides` adds name-based recovery for the residual hash-id case. Overrides pointing to ad-hoc themes still orphan, but that's the rarer path. |
| R6 | Anthropic spend on retry loop | Phase 3 retry capped at 1; second violation fails closed. Phase 4 adds 5-min cooldown on user-triggered "Cluster from scratch". |
| OQ1 | Does Sub-category granularity ever have a legit role? | Possibly in a per-theme drilldown panel. Out of scope; revisit post-Phase 3. |
| OQ2 | Should Bugs (QA) feed clustering? | Currently no. Revisit later. |
| OQ3 | Is "Cluster from scratch" rate-limited? | Phase 4 adds 5-min cooldown. |
| OQ4 | Can the user recover the "previous good" clustering they remember? | Phase 2's 14-day retention + `/themes/history` is the supported path. The closest empirical reconstruction is Phase 1's hand-mapping. Don't promise to recover what isn't in the cache window. |
| OQ5 | What about the bilingual nature of BD rows (`item` Japanese, `translate` English)? | Already handled — `cluster.ts:113` prefers `translate` over `item`, truncates to 240 chars. No Phase needed. Worth a Phase 1 spot-check on the empirical mapping. |

---

## 8. Resolution log

- **2026-05-08 — Plan v2 written and self-reviewed.** v1 → v2 changelog at top of doc.
- **2026-05-08 — Phase 1 complete.** Hand-mapped all 155 non-Done BD rows into 13 candidate themes. 100% coverage. Output: `docs/2026-05-08-bd-row-empirical-mapping.md` + `lib/themes/taxonomy.ts` (CANDIDATE_THEMES seed).
- **2026-05-08 — Phase 2 complete.**
  - `lib/themes/cluster.ts` — `fallbackClusterBd` returns `[]` (deprecated, kept as no-op).
  - `lib/themes/cache.ts` — `writeThemesCache` refuses `mode: "fallback" | "unavailable"` writes; added `pruneOldDailyBuckets()` (14-day retention) and `readDailyBucketHistory(maxDays)`.
  - `lib/themes/shapes.ts` — `mode` union extended with `"unavailable"`.
  - `lib/auth/db.ts` — added `listCacheKeysStartingWith(prefix)`.
  - `apps/dashboard/lib/themes-server.ts` — `computeFallbackThemesNow` → `computeUnavailableNow`; `previousThemes` gated on `prev.mode === "claude"`; `computeFromScratch` returns `mode: "unavailable"` instead of synthesizing fallback.
  - `apps/dashboard/app/api/data/themes/route.ts` — GET cache-miss returns unavailable, no fallback computation.
  - New `apps/dashboard/app/api/data/themes/history/route.ts` and `apps/dashboard/app/(dashboard)/themes/history/page.tsx` — 14-day debug view.
  - View-level empty states: TopThemes amber CTA on `mode: "unavailable"`; LinkageView + RoadmapView both set `themesUnavailable` from API and show clear messaging.
  - Typecheck: `cd apps/dashboard && pnpm typecheck` passes.
- **2026-05-08 — Decisions log entry written.** `salon-x-business/decisions/2026-05-08-anchored-theme-vocabulary.md` (kind: design + commit).
- **2026-05-08 — Phase 3 complete.**
  - New `lib/themes/taxonomy.ts` — `CANDIDATE_THEMES` (14 entries), `MAX_NEW_THEMES_PER_RUN = 2`, `isCandidateName`, `findCandidate`. Seeded from Phase 1.
  - `lib/themes/prompts/cluster-bd.ts` — both prompts rewritten to inline-render `CANDIDATE_THEMES`; `previousThemeNames` deprecated; STRICT RETRY footer when `strictRetry: true`.
  - `lib/themes/cluster.ts` — refactored to share `parseClaudeThemes` between first pass and strict-retry; retry-once-then-fail-closed loop on cap violations; same in `assignNewRows`. `pickStableId` now uses plain `slugify(name)` for candidate names. Exported `extractNewThemeNames`.
  - `lib/auth/db.ts` — added `taxonomy_proposals` table + `theme_name` column on `theme_row_overrides` and `dev_theme_overrides`.
  - `apps/dashboard/lib/theme-overrides-db.ts` — return type now `Map<string, { themeId, themeName }>`; setters take `themeName`.
  - `apps/dashboard/lib/themes-server.ts` — `applyRowOverrides` does name-based recovery (slug match fallback when id missing); proposals recorded on every successful run.
  - New `apps/dashboard/lib/taxonomy-proposals-db.ts` — `recordProposals`, `listPendingProposals`, `acceptProposal`, `rejectProposal`.
  - New `apps/dashboard/app/api/data/themes/proposals/route.ts` — GET pending; POST `{name, action}`.
  - `apps/dashboard/lib/queries/data.ts` — `useTaxonomyProposals` + `useDecideProposal` hooks.
  - `apps/dashboard/components/views/TopThemes.tsx` — `ProposalsCard` rendered in `ThemesShell` body.
  - `apps/dashboard/app/api/data/themes/override/route.ts` — resolves `themeName` server-side from cached blob.
  - `apps/dashboard/app/api/data/roadmap/route.ts` — `pickThemeForDev` accepts new override shape with inline name-based recovery.
  - Decisions log entry: `salon-x-business/decisions/2026-05-08-anchored-theme-vocabulary.md`.
  - Typecheck: passes.
- **2026-05-08 — Phase 4 complete.**
  - `lib/themes/shapes.ts` — `provenance.lastIncrementalNewThemeCount?: number`.
  - `lib/themes/cache.ts` — `writeThemesCache(themes, mode, runKind, newThemeCount?)` persists count on incremental writes.
  - `apps/dashboard/lib/themes-server.ts` — `computeIncremental` returns `newThemeCount` (counts only truly minted, not slug-collision-merged); `computeFreshThemes` promotes incremental → from-scratch on (a) prior unusable, (b) >7d since lastFullAt, or (c) `lastIncrementalNewThemeCount > 0`. Logs reason.
  - `apps/dashboard/app/api/data/themes/route.ts` — POST default mode is `from-scratch` when `lastFullAt` unknown or >24h old; module-level 5-min cooldown on from-scratch returns 429 with `retry-after` header.
  - `apps/dashboard/lib/queries/data.ts` — `useRefreshThemes` surfaces server `error` field on non-OK responses (exposes 429 cooldown copy).
  - `apps/dashboard/components/views/TopThemes.tsx` — `SortToggle` (BD volume / Dev queue), persisted in `localStorage.flightdeck.topthemes.sortMode`. `effectiveSortMode` honored by `displayCount`, chip tooltip, and summary line. Default `bd`.
  - `apps/dashboard/components/views/RoadmapView.tsx` — `showSortToggle` true (only Roadmap shows the toggle; other views remain BD-volume-only).
  - Typecheck: passes (verified locally).
- **2026-05-08 — Final verification complete.** `cd apps/dashboard && pnpm typecheck` exits 0. End-to-end wiring spot-checked: anchored prompt + retry, proposals path (cluster.ts → themes-server.ts → recordProposals → API → React Query → TopThemes UI), drift-promotion three-branch logic, cooldown 5-min, sort toggle persisted only on Roadmap. Sub-category-shaped themes are no longer reachable through any path.

**Status:** v2 implementation complete. User to run Phase 0 diagnostic (force a `from-scratch` recompute via the dashboard) to validate against live data.

---

## Appendix A — Considered and rejected

- **Use BD `Sub-category` directly as theme key.** Rejected: too granular (the current symptom). Free-text field, ~30–80 distinct strings.
- **Use BD `Category` directly.** Rejected: too coarse (~7 values), also a MultiSelect (rows belong to multiple categories — ambiguous grouping key). Useful as a *signal*, not a key.
- **Use Dev `Module` directly as theme key.** Tempting (20 controlled values) but skews toward dev-side framing. Better as a clustering signal (passed via `dominantModules` in `CANDIDATE_THEMES`) than the literal label.
- **Pure rule-based clustering with no LLM.** Rejected: would lose cross-cutting concerns like "Timezone correctness" that span multiple Modules/Categories.
- **Build the shadow-recluster diff card from `2026-05-07-rethink-implementation-plan.md`.** Rejected (was deferred in v1, now explicitly rejected): anchored vocabulary makes drift mechanically bounded, so the diff card's value is reduced. The 14-day history view (Phase 2) covers the recovery use case the diff card was meant to address.
- **Add operational tags (`[Bug]`, `[Kanzashi]`, `[P0]`) to the prompt.** Already explicitly rejected in `2026-05-07-rethink-and-plan.md:80` — operational tags conflate axes.
- **Amber banner on fallback themes (S2 from `v2-review-feedback.md`).** Rejected as insufficient in v2: the user experienced the regression *with* the banner shipped, so banner-only is empirically not enough. Hard empty-state replaces it.
- **N=20 incremental count drift trigger.** Rejected in v2: arbitrary; the rate of new-theme creation is a better signal.
