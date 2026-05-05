# salonx-flightdeck — Scope

A working document for what salonx-flightdeck is, what it isn't, and what to build first. Most architectural questions from the prior pm-copilot draft are now decided and locked; remaining open questions are flagged inline.

> **Naming history.** This doc was originally drafted as `pm-copilot-scope.md`. Renamed to avoid collision with the product team's broader pm-copilot initiative. "Flightdeck" captures both the dashboard role ("see all flights in progress") and the ops home ("where ops happen").

---

## Background

The SalonX PM workspace is split across three repos, all of which are docs/code reference hubs with no automation:

- **salon-x** — production codebase. Cleaned up; PM artifacts removed.
- **salon-x-business** — PM docs hub. PRDs, specs, prototypes, release notes, kanzashi material, memory files, Claude Code skills/agents/commands.
- **salonx-kb** — Docusaurus knowledge base. EN-first authoring, JA-translated published.

Today, every PM workflow that touches these repos runs as a **manual Claude Code session** that I trigger. This works for week-1 volume but doesn't scale — the same loops repeat daily.

There are also **two acute pains** that have surfaced over the last few weeks:

1. **BD Feedback queue visibility.** Feature requests are flowing in from Asano-san and merchants faster than I can triage. The Lark BD Dashboard is structured around release artifacts (released items, ETAs), not around the decisions I'm trying to make ("what's still unaddressed", "is this strategic or polish", "did we forget about this for 3 weeks"). I'm losing visibility, and so is leadership.
2. **No home for net-new automation.** Once I do start building event-triggered workflows, they need a place to live that isn't salon-x or salon-x-business or salonx-kb.

salonx-flightdeck answers both: a single-user dashboard that solves pain #1 today, and a repo that solves pain #2 as workflows come online.

---

## Goals

Two intertwined goals:

1. **Visibility & strategic planning.** Give myself a live, opinionated view of the BD Feedback queue and the Feature Dev pipeline so I can triage faster and communicate clearly with stakeholders.
2. **Automation home.** Provide a place for net-new event-triggered workflows that don't have a natural home in the existing repos.

**Success criterion for v1:** the dashboard renders BD Feedback + Feature Dev data live, supports basic triage write-backs (status, priority, link-to-dev-ticket), and saves real time within 1 week of standup.

---

## Non-goals

To stay focused, salonx-flightdeck v1 is explicitly **not**:

- A replacement for the manual Claude Code skills in `salon-x-business/.claude/` or `salonx-kb/.claude/`. Those continue to exist and run as Claude Code sessions.
- A general-purpose PM dashboard for a team. Single-user, by design.
- A hosted service. Runs locally on `localhost`.
- A Lark bot or chat interface.
- A real-time event handler (no webhooks; data refreshes on user request or polling intervals).
- A replacement for the existing Lark Base UI. Use the Lark UI for editing rich content; flightdeck is for triage, planning views, and roll-ups the Lark UI doesn't give us.

---

## Decisions (locked)

### 1. Name: `salonx-flightdeck`

### 2. Architectural shape: Option B (distributed)

Each repo owns automation that operates on itself; salonx-flightdeck is the home for net-new tooling that doesn't have a natural home elsewhere.

- **salon-x-business** — release-notes-on-merge, when built (uses local `release-notes-author` agent).
- **salonx-kb** — kb-update-on-release, when built (uses local `kb-article-writer` agent).
- **salonx-flightdeck** — the dashboard, plus all net-new Lark-driven automation.

The release-notes-on-merge automation **stays in salon-x-business** when we build it — flightdeck is for things without a home, not a dumping ground.

### 3. Repo: single monorepo

salonx-flightdeck contains the Next.js dashboard, shared `lib/lark` and `lib/claude` clients, future GitHub Actions workflows under `.github/workflows/`, and shared prompt templates. One secret store, one deploy story, one place to find anything.

### 4. Deployment: **local-only for v1** ★ explicit decision

v1 runs as a Next.js dev server on my laptop at `http://localhost:3000`. **No hosting** — no Vercel, Cloudflare, Fly, or Supabase.

Why:

- Single user (me); no need to share access.
- No production data security review needed.
- Token storage is a local SQLite file (`.data/tokens.db`, gitignored); no Vercel KV, no remote DB.
- Quick to bring up, low commitment, easy to throw away.

**OAuth still happens.** Lark has no manual-paste user-access-token feature — UATs are obtainable *only* through the OAuth code-exchange flow. But the redirect URI is `http://localhost:3000/auth/lark/callback`, the dance is a one-time interaction per ~30-day refresh-token expiry window, and there's nothing public-facing to host.

