# v2 PM Review — Synthesized feedback

**Date**: 2026-05-06.
**Reviewers**: 4 parallel "lead PM" agents — Today+Triage, Linkage+Roadmap, Sprint+Sessions, Scope flow.
**Method**: code + live API review (auth blocks browser rendering, so no playwright).

## Top-line themes

Across all four reviews, three patterns dominate:

1. **Fallback themes are a silent failure mode that poisons four downstream views.** Triage, Linkage, Roadmap, and Today all consume `useThemes()`. When Claude clustering times out, the deterministic `fallbackClusterBd()` produces themes named after raw sub-categories (`Appointments`, `Booking`, `Counseling Sheet`, `Uncategorized`) with `rising: false` baked in. The UI surfaces them with the same visual treatment as Claude-clustered themes — including the `Sparkles` "Top themes" framing. The PM thinks "no rising themes" when the truth is "no real clustering happened." Every theme-dependent signal (`risingNotOnRoadmap`, `uncoveredImmediateThemes`, the demand-rising banner) is structurally dead in fallback mode without any UI cue.
2. **POC merchant signal is everywhere in the data and nowhere in the headlines.** The whole point of the dashboard is "did we forget Asano-san's request" but `pocCount` shows up only as a neutral helper line on Today and never as a headline branch on Triage or Today.
3. **Sessions is read-only when it should be the inbox.** Rows have no `onClick`. Pending proposed actions are invisible at the list level. There's no resume affordance. The view fails its literal JTBD.

## P0 — must fix to ship

### S1. Session_id injection is broken (Scope flow)

**Impact**: every `propose_*` tool call fails the first time it's invoked, in every scoping flow.

**Verified**: `lib/claude/prompts/bd-to-dev.ts:113` says `Important: when calling any propose_* tool, always pass session_id (you'll receive it via the user's first message)`. The opener message persisted at `app/api/scoping/session/route.ts:195` does NOT contain the session id. The user message in `app/api/scoping/turn/route.ts:53` is forwarded verbatim. Claude has no way to know the session id.

**Fix**: inject `Session id: ${sessionId}.` into the system prompt at session-create time.

### S2. Surface fallback-theme state in UI (Triage / Linkage / Roadmap / Today)

**Impact**: PM acts on misleading clusters; treats "Uncategorized" as a coverage gap; trusts `risingNotOnRoadmap=0` when no clustering happened.

**Fix**: API `/api/data/themes` already returns the blob — extend with a `mode: "claude" | "fallback"` field derived from `id.startsWith("auto-")` on every theme. UI: render a 1-line muted banner above each theme-driven section ("Themes are auto-grouped by sub-category — Re-cluster for cross-cutting view"). Hide the "Uncategorized" theme cell. Disable the "rising" badge in fallback mode.

### S3. Sessions rows must resume the session (Sessions)

**Impact**: closing the slide-over abandons the session. Literal JTBD failure.

**Fix**: each `<li>` in `SessionsView.tsx:43-67` gets an `onClick` that navigates to the originating panel with `?session=<id>&panel=<ticketRecordId>&kind=<kind>&flow=<flow>`. Surface `pendingActionCount` per session as a warn badge by extending `api/data/sessions/route.ts:18-25` with a LEFT JOIN on `proposed_actions`.

## P1 — meaningful efficacy wins

### S4. POC merchant as a first-class urgency signal (Today + Triage)

**Today** (`TodayView.tsx:267-281`): add a headline branch above the BD-stale branch — `if (bdPocStale >= 3) { tone: "warn", label: "POC merchant rows waiting" }`. Compute `bdPocStale = bdUnaddressed.filter(r => r.fromPocMerchant && (r.ageDays ?? 0) > 14).length` in `today/route.ts:39`.

**Triage** (`TriageView.tsx:94-116`): add a branch — `if (pocCount >= 3 && stale30 === 0) { value: pocCount, label: "POC merchant rows waiting" }`.

### S5. Headline ladder: relax noEta-% trigger and add stale-30 priority (Today)

**Issue**: `Today.pickHeadline` fires the noEta alarm at `noEta/active >= 0.5`. With small sprints (2/3 active) this triggers constantly. Meanwhile `stale30d=23` BD rows is the long-tail failure the dashboard exists to prevent.

**Fix** (`TodayView.tsx:249-281`): require both ratio + absolute floor — `sprint.active >= 5 && sprint.noEta >= 3 && ratio >= 0.5`. Add `bd.stale30d > 10` as a higher-priority branch.

### S6. Sessions: pending actions visible at list level

Cover above in S3. Doubles the list's value: it becomes a "pending approvals" inbox.

### S7. Truncate long Japanese-translation row text more gracefully (Triage)

**Issue**: `item` / `translate` rows can be 200+ chars. `truncate` cuts mid-word; the secondary line is also truncated. PM can't skim a band.

**Fix** (`TriageView.tsx:271-278`): clamp primary to `line-clamp-2`, drop the secondary when both are present, hover-reveal full text via `<span title={...}>`.

