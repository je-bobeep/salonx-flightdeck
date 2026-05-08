# Rethink + Plan — 2026-05-07

A re-evaluation of flightdeck's direction prompted by four owner-stated frictions:

1. The Scope feature feels heavyweight vs. running `claude` in a fresh terminal at the repo root.
2. The portal could be more useful as a thinking surface — timeline of the roadmap, theme/cluster progress, BD context aggregation.
3. The "Re-cluster" button doesn't add an obvious new BD row (e.g. `[Kanzashi] Show cancellation reason`) into the existing Kanzashi cluster — it recomputes from scratch.
4. ETA is single-valued today; we need to separate the **external commitment** (what Asano-san cares about) from the **internal merge target** that drives dev workload planning.

This doc captures the synthesised conclusions from a four-topic research pass + a strict PM critique, and locks the scope of v1 work that lands in this exercise. A separate implementation plan (next file) breaks the work into executable tasks.

---

## TL;DR — what changes and what doesn't

| Area | Verdict | Status |
|---|---|---|
| In-portal Scope feature | **Keep, instrument, revisit in 4 weeks.** Don't delete. | Land usage telemetry only. |
| Lark thread context fetch | **Build** — minimal v1 per critic (drop signal extraction). | In v1. |
| Incremental re-cluster | **Build** — incremental default, drop prefix-tag short-circuit, add shadow-diff prompt. | In v1. |
| Dual ETA | **Build** — but flightdeck-local "Internal target" (SQLite), not a Lark Base field. | In v1. |
| Decisions / closed-loop view | **Defer to v1.5** — flagged as the missing north-star. | Out of v1. |

Net build: ~4 work items, none of them green-field. Each replaces or extends a surface that already exists.

---

## 1. The Scope feature is on probation, not on the chopping block

**Where the doubt is real.** Roughly 70% of the in-portal scoping value is reproducible in a terminal `claude` session if the user has a kickoff template + global MCP config + UAT in env. The unique 30% is (a) propose-then-approve quarantine, (b) per-flow tool allowlist, (c) browsable session history.

**Why we don't delete now.** Three reasons, each load-bearing:

- **The 2026-05-05 pivot defined scope as one of three pillars.** Killing it three weeks in collapses flightdeck to a Lark Base read-only viewer + a thread fetch. The remaining surface is too thin to justify the portal at all.
- **No usage data exists yet.** We don't know whether scope sessions are run 0×/week or 5×/week. Deleting ~2,200 LOC of probe-validated code (HMR-safe `globalThis` registry, atomic `claimProposedAction`, stream-json protocol probe) on a hunch is asymmetric — re-deriving it costs a week, the wrong call costs ~2,200 LOC of dead weight.
- **A "click to copy a kickoff prompt" replacement is worse than nothing.** It adds friction (alt-tab, paste, lose ticket panel context, no approve gate, no audit) versus the current click-and-converse, *and* it's worse than a pure terminal workflow because now there's a button pretending to be a feature.

**What we do instead — instrument.** Add usage logging to the existing scoping plumbing: sessions started, sessions reaching first propose-action, propose-actions approved-vs-abandoned, mean turns per session. Surface a small "Scope usage (last 30 days)" tile in the existing Sessions view. Revisit deletion in 4 weeks against the data: if approved propose-actions per week stays under 1, delete in cold blood. Until then, the feature lives.

**Done means:** four counters tracked in SQLite, one tile in `SessionsView.tsx`, no other code changes to the scoping path. Lowest possible cost to make the right delete decision later.

---

## 2. Lark thread context fetch — minimal v1

The owner asked for this verbatim ("let me click a button to fetch all messages under that topic so it can gather all the context"). It directly attacks the "BD row is opaque" pain that motivated the whole portal, and we already have the data linkage we need.

**The data linkage is already there.** The poller writes `bd_record_id`, `chat_id`, `message_id`, `thread_id` into `poller_ingest_log` (see `lib/services/lark-poller/state.ts:115-148`). A reverse-lookup helper (`getIngestByBdRecordId`) is the only missing piece — no Lark Base backfill needed.

**What we build.**