**When to revisit:** if a second PM needs access, or if any automation needs to run unattended (cron / GitHub Actions touching Lark). At that point, hosting becomes necessary; likely Vercel + Vercel KV. Until then, no.

### 5. Themes: out of scope

Decided not to add a cross-cutting "Theme" field on Lark Base. Milestone already does theme-shaped work for Feature Dev. For BD Feedback, the dashboard will derive strategic-bucket framing from the linked Feature Dev row's Milestone. If, after running with the dashboard for ~3 months, the gap is still real, revisit and add a Multi-select on Feature Dev only — but not pre-emptively.

### 6. Write-backs: in scope for v1

Originally considered read-only for v1. Decided: write-backs from day one. Specific surface in v1:

- Update BD Feedback row **Status** and **Priority**.
- Link a BD Feedback row to a Feature Development row (creates the DuplexLink).
- Update Feature Development row **Status**, **Priority**, **Sprint**, **Milestone**.

Every write goes through a live schema check (using `base:field:read`) before sending, to avoid the trailing-newline-in-field-name class of bug already documented in the dev-ticket skill.

Out of v1 write surface: comments on rows, creating new rows from the UI (use `/log-bd-feedback` Claude Code command for now), bulk edits.

### 7. Lark integration: direct REST with user access tokens (UAT)

Phase 1 scope set documented in [`lark-user-token-scopes.md`](./lark-user-token-scopes.md). Admin allows user-token scopes only.

Copy-paste scope string for the Lark Developer Console:

```
offline_access bitable:app base:record:retrieve base:record:create base:record:update base:table:read base:field:read wiki:wiki:readonly contact:user.base:readonly
```

Per-scope justifications for the admin approval form are in Section 5 of the scopes doc.

### 8. Language: TypeScript

Matches the salon-x stack (Next.js, tRPC, Prisma) so context-switching cost is low.

---

## v1 — Pipeline Dashboard

Five views, in priority order. Each is a separate page or tab; filters are shared.

### View 1 — Triage Queue [read + write]
*"What feedback is sitting unaddressed?"*

- BD Feedback rows where `Status = Logged` AND no linked Feature Development row.
- Sorted by age (oldest first) within priority bands.
- Group by Category and From-the-POC-merchant flag.
- Per-row actions: update Status, update Priority, link to existing Feature Dev row.
- Future hook: "draft a dev ticket" (deferred — invokes the dev-ticket skill via Claude API).

### View 2 — Pipeline by Strategic Bucket [read]
*"What are we working on, framed for leadership?"*

- All Feature Dev tickets, grouped by Milestone, then Status.
- Roll-up counts per Milestone: Pending PRD / Ready / In Progress / In Review / Done.
- Drill-down into the ticket list per cell.
- Filterable by Product, Module, Sprint.
- This is the view to screenshot for stakeholder updates.

### View 3 — Linkage / Coverage [read]
*"Which feedback is being addressed, which is orphaned?"*

- Two-column layout: BD Feedback (left) ↔ Feature Dev (right), drawn as connected pairs.
- Highlight: feedback with no link (orphans), feedback linked to closed tickets that wasn't actually addressed (regression risk), tickets *not* linked to feedback (purely planned work).
- The "did we forget about Asano-san's request from 3 weeks ago" view.

### View 4 — This Week / Next Week [read + light write]
*"What ships? What's at risk?"*