### S8. Sub-group labels carry counts of POC / aged / oldest (Triage)

**Fix** (`TriageView.tsx:212-220`): render `APPOINTMENTS · 11 · 3 POC · oldest 92d` instead of just label + count.

### S9. "Scope this whole theme" CTA on Triage

When `selectedTheme` is set, add a button next to the filter banner that opens the panel with the theme's `bdRecordIds` seeded into `bd-to-dev` flow.

### S10. Roadmap "Now" column unthemed pile

**Issue**: live data shows the first `now` cell with `theme: null`, `pull: 0, push: 16` — 16 unthemed tickets in one block.

**Fix** (`api/data/roadmap/route.ts:96-116`): augment `pickThemeForDev` to also match `dev.module` / `dev.product` against `theme.dominantCategories/dominantSubCategories` (case-insensitive overlap). When `theme === null`, sub-group by `dev.module[0] ?? dev.milestone`.

### S11. Roadmap banding: in-flight overdue tickets stay in "Now"

**Issue**: ticket with past `eta` and `status=In Progress` lands in `soon` (`route.ts:53-55`).

**Fix**: change the missed-ETA branch to `return isInFlight(dev.status) ? "now" : "later"`, pass an `overdue: true` flag through `RoadmapTicket`, render a small overdue dot in `RoadmapCellView`.

### S12. `risingNotScheduled` under-fires (Roadmap)

**Issue**: a theme with 12 BDs and 1 token Dev ticket counts as "scheduled" and silences the rising banner.

**Fix** (`api/data/roadmap/route.ts:214-216`): change to `t.rising && (coveredBdCount / max(bdVolume, 1) < 0.3)`.

### S13. Linkage "Active linkages" duplicates pairs

**Issue**: a Dev linked to 3 BDs renders as 3 pair rows.

**Fix** (`linkage/route.ts:34-43` or `LinkageView.tsx`): group active pairs by `dev.recordId` for rendering — each Dev shows once with stacked BD chips. Or replace section with per-Dev "Active deliveries by ETA."

### S14. Mandatory duplicate-search in bd-to-dev (Scope)

**Issue**: prompt makes `lark_search_feature_dev` "optional" — Claude skips it on most turns.

**Fix** (`lib/claude/prompts/bd-to-dev.ts`): change to "Always call `lark_search_feature_dev` with 2-3 keyword variants drawn from the BD title before drafting."

### S15. One proposal per assistant turn (Scope)

Prompt rule: "Propose at most one action per assistant turn." Prevents stacked pending actions.

## P2 — quality-of-life

### S16. Theme awareness on Sprint view

Sprint is the only post-v2 view that doesn't consume `useThemes()`. Add a theme chip per row in `AssigneeBlock`.

### S17. Promote pair-sanity to icon button on Sprint rows

Currently buried as a tiny inline text link.

### S18. Reposition Sprint as "Sprint health"

Drop the side-by-side "Next" column (Roadmap covers it). Single dense by-assignee view of current sprint with no-ETA-% headline.

### S19. Drop or replace `bd.newLast7d` in Today

Static count is uninformative; replace with 7d-vs-prior-4w delta or remove.

### S20. Diff preview on `update_bd_status` approve cards

"Logged → Declined" instead of just "Declined."

### S21. Stuck-detection covers all aging kinds (Sprint)

`SprintView.tsx:81-83` only matches `kind === "dev-status-stale"`. Generalize to any `r.aging.length > 0` (minus the noEta count already in the danger branch).

### S22. Persist weekly-review pipelineSummary on resume

Currently the summary is computed at session-create then lost on resume.

### S23. Server-side validator for Story description shape

Reject in approve route if `story_description` doesn't contain Background/Goal/AC/Out-of-Scope/Reference headings.

### S24. Sessions filters + delete

Filter chips for `flowType` / `status`; row-level menu for "Mark closed" / "Delete." Surface duplicate hint when ≥2 active sessions share `(flowType, ticketRecordId)`.

### S25. Auto-refresh ChatShell while pending action exists

Multi-tab consistency.

## What I'm shipping in this pass

Picking the smallest set of changes that maximally moves efficacy:

- **S1** (session_id injection — P0 correctness bug)
- **S2** (fallback-theme banner — kills the silent-failure mode across 4 views)
- **S3 + S6** (Sessions resume + pending-action badge — fixes a literal JTBD failure)
- **S4** (POC merchant headline branches — small change, big PM-mental-model alignment)
- **S5** (Today headline ladder — removes a constant false alarm)
- **S10** (Roadmap unthemed grouping — kills the 16-row "Now" pile)
- **S11** (Overdue in-flight stays in "Now" — banding sanity)
- **S12** (Rising signal counts coverage ratio — banner fires when it should)
- **S14 + S15** (Scope prompt: mandatory duplicate-search + one-proposal-per-turn — Claude reliability wins)

Deferred to a later pass (still tracked here): S7-S9, S13, S16-S25.
