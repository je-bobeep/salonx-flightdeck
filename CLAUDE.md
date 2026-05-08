# CLAUDE.md

This file orients Claude Code sessions working in the salonx-flightdeck repo.

## Repository Purpose

salonx-flightdeck is **jiaen's personal PM ops tooling** for the SalonX product. Two intertwined goals:

1. **Pipeline dashboard** — a single-user Next.js web app that turns the SalonX Phase 2 Tracker (Lark Base) into a triage + planning surface. Solves the "BD Feedback queue is opaque" problem.
2. **Automation home** — eventual home for net-new event-triggered workflows (Lark thread → PRD draft, BD row → suggest dev ticket, etc.) that don't have a natural home in the other SalonX repos.

**Read these first** for full context:

- `docs/scope.md` — scope, decisions, sequencing.
- `docs/lark-user-token-scopes.md` — Lark API scopes and OAuth flow specifics.

Don't re-derive decisions from scratch — they're locked in `docs/scope.md`. If you think a locked decision should change, surface it explicitly to the user instead of working around it.

## Relationship to other SalonX repos

salonx-flightdeck is one of four sibling repos under `~/all-salonx-repo/`:

| Repo | Purpose |
|---|---|
| `salon-x` | Production codebase (Next.js, Prisma, tRPC, React Native). Not tracked here. |
| `salon-x-business` | Product docs hub: PRDs, specs, prototypes, kanzashi material, PM skills/agents. |
| `salonx-kb` | Docusaurus knowledge base (EN-first, JA-translated). |
| `salonx-flightdeck` | **This repo.** PM ops tooling. |

Cross-repo references in code:
- BD Feedback / Feature Development tables live in **Lark Base** (Wiki: `LyN0w7ukQiLZ70k3yMclfCy7gwc`, app_token: `MObXbnFnkafeEAsRrFUlcwrRgcf`). See `memory/reference_lark_base.md`.
- Future automation may invoke agents that live in `salon-x-business/.claude/agents/` — call those via Claude Code subagent dispatch, not by re-implementing.

## Directory Structure

```
salonx-flightdeck/
├── README.md                       # human-facing intro
├── CLAUDE.md                       # this file
├── KILLSWITCH.md                   # state of automated workflows (enabled/disabled)
├── apps/
│   └── dashboard/                  # Next.js app (the only app for v1)
├── lib/
│   ├── lark/                       # Lark API client (UAT, OAuth, Bitable)
│   ├── claude/                     # Claude API client (deferred — for future automation)
│   └── auth/                       # localhost OAuth glue, token storage
├── prompts/                        # shared prompt templates
├── .github/workflows/              # future GitHub Actions automation
├── docs/
│   ├── scope.md                    # canonical scope + locked decisions
│   ├── lark-user-token-scopes.md   # Lark scopes + OAuth flow
│   └── workflow-index.md           # catalog of automated workflows across repos
├── memory/
│   ├── MEMORY.md                   # index of persistent reference notes
│   └── reference_lark_base.md      # Lark Base IDs, field names, API quirks
├── .data/                          # gitignored — local SQLite (refresh tokens)
└── .env.local                      # gitignored — APP_ID, APP_SECRET, etc.
```

## Tech Stack

- **Next.js 15** App Router, **TypeScript**, **pnpm workspace**.
- **Tailwind v3 + minimal shadcn-style primitives** for UI. Visual vibe: Vercel/Stripe — calm, clean, light only. NOT the SalonX brand-orange aesthetic; flightdeck is internal tooling.
- **TanStack Query** for data fetching with revalidate-on-focus + manual refresh button.
- **better-sqlite3** at `.data/tokens.db` for OAuth tokens, scoping sessions, proposed actions, and a small read cache.
- **Lark Open API** directly via `lib/lark/` (UAT only; zero tenant scopes). No NextAuth.js — custom OAuth route handlers, simpler for one-user.
- **Claude integration via `claude -p` subprocess** (the Claude Code CLI). Uses the user's existing Claude Code subscription — no `ANTHROPIC_API_KEY`. Custom tools (Lark, sibling-repo grep, proposed-action persistence) are exposed via a local stdio MCP server at `lib/mcp-tools/`, spawned by `claude -p` via `--mcp-config`.
- **Optional**: `gh` CLI for cross-repo PR/issue search (degrades gracefully if absent).

