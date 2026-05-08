# salonx-flightdeck — Pages Guide

A walk-through of every page in the dashboard: what it answers, what you're looking at, and when to open it. Written for jiaen, single-user, post-pivot.

The 2026-05-05 pivot reframed flightdeck as a **thinking surface, not a Lark re-skin**. Lark Base remains where you edit fields. Flightdeck is where you decide what to do next, and where Claude-driven scoping flows turn vague feedback into structured artifacts. Most pages share two recurring patterns:

- **PM status taxonomy.** Lark has 9+ statuses; flightdeck collapses them into three buckets that actually drive decisions — *Mine to move* (Logged, Pending PRD, Exploring, In Discussion), *Eng's to move* (Ready, In Progress, In Review, In Testing, Ready for Release, Merged to Develop), and *Shipped* (Released, Done, Won't Do). Active work = Mine + Eng. See `apps/dashboard/lib/status.ts`.
- **Four aging signals.** Defined in `lib/lark/aging.ts`:
  1. `bd-stale-logged` — BD row Logged with no Dev link for >14d (danger past 30d).
  2. `dev-status-stale` — Dev row in active sprint, status unchanged >7d (danger past 14d).
  3. `dev-no-milestone` — Dev row pulled into a sprint without a strategic Milestone.
  4. `dev-no-eta` — Dev row in a sprint with no ETA set.

  These render as small badges on rows, and as roll-up counts on Today.

## Today

### What it answers
"Walking up to my desk in the morning — what's the one thing that needs my attention?"