- Current sprint and next sprint side-by-side. Tickets grouped by assignee.
- Aging signal: tickets stuck in the same status >7 days, tickets without ETA, sprint/milestone mismatch.
- Light write: drag a ticket between sprints (updates Sprint field).
- Complements (doesn't replace) the Lark calendar by adding the *aging* layer.

### View 5 — Workflow Monitor [stub in v1]
*"Are my automations running?"*

- One row per workflow: last run time, success/fail, count of pending drafts awaiting review.
- Empty in v1 (no workflows wired yet) — but the slot exists so future workflows have a landing place.

---

## Tech stack

- **Next.js 15** (App Router) — matches salon-x stack.
- **TypeScript** end-to-end.
- **Tailwind + shadcn/ui** — matches salon-x and the `prototype-design` skill.
- **TanStack Query** — for Lark data caching with stale-while-revalidate.
- **NextAuth.js** with a custom Lark provider — handles OAuth dance, refresh rotation, session cookie.
- **better-sqlite3** — local SQLite at `.data/tokens.db` for refresh-token storage and any persisted view state.
- **Lark Open API** directly via `lib/lark/` (no MCP).
- No DB beyond local SQLite; source of truth lives in Lark Base.

---

## Repo layout

```
salonx-flightdeck/
├── README.md                       # what this is, how to run locally
├── apps/
│   └── dashboard/                  # Next.js app (the only app for v1)
├── lib/
│   ├── lark/                       # Lark API client (UAT, OAuth, Bitable)
│   ├── claude/                     # Claude API client (deferred — for future automation)
│   └── auth/                       # localhost OAuth glue, token storage
├── prompts/                        # shared prompt templates (empty for v1)
├── .github/workflows/              # future automation (empty for v1)
├── .data/                          # gitignored — local SQLite, refresh tokens
├── .env.local                      # gitignored — APP_ID, APP_SECRET, NEXTAUTH_SECRET
├── docs/
│   ├── lark-user-token-scopes.md   # scope research; moves from salon-x-business/_scratch
│   └── workflow-index.md           # catalog of all automation across repos (empty in v1)
├── KILLSWITCH.md                   # state of all workflows: enabled/disabled (empty in v1)
└── package.json
```

---

## Sequencing

**Milestone 0 — Repo + OAuth (1–2 days)**
1. Create the salonx-flightdeck repo, scaffold Next.js + Tailwind + shadcn.
2. Register the Lark app in the developer console with the Phase 1 scope set; submit to admin with the per-scope justifications.
3. Wire OAuth: login button → Lark consent → localhost callback → store refresh token in SQLite.
4. Implement `/api/whoami`; render "Signed in as <Name>" on home page.

**Milestone 1 — Lark client (1 day)**
5. Build `lib/lark/` — list/get/search records on Bitable, OAuth refresh interceptor with single-use rotation handling.
6. Smoke test against BD Feedback + Feature Dev tables.

**Milestone 2 — View 1 (Triage Queue) (2–3 days)**
7. Read-side: unaddressed BD Feedback list, sorted by age + priority.
8. Write-side: Status / Priority updates, Feature Dev linking.

**Milestone 3 — Views 2–4 (3–4 days)**
9. Pipeline by strategic bucket.
10. Linkage view.
11. This-week / next-week view with aging signals.

**Milestone 4 — Workflow monitor stub (0.5 day)**
12. Empty View 5 with placeholder; ready to populate when first automation lands.

**Total v1: ~7–10 days of focused work.**

---

## Out of scope for v1

- Webhook-based real-time triggers.
- Lark bot UX.
- Hosted deploy of any kind.
- Multi-user auth.
- Themes as a Lark Base column.
- All four workflows from the original pm-copilot candidate list (release notes on merge, Lark thread → PRD, BD row → dev ticket, KB flag).
- Cross-workflow state.
- Metrics on flightdeck itself (how often I open it, how many drafts merged, etc.).
- Comments on Lark Base rows from the dashboard.
- Bulk-edit / spreadsheet-style multi-row writes.
- Creating new BD Feedback or Feature Dev rows from the dashboard (use `/log-bd-feedback` for now).

---

## Future workflows (deferred — original candidate list, re-prioritized)

In light of v1 being the dashboard:

1. **release-notes-on-merge** — lives in salon-x-business, not flightdeck. v2.
2. **Lark thread → PRD draft** — lives in flightdeck (Lark-driven). v2 or v3 — needs a hosted runtime to be event-triggered.
3. **BD Feedback row → suggest dev ticket** — lives in flightdeck. View 1 of the dashboard partially obsoletes the need by making "promote a feedback row to a dev ticket" a one-click action; decide whether full unattended automation is still worth it after running with the dashboard for a few weeks.
4. **salon-x release tag → flag KB articles for update** — lives in salonx-kb. v3+.

---

## Remaining open questions

1. **Failure tolerance for v2 automations.** Defer until any v2 workflow is actually in flight; doesn't block v1.
2. **What "stuck ticket" signals to surface in View 4.** Initial picks: status unchanged >7 days; sprint label and milestone mismatch; no ETA after pulling into current sprint. Tweak with real data.
3. **Whether to persist any view-state in SQLite** (collapsed sections, last-viewed-tab, etc.) or push to `localStorage`. Default: `localStorage` for ephemeral UI state, SQLite only for tokens.
4. **Should "Light write" in View 4 (drag-to-reschedule) ship in v1 or v1.5?** It's higher-risk than other writes because it's spatial / drag-based; consider deferring to v1.5.

---

## What to discuss next in Claude Code

1. Lock the data model — TypeScript types for BD Feedback row, Feature Dev row (including DuplexLink shape, MultiSelect arrays, and the trailing-newline `Sub-category\n` field).
2. Sketch the OAuth callback handler — happy path + token persistence + single-use refresh rotation.
3. Decide the local SQLite schema (one row for the active token? what other state, if any?).
4. Mock View 1 (Triage Queue) UI in the `prototype-design` skill before writing the data layer.
5. Stand up the salonx-flightdeck repo (empty Next.js skeleton + README + `.gitignore` + `KILLSWITCH.md`) so future work has a home.