## Locked Decisions

Don't re-litigate — see `docs/scope.md` Section "Decisions (locked)" for full reasoning. Headlines:

1. **Name:** `salonx-flightdeck`.
2. **Architectural shape:** Option B (distributed). Each repo owns its own automation; flightdeck owns net-new.
3. **Repo:** single monorepo (this one).
4. **Deployment: local-only for v1.** No hosting. Runs on `localhost:3000`. Revisit when a second user needs access or unattended automation is required.
5. **Themes:** out of scope. Milestone already does theme-shaped work.
6. **Write-backs:** in scope for v1 (Status, Priority, DuplexLink). Not bulk edits, not creates.
7. **Lark integration:** direct REST with user access tokens (UAT) only. **Zero tenant scopes** — see `docs/lark-user-token-scopes.md` Section 2 for analysis.
8. **Language:** TypeScript end-to-end.
9. **Pivot (2026-05-05):** flightdeck is a thinking surface, not a Lark Base re-skin. Lark Base remains the editor for routine fields. Write surface narrowed to (a) BD↔Dev DuplexLink picker, (b) scoping-flow proposed actions that the user approves before they fire. See `docs/scope.md` "v1 Scope Update — 2026-05-05" section.
10. **Claude integration:** shell out to `claude -p` using the existing Claude Code subscription. Custom tools via local stdio MCP server. No Anthropic API key.

## Where We Are

As of **2026-05-05**:

- ✅ Scope locked + 2026-05-05 pivot recorded in `docs/scope.md`.
- ✅ Lark scope set finalized + admin-approved.
- ✅ Lark app registered in the Developer Console.
- ✅ **Milestone 0** — Next.js scaffold + OAuth + whoami working end-to-end. `pnpm dev` from `apps/dashboard/`, sign in with Lark, page renders "Signed in as <Name>".
- ⏳ **Phase A** — docs + schema updates landing (this CLAUDE.md update is part of it).
- ⬜ Phases B–I per the full plan at `~/.claude/plans/invoke-the-planning-skill-atomic-narwhal.md`.

The full v1 plan covers: Lark client expansion, sibling-repo client, MCP toolserver, Claude subprocess runner, layout chrome (sidebar + topbar + reauth banner), 5 read views, slide-over panel + DuplexLink picker, scoping session UI + 3 flows, aging signals.

## Decisions log

Product decisions, alignments, and tradeoffs are captured as markdown files in `salon-x-business/decisions/`. Flightdeck reads them, indexes them, and renders them at `/decisions` and `/decisions/<slug>`. Lark Base remains the source of truth for tickets; the decisions log is the source of truth for *why*.

**Six kinds** (`kind` is multi-select):

- `commit` — decision to do something.
- `decline` — decision to NOT do something.
- `defer` — enhance later; state the trigger condition.
- `tradeoff` — explicit tradeoff with what we accepted in exchange.
- `design` — UX or architectural shape.
- `process` — how we work; framework decisions.

**Mandatory frontmatter:** `title`, `date` (ISO `YYYY-MM-DD`), `status` (`active` | `superseded` | `reverted`), `kind`. Stakeholders, related tickets/PRDs/meetings, supersedes, and tags are optional.

**Create one** via either:
- CLI: `./scripts/new-decision.sh "Title with spaces"` from the flightdeck root. Scaffolds the file, opens `$EDITOR`.
- Claude Code skill: `/log-decision` (or "log this as a decision") in any salon-x-business session. The skill drafts from conversation context and writes the file.