### What you see
A single **headline number** at the top, picked by priority order:
1. Sprint commitments without ETA (most urgent — the commitment isn't credible).
2. BD rows over 30 days unaddressed (merchant asks you've quietly let lapse).
3. Immediate-priority BD coverage below 80% (triage backlog).
4. Tickets without a strategic bucket (>20 = unframed work).
5. "All clear — good time to scope something" celebration.

Below that, four briefing cards: **BD Feedback queue**, **Current sprint**, **Pipeline health**, **Coverage**. Each shows a few stats with tone colouring (warn, danger, success) and a deep link into the relevant page. The Stat with the helper "You've forgotten about these" is the 30-day BD count and yes, it is intentionally that pointed.

### Why it's framed this way
Lark Base can't tell you "the most actionable thing right now" because Lark doesn't know which of nine statuses are blocked on you vs blocked on eng. The headline picker is a deliberately opinionated thinking surface — it ranks, picks one, and tells you why. The four briefing cards are the four signals plus coverage: stale BD (14d / 30d bands), sprint stuck-ness, pipeline framing health, immediate-coverage %.

### Intended use case
First thing in the morning, or when context-switching back into PM mode. Decision the headline supports: "do I need to go fix something today, or can I move on to deeper scoping work?" Next move is whatever the CTA button suggests — usually "Open triage" or "Fix in sprint view".

### How it connects to scoping flows
Today doesn't host a flow itself, but the Sprint card has a **"Draft weekly stakeholder update"** button that jumps into `/sprint?flow=weekly-review` and starts the weekly-review flow. Most other CTAs route into Triage or Sprint where the flows live.

## Triage Queue

### What it answers
"What BD feedback is sitting unaddressed, and which one should I scope next?"

### What you see
Headline: count of stale-30d rows (or 14–30d if no 30d, or total unaddressed if neither). Helper line calls out POC-merchant rows separately because those are higher signal — a real merchant directly asked.

Below: groups by **Priority** (Immediate, High, Medium, Low, Next), each section showing rows sorted by age descending. Each row shows number, item text (translation + original), category badges, POC marker, age in days, and **aging badges** (the `bd-stale-logged` signals). Row tint deepens as the row ages. Click anywhere on the row → opens the slide-over panel. Click the **Scope** button → opens the panel *and* auto-starts the bd-to-dev flow.

A row appears here when it has no linked Feature Dev ticket AND no `Day of deploying` date set — i.e. nothing in Lark says this ask has been actioned. Status is intentionally not part of the filter; rows can sit in any non-terminal status and still need a decision. Once you link to a Dev row (or set a deploy date in Lark), the row leaves this view.

### Why it's framed this way
This is the closest thing flightdeck has to a "queue", and it's framed exactly the way the pivot calls for: not a re-skin of Lark's BD Feedback table, but a curated view that surfaces *the decisions you owe* (triage Logged → Linked or Declined). The aging badges + tint make 30d-old POC rows impossible to scroll past. POC-from-merchant is its own badge because it's the strongest signal in the data.

### Intended use case
Once or twice a day, after Today says "you have stale things". The decision: for each row, link to existing Dev ticket, scope into a new one, or decline with reason. Next move is almost always click **Scope** on the top row of the Immediate / High groups.

### How it connects to scoping flows
**Scope** button → bd-to-dev flow (auto-started). Clicking the row body → opens the panel without auto-starting, so you can read the summary first and decide which flow to run.

## Pipeline

### What it answers
"What are we working on, framed for leadership? What's stuck without a strategic frame?"

### What you see
Headline: total active tickets (Mine + Eng) across all milestones. Then an **amber callout** if any tickets exist with no Milestone — "Unframed work. Set a Milestone in Lark Base to make stakeholder views legible." The callout has a direct **Open in Lark** button because that fix isn't a flightdeck write surface — go fix it in Lark.

Below: one card per Milestone (strategic bucket). Each card shows a 3-up grid: **Mine / Eng / Done** counts using the PM status taxonomy. Closed cohorts (no Mine, no Eng, only Done) get dimmed and labelled "Closed cohort — nothing in flight here." Expand a card to see the ticket list, with a toggle to show/hide closed work.

### Why it's framed this way
This is the screenshot-for-stakeholders view. The Mine/Eng/Done split is the whole point of the taxonomy — leadership doesn't care about the difference between "In Review" and "In Testing", they care whether eng is moving or whether you owe a PRD. The "no Milestone" callout exists because unframed work is invisible to stakeholders, and the only fix is upstream in Lark.

### Intended use case
Weekly, before a stakeholder sync, or any time you need to answer "what's actually in flight under bucket X". Decision: which milestones need rebalancing, which are idle, what to talk about in the leadership update. Next move from here is usually opening the Sprint view to draft the weekly update.

### How it connects to scoping flows
No direct flow entry from a Pipeline card today. The implicit connection is that the **"Draft weekly update"** flow on Sprint reads pipeline state. Clicking through to a ticket opens the panel where you can run pair-sanity if a BD link exists.

## Linkage / Coverage

### What it answers
"Which feedback is being addressed, which is orphaned, and is the dev work actually covering the ask?"

### What you see
Headline: **Coverage of Immediate-priority BD rows** as a percentage — `linked / (linked + unlinked)`. Tinted green at 90%+, amber at 70–90%, red below. This is the headline metric for triage health.

Four collapsible sections:
- **Active linkages** — BD ↔ Dev pairs where the Dev work is still in flight. Each row has a **Sanity** button → pair-sanity flow.
- **Orphan feedback** — BD rows with no Dev link. Either scope or decline. Each has a **Scope** button → bd-to-dev flow.
- **Tickets without feedback** — Dev work without a BD source (planned-from-strategy or tech-debt). Read-only.
- **Archive (released linkages)** — collapsed by default. Pairs whose Dev work has shipped.

### Why it's framed this way
This is the "did we forget about Asano-san's request from 3 weeks ago" view. The orphan-BD section is the same population as Triage, but framed against existing Dev work instead of as a queue. The orphan-Dev section is the inverse and useful for spotting tech-debt or planned work that won't show up in BD coverage. Active vs Archive is the same Mine+Eng split — Released is closed inventory and shouldn't clutter the live view.

### Intended use case
After a major BD volume bump, or when a stakeholder asks "are we covering the POC merchants properly?". Also useful before a sprint planning conversation — pair-sanity any active linkage where you suspect drift. Decision: scope orphans, sanity-check pairs, mentally tag tech-debt-only Dev rows.

### How it connects to scoping flows
Two entry points: **Scope** on orphan BD rows → bd-to-dev. **Sanity** on active pairs → pair-sanity. Clicking any row opens the panel for context first.

## This Week

### What it answers
"What ships this sprint? What's at risk? What's eng actually working on?"

### What you see
Headline picks one of three:
- **Danger** — ≥50% of active sprint tickets have no ETA ("Sprint commitment isn't credible").
- **Warn** — tickets stuck >7 days in active sprint.
- **Success** — all active tickets have ETAs, sprint commitment looks credible.

The headline always carries a **Draft weekly update** CTA that kicks off the weekly-review flow.

Below: current sprint and next sprint side-by-side. Each column is grouped by assignee, with active / in-progress / done counts per person. Each ticket row shows status badge, description, ETA (or a `no ETA` warn badge), aging signals, and — if there's a BD link — a small inline `pair-sanity` link. Click a ticket → opens the Dev panel. If next sprint is empty, you get a dashed placeholder so you notice.

### Why it's framed this way
The sprint plus aging signals is what Lark calendar can't give you. ETA-coverage is the headline because a sprint with half the tickets unestimated isn't a sprint, it's a wishlist. Grouping by assignee is the natural unit for "who's blocked, who's overloaded". The dev-status-stale and dev-no-eta aging signals (defined in `lib/lark/aging.ts`) drive the badges and the headline.

### Intended use case
Before sprint check-ins, before drafting the weekly stakeholder update, when eng asks "what's the priority order this week". Decision: which tickets to push to next sprint, which to chase ETAs on, what to highlight in the weekly update. Next move is usually clicking **Draft weekly update** if it's Friday.

### How it connects to scoping flows
The headline CTA → weekly-review flow. The inline `pair-sanity` link on tickets with a BD link → pair-sanity flow on that pair. Clicking a ticket opens the panel where you can manually start any flow.

## Sessions history

### What it answers
"What scoping conversations have I had, and can I jump back into one?"

### What you see
A flat list of all scoping sessions, newest first. Each row: flow type badge (BD → Dev ticket / Pair sanity / Weekly review), ticket title (or "(detached)" for non-ticket flows like weekly-review), model used, status (`active` or closed), and "updated 3h ago"-style relative time. Empty state: "No scoping sessions yet. Open a row in Triage or Linkage to start one."

### Why it's framed this way
This is the reframing of the original View 5 (Workflow Monitor stub). Since flightdeck's value lives in the scoping flows, the local history of those flows is more useful than an empty automations slot. Detached sessions exist because weekly-review isn't tied to any single ticket.

### Intended use case
"I started a bd-to-dev session yesterday and got pulled away — let me resume." Or, occasionally, "what did I actually decide on BD #142 last week?" Decision: resume, or re-read for context. This page does not host a flow entry — it's read-only history.

## Slide-over panel & scoping flows

Cross-cutting because every page except Sessions opens into the same slide-over.

### The slide-over panel
Triggered by clicking any row on Triage, Linkage, Pipeline (via expanded ticket lists), or Sprint. The URL gets `?panel=<recordId>&kind=<bd|dev|pair>` appended, so the panel is bookmarkable and survives refresh.

The panel shows two things:
1. **Read-only summary** of the row (or pair) — number, title, category, status, priority, age, aging signals, link counts. Enough context to decide what to do without leaving the page. No inline edits — for routine field changes, use Lark Base directly. The panel deliberately doesn't replicate Lark's editing UI; the pivot was explicit about that.
2. **Flow buttons** — depending on `kind`: Scope (bd-to-dev) for BD rows, Sanity (pair-sanity) for pairs, Find related (cross-repo lookup) on demand. When a flow auto-starts via `&flow=<flow-name>`, the panel opens directly into the chat.

### The three flows

All three use `claude -p` (the Claude Code CLI, your existing subscription — no API key needed) by default on Opus 4.7. Each is seeded with a system prompt and a sensible opener; conversation goes free-form after that.

**bd-to-dev** — "Should this BD feedback become a dev ticket?"

The opener is shaped like:

> Looking at BD #142: "Allow staff to be marked unbookable per service".
>
> Three quick framing questions before I draft anything:
> 1. Is this a bug, an enhancement to existing behaviour, or genuinely new behaviour?
> 2. Affected merchants — just <requester>'s POC, or are others asking for this too?
> 3. Aware of any existing Feature Dev tickets that might already cover this? (I can search if you'd like.)

After your answers, Claude can search Feature Dev for duplicates, then drafts a ticket using the **dev-ticket SKILL discipline** — which is the part that matters. The Story Description is mandated to follow this exact structure, copied verbatim from the SKILL:

- **Background** — what's broken or missing today, in user-visible terms. Concrete symptoms a customer / staff / admin would notice. No code paths, no DB tables.
- **Goal** — one paragraph: what changes and why, in user-facing terms.
- **Acceptance Criteria** — numbered sections per surface, with bulleted observable behaviour, copy text, and edge cases.
- **Out of Scope** — things engineering or QA might assume are included but aren't.
- **Reference** — BD rows, PRD links, dates, merchant names. The "why now".

Plus a "what to avoid" rule set (no DB column names, no code symbols, no file paths, no commit hashes, no mixing AC with implementation notes). These constraints come from a real engineering review where ticket descriptions naming DB columns blocked migration work — not stylistic preference.

You'll see the draft in plain text first, get to edit it, *then* Claude calls `propose_create_dev_ticket`.

**pair-sanity** — given an existing BD ↔ Dev pair, is the dev work actually covering the ask? Output is a verdict: *covered* / *partial* / *drifted*, with reasoning. May propose `lark.update_bd_status` (e.g. "Done, verified covered" or escalate to a follow-up). Best run after a Dev ticket moves to In Review or Done, before you mark the BD row resolved.

**weekly-review** — read pipeline + sprint state, draft a stakeholder update. Output is a `propose.write_stakeholder_md` action that writes to `scoping-outputs/<YYYY-MM-DD>-stakeholder.md`. Suffix on collision (`-2.md`, `-3.md`), never overwrite.

### Propose-then-approve

No flow ever writes to Lark or to disk without a click. Every action goes through a `propose_*` tool that lands in a `proposed_actions` SQLite table; the chat UI shows a card with the diff (or full draft text), and the write fires only when you press Approve. This is non-negotiable — it's how the pivot keeps the "thinking surface" promise honest. Claude can be wrong; you stay in the loop.

### Where outputs go

- **Dev ticket creation** — direct write to Lark Base Feature Development table, after approval.
- **BD Status changes** (e.g. Declined with verdict, Done with sanity verdict) — direct write to Lark Base BD Feedback table, after approval.
- **DuplexLink (BD ↔ Dev)** — direct write to Lark Base, the one inline write-surface that survived the pivot because the typeahead picker is genuinely better than Lark's UI.
- **Weekly stakeholder update** — markdown file at `scoping-outputs/<YYYY-MM-DD>-stakeholder.md`, suffixed on collision. Local file, gitignored area. Copy-paste from there into Lark / email / wherever the actual update lands.
