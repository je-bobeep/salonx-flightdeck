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

## Tech Stack (planned, not yet scaffolded)

- **Next.js 15** App Router, **TypeScript**.
- **Tailwind + shadcn/ui** for UI (matches `salon-x` and the `prototype-design` skill in salon-x-business).
- **TanStack Query** for data fetching with stale-while-revalidate.
- **NextAuth.js** with a custom Lark provider for the OAuth dance.
- **better-sqlite3** for local token + view-state storage at `.data/tokens.db`.
- **Lark Open API** directly via `lib/lark/` — no MCP. (Lark MCP is fine for Claude Code sessions; flightdeck is a long-running web app and uses REST + UAT.)

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

## Where We Are

As of **2026-05-05**:

- ✅ Scope locked.
- ✅ Lark scope set finalized (combined v1 + v2 in single admin submission).
- ⏳ Lark app being registered in the Developer Console (jiaen, in progress).
- ⏳ Awaiting admin approval of OAuth scopes.
- ⬜ Milestone 0 (scope.md): scaffold Next.js + wire OAuth + whoami.
- ⬜ Milestone 1: Lark client (`lib/lark/`).
- ⬜ Milestone 2: View 1 (Triage Queue) — read + write.
- ⬜ Milestones 3–4: Views 2–5.

After admin approval, the next concrete step is **Milestone 0 from `docs/scope.md`** — scaffold a Next.js app under `apps/dashboard/`, wire the OAuth callback at `localhost:3000/auth/lark/callback`, and prove "Signed in as <Name>" works end-to-end.

## Working with this repository

**No build/test commands yet** — the Next.js app hasn't been scaffolded. When it is, the dev loop will be `cd apps/dashboard && pnpm dev` (or `npm run dev`, TBD on package manager).

**Local secrets** live in `.env.local` (gitignored). Required keys when the OAuth dance is wired:
- `LARK_APP_ID` (from Lark Developer Console)
- `LARK_APP_SECRET` (from Lark Developer Console)
- `NEXTAUTH_SECRET` (random 32-byte string for cookie signing)
- `NEXTAUTH_URL=http://localhost:3000`

**Local data** lives in `.data/` (gitignored). The SQLite file at `.data/tokens.db` holds the OAuth refresh token; never commit it.

## Conventions

- **Lark scopes are user-token only.** Do not request tenant scopes without re-evaluating against `docs/lark-user-token-scopes.md` Section 2. The admin has been clear: tenant scopes need exact justification.
- **Lark Base is the source of truth.** Never duplicate Base data into local SQLite. The local DB holds OAuth tokens and ephemeral view-state only.
- **Field-name quirks matter.** The `Sub-category` field in BD Feedback has a trailing newline (`Sub-category\n`). Always validate writes against live schema (`base:field:read`) before sending. See `memory/reference_lark_base.md`.
- **Refresh tokens are single-use.** Persist the new token *before* using it; treat error `20064` as "force re-auth" not retry.
- **Lark Suite ≠ Feishu.** Endpoints are `open.larksuite.com` / `accounts.larksuite.com`. Never copy code or scopes from Feishu (`open.feishu.cn`) examples — string forms differ.

## Memory & Agent Tooling

- `memory/MEMORY.md` indexes persistent reference notes.
- `memory/reference_lark_base.md` — Lark Base details (carried over and adapted from salon-x-business).
- No skills or subagents yet. When we add them, mirror the `salon-x-business/.claude/skills/` pattern.

## What this repo is NOT

- Not a hosted service (yet).
- Not multi-user.
- Not a replacement for the Lark Base UI — use Lark for rich editing; flightdeck is for triage, planning views, and roll-ups.
- Not a real-time event handler — polling only in v1/v2.
- Not a place for SalonX product PRDs — those live in `salon-x-business/docs/prds/`.