**View** at `/decisions` (index, search, filter) and `/decisions/<slug>` (rendered markdown + frontmatter sidebar) once the dashboard is running.

**Cross-repo linking convention:**
- From a salon-x-business doc (PRD, spec): `[See decision](decisions/2026-05-07-slug.md)` (relative to salon-x-business root).
- From a Lark BD/Dev URL field: full portal URL `http://localhost:3000/decisions/2026-05-07-slug`.

The "What we considered and rejected" section is **load-bearing** for stakeholder-alignment proof. Six weeks later, when a stakeholder asks "why didn't we do X?", that section is the answer. The CLI scaffold and the `log-decision` skill both pre-fill it; never strip it.

## Working with this repository

**Dev loop:**
- Install: `pnpm install` from the workspace root.
- Run: `cd apps/dashboard && pnpm dev` (or `pnpm dev` from root — proxies to the dashboard).
- Typecheck: `cd apps/dashboard && pnpm typecheck`.

**Preconditions for full functionality (beyond Milestone 0):**
- `claude` CLI on PATH and signed in to your Claude Code subscription. The dashboard surfaces a friendly error at startup if `claude` isn't found.
- `gh` CLI on PATH and authed to the org hosting `salon-x` (for cross-repo PR search inside scoping sessions). Optional — degrades gracefully if missing.