- New SQLite cache table `lark_thread_cache` keyed by `thread_id`: `messages_json`, `fetched_at`, `bd_record_id`. **TTL 24h**, manual refresh button (down from the proposed 60 min — threads don't move that fast and we want fewer Lark API calls).
- Extend `listChatMessages` in `lib/lark/im.ts` to accept `containerIdType=thread` + a thread `containerId`. Auto-paginated up to 200 messages.
- New route `GET /api/data/bd/[recordId]/thread`: looks up source message via `poller_ingest_log`, fetches thread (cached), returns parent + replies sorted oldest-first.
- New collapsible "Thread context (N replies)" card inside `BdSummary` in `TicketPanel.tsx`. Shows: a one-line Claude summary at the top, then the raw transcript (sender · timestamp · text). Non-text replies render as `[image]` / `[file: name.pdf]` placeholders so missing media is visible, not silently dropped.
- Thread summary uses `runClaudeOneShot` with a small prompt — single sentence output, ≤ 30 words, no JSON. No structured signal extraction.

**What we explicitly do *not* build (per PM critic).** The v2 "structured signal extraction" (impliedDeadline, urgencyLevel, customerNames as badges in TriageView) is dropped. It's a prompt-drift trap that produces confident-but-wrong badges, the owner did not ask for it, and it tempts write-back which collides with the "Lark Base is the source of truth" invariant.

**For BD rows created manually in Lark UI (not via poller):** show "No source thread for this row" instead of trying to fuzzy-match by item text. Don't be clever.

---

## 3. Incremental re-cluster — fixed default, smarter drift detection

**Root cause confirmed.** `lib/themes/cluster.ts` does a fresh recompute every run. Only theme *names* leak forward (`pickStableId` is post-hoc id stabilisation, not a membership anchor). New rows like `[Kanzashi] Show cancellation reason` are at the mercy of Claude rediscovering the right theme — which it doesn't always do.

**What we build.**

- `clusterBd` gains a `mode: "incremental" | "from-scratch"` parameter. Default of the existing public API stays `from-scratch` (callers must opt in to incremental), but the dashboard route picks `incremental` by default.
- New helper `assignNewRows({ newRows, existingThemes })` for the incremental path. Sends Claude only the **NEW** unclustered rows + a compact catalog of existing themes (id, name, description, ≤3 example items). Output: `{ assignments: [{ record_id, theme_id }], newThemes: [...] }`. Existing assignments are sticky.
- Cap new themes per call at 2 (forces preference for assignment over creation).
- Gate incremental on `previousBlob.mode === "claude"`. If the previous run was `fallback` (deterministic sub-category grouping), the catalog is incoherent — force `from-scratch`.
- "Cluster from scratch" is a less-prominent link in the `TopThemes` header (not the primary button) with a confirm dialog.
- Per-row "Move to theme..." action in the slide-over `TicketPanel`. Persists as a manual override; survives incremental, applied post-hoc on scratch.
- `ThemesBlob` gains `provenance: { lastFullAt, lastIncrementalAt, incrementalSinceFull }`.

**Drift detection — shadow recluster, not stale banner.** The original proposal's "banner after N=20 incrementals" is alert-fatigue bait. Replace with: every 14 days (or every Nth incremental, whichever first), the cluster compute path runs a *shadow* full recluster in the background and compares to current state. If ≥3 rows would move themes, surface an actionable card on the Roadmap view ("3 BD rows are in different themes if reclustered from scratch — review?"). Converts a passive nudge into a decision prompt.

**What we explicitly do *not* build (per PM critic).** The deterministic `[Kanzashi]` prefix-tag short-circuit. `[Bug]`, `[P0]`, `[Kanzashi]` are operational tags, not thematic ones; routing on them conflates two orthogonal axes and creates a "Kanzashi" theme that's actually "things tagged Kanzashi during a busy week." Solve thematic clustering with thematic clustering.

---

## 4. Internal target date — flightdeck-local, not a Lark schema change

Per PM critic: adding `Internal ETA` to Lark Base permanently changes a shared table to test a hypothesis the owner could test in a private SQLite column. Schema changes are sticky; once a field exists, deleting it requires explaining to the team why. So:

**What we build.**

- New SQLite table `dev_internal_target` keyed by `dev_record_id`: `target_date` (ISO), `set_at`, `notes`.
- `DevRow` wire shape gains `internalTargetDate: string | null` populated from this table at server-render time.
- `TicketPanel.tsx` editable "Internal target" date field for Dev rows, sitting just below the existing ETA field. Editable inline. No T-shirt auto-suggest (skip the proposed default-table; that's solving a typing problem, not a thinking problem).
- Two new aging signals in `lib/lark/aging.ts`: `dev-internal-target-passed` (red) and `dev-internal-target-imminent` (≤3 days, amber). Surfaced via existing `AgingBadges` rendering — no new chrome.
- `RoadmapView.tsx` ticket row: shows internal target as the primary date with a hover tooltip revealing external. Red dot if internal-target passed. Amber dot if internal passed but external not yet (the most common slip-warning state). External-overdue stays red.
- `SprintView.tsx` `noEta` aging signal flips to check internal target first, falling back to external. Headline number on the Today view follows.

**Drift handling.** When external ETA edits, do NOT auto-shift internal. Show a one-line drift chip in the panel only when external moves *past* internal (a state change), not on every external edit — avoids alert fatigue.

**What we explicitly do *not* build (per PM critic).** The Lark Base `Internal ETA` field. The T-shirt-sizing default-suggestion table. The per-assignee per-sprint capacity bar (deferred to v1.5 once we know the field is filled in regularly). The Gantt timeline view (deferred indefinitely).

---

## 5. The thing this exercise underweights

The critic's strongest point: every proposal here adds *input fidelity* — better thread context, more stable clusters, sharper ETA semantics, scope-feature usage data. None of them produce *output* — a decided BD row, a closed loop with a merchant, a shipped feature. The original pain ("I'm losing visibility, and so is leadership") implied "see more"; what the owner actually needs is "decide more, faster."

**Action: out of v1 scope, but flagged for v1.5 design.** Add a "Decisions" view that surfaces decisions made / deferred / overdue per week — and impose a hard rule on future feature work: if it doesn't measurably move those numbers, it gets cut. Without that, flightdeck risks becoming a beautifully-instrumented inbox.

This isn't built in this exercise — but it's the thing that gates whether *any* of these four items proves out.

---

## Build order in this exercise

The PM critic recommended **B + C first, D second after 2 weeks of usage data, A as instrument-only**. In an autonomous one-shot session, all four are landing together because:

- **A (instrument)** is small (4 SQL counters + a tile) and unblocks the right delete decision later.
- **B + C** are the immediate pain-fixers the owner asked for verbatim.
- **D-light (SQLite-only)** is small enough that landing it alongside B/C is faster than sequencing it. The critic's concern was the Lark schema risk — by going SQLite-local we sidestep it.

Everything ships behind feature-detection (e.g. if `lark_thread_cache` table doesn't exist on first dev-server boot, it's created idempotently — no migration ceremony).

---

## Out of scope for this exercise

- Killing or replacing the Scope feature.
- Lark Base schema changes.
- Structured signal extraction from threads (no impliedDeadline / urgency badges).
- Prefix-tag short-circuit for clustering.
- Gantt timeline view, per-assignee capacity bars, T-shirt-sized default buffers.
- The "Decisions" view (designed conceptually here, not built).

---

## Risks signed off on

- **Incremental cluster drift.** If owner never triggers the scratch run and the shadow-diff card gets ignored, themes will ossify around old wording. Mitigation: shadow diff is actionable (one click to apply), not a passive banner.
- **Internal target field becoming ceremonial.** Median (external − internal) < 1 day after a month means the buffer concept isn't working. Mitigation: track fill-rate as part of the same usage instrumentation we add for scope sessions; revisit in 4 weeks.
- **Thread fetch hits non-text content the user actually needs (screenshots, voice notes).** v1 surfaces placeholders only; user has to open Lark to see the real artifact. Acceptable because the alternative (image OCR, voice transcription) is a much bigger build for the same one-click "show me everything" affordance.
- **Scope feature stays alive on inertia.** The instrumentation exists specifically to prevent this — if data shows < 1 approved propose-action / week after 4 weeks, delete. Make the deletion a calendared decision, not a vibe.