**Local secrets** live in `.env.local` (gitignored, symlinked from repo root → `apps/dashboard/.env.local` so Next.js's default loader picks it up). Required keys:
- `LARK_APP_ID` (from Lark Developer Console)
- `LARK_APP_SECRET` (from Lark Developer Console)
- `NEXTAUTH_SECRET` (random 32-byte string for cookie signing — used by our custom OAuth routes; we don't actually use NextAuth.js)
- `NEXTAUTH_URL=http://localhost:3000`
- *No `ANTHROPIC_API_KEY`* — Claude auth is via the `claude` CLI's existing subscription.

**Local data** lives in `.data/tokens.db` (gitignored). Holds OAuth tokens, scoping sessions, scoping messages, proposed actions, and a small Lark read cache. Never commit it.

**Generated artifacts** (gitignored): `scoping-outputs/<YYYY-MM-DD>-stakeholder.md` is where the weekly-review flow writes its output (with numeric-suffix collision avoidance — never overwrites).

## Conventions

- **Lark scopes are user-token only.** Do not request tenant scopes without re-evaluating against `docs/lark-user-token-scopes.md` Section 2. The admin has been clear: tenant scopes need exact justification.
- **Lark Base is the source of truth.** Never duplicate Base data into local SQLite. The local DB holds OAuth tokens, scoping conversation state, proposed actions, and a small read cache (used to render last-fetched data when the refresh token is dead).
- **Field-name quirks matter.** The `Sub-category` field in BD Feedback has a trailing newline (`Sub-category\n`). Feature Dev `Description` and `Story description` are plain text strings (NOT rich-text arrays — that returns code `1254060`). Always cross-check `memory/reference_lark_base.md` and `salon-x-business/.claude/skills/dev-ticket/SKILL.md` before adding new write paths.
- **Refresh tokens are single-use.** Persist the new token *before* using it; treat error `20064` as "force re-auth" not retry.
- **Lark Suite ≠ Feishu.** Endpoints are `open.larksuite.com` / `accounts.larksuite.com`. Never copy code or scopes from Feishu (`open.feishu.cn`) examples — string forms differ.
- **Writes via Claude are propose-then-approve.** A scoping-flow tool call never writes to Lark or disk directly — it persists a row in `proposed_actions` with `state='pending'`. The actual write only fires after the user clicks Approve in the chat UI, which posts to a dedicated route. While any pending action exists for a session, the chat composer is disabled.
- **Cross-repo lookup is opt-in per session and content-based.** salon-x commits do not reference Lark ticket numbers, so the match strategy is feature-keyword grep across `salon-x` (git log + gh pr list), `salon-x-business/INDEX.md` + `docs/prds/`, and `salonx-kb/docs/`.

## Cross-repo path conventions

These siblings live under `~/all-salonx-repo/` (set `FLIGHTDECK_REPO_ROOT` to override). The MCP toolserver and any cross-repo helper resolves paths under this root only — never traverses outside.

| Sibling | Used for |
|---|---|
| `salon-x` | Production code reads; git log keyword search; PR search via `gh`. Conventional-commit style scopes (`feat(staff):`, `fix(booking):`). |
| `salon-x-business` | PRDs (`docs/prds/`), specs (`docs/specs/`), tech notes (`docs/tech/`). Read `INDEX.md` first to map feature areas to PRD paths. |
| `salonx-kb` | Docusaurus help articles (Japanese-first under `docs/`, English in `i18n/en/...`). Frontmatter has `slug`, `sidebar_position`, `title`, `sidebar_label` — no Lark ticket refs, content grep only. |
| `salonx-flightdeck` | This repo. Decisions in `docs/scope.md` and `memory/` are LLM-readable when scoping needs project context. |

Pattern for git reads (mirrors `salon-x-business/.claude/agents/release-notes-author.md`):
```
git -C ~/all-salonx-repo/salon-x log --grep "<keyword>" --oneline -50
gh -R <org>/salon-x pr list --search "<keyword>" --json number,title,state
```

## Scoping flows (v1)

Three flows are pre-seeded with a system prompt and an opener; the chat is free-form after. All live under `lib/claude/prompts/`.

| Flow | Triggered from | Output |
|---|---|---|
| `bd-to-dev` | BD Feedback row panel ("Scope this for dev") | Proposes a `lark.create_dev_ticket` action with a `dev-ticket`-SKILL-shaped Story description (Background / Goal / AC / Out of Scope / Reference). |
| `pair-sanity` | BD↔Dev pair panel in V3 ("Sanity-check this pair") | Verdict (covered / partial / drifted) with reasoning. May propose `lark.update_bd_status`. |
| `weekly-review` | Pipeline view ("Draft this week's update") | Markdown stakeholder update written via `propose.write_stakeholder_md` to `scoping-outputs/<YYYY-MM-DD>-stakeholder.md`. |

Default model is Opus 4.7, configurable per session via the session-create payload. Each user turn spawns a fresh `claude -p` subprocess seeded with the full conversation history from SQLite.

## Memory & Agent Tooling

- `memory/MEMORY.md` indexes persistent reference notes.
- `memory/reference_lark_base.md` — Lark Base details (carried over and adapted from salon-x-business; field-format note corrected 2026-05-05).
- The full v1 implementation plan lives at `~/.claude/plans/invoke-the-planning-skill-atomic-narwhal.md`.
- We mirror two skills from `salon-x-business/.claude/`: `dev-ticket` (description quality discipline — Background/Goal/AC/Out-of-Scope/Reference shape) and `log-bd-feedback` (BD-creation field set, team open_id table, API quirks). The `bd-to-dev` scoping flow's system prompt embeds these directly rather than invoking them as Claude Code skills.
- The MCP toolserver at `lib/mcp-tools/` exposes Lark + sibling-repo + propose-action tools to Claude Code via `--mcp-config`. Tool names: `lark.read_bd_feedback`, `lark.read_feature_dev`, `lark.search_feature_dev`, `siblings.read_index`, `siblings.read_file`, `siblings.git_log_grep`, `siblings.gh_pr_search`, `siblings.kb_search`, `propose.create_dev_ticket`, `propose.update_bd_status`, `propose.create_bd_dev_link`, `propose.write_stakeholder_md`.

## What this repo is NOT

- Not a hosted service (yet).
- Not multi-user.
- Not a replacement for the Lark Base UI — use Lark for rich editing; flightdeck is for triage, planning views, and roll-ups.
- Not a real-time event handler — polling only in v1/v2.
- Not a place for SalonX product PRDs — those live in `salon-x-business/docs/prds/`.
