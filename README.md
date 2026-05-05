# salonx-flightdeck

Personal PM ops tooling for the SalonX product. A single-user Next.js dashboard that turns the SalonX Phase 2 Tracker (Lark Base) into a triage and planning surface, plus the home for net-new event-triggered automation.

Runs locally on `localhost:3000`. No hosting. No multi-user. By design.

## Status

Pre-development. Scope locked, Lark API integration documented, no code yet.

## Documentation

- [`docs/scope.md`](docs/scope.md) — scope, locked decisions, sequencing.
- [`docs/lark-user-token-scopes.md`](docs/lark-user-token-scopes.md) — Lark API scopes (user-token only) and OAuth flow.
- [`docs/workflow-index.md`](docs/workflow-index.md) — catalog of automated workflows across the SalonX repo family.
- [`CLAUDE.md`](CLAUDE.md) — orientation for Claude Code sessions working in this repo.

## What's in here

```
apps/dashboard/   Next.js app (not yet scaffolded)
lib/lark/         Lark API client (UAT + OAuth)
lib/claude/       Claude API client (deferred — for future automation)
lib/auth/         localhost OAuth glue
docs/             scope, scopes, workflow index
memory/           persistent reference notes (Lark Base IDs, API quirks)
prompts/          shared prompt templates (empty)
.github/workflows/  future GitHub Actions (empty)
KILLSWITCH.md     state of all workflows: enabled/disabled
```

## Setup (when we get there)

1. Register the Lark app in the [Lark Developer Console](https://open.larksuite.com/app) using the scope set from [`docs/lark-user-token-scopes.md`](docs/lark-user-token-scopes.md) Section 1.
2. Add `http://localhost:3000/auth/lark/callback` as a redirect URI.
3. Submit user-token scopes for admin approval (per-scope justifications in Section 5 of the scopes doc).
4. Once approved: copy `App ID` + `App Secret` into `.env.local`.
5. `pnpm install && pnpm dev` (commands subject to change once the app is scaffolded).
6. Open `http://localhost:3000`, click "Sign in with Lark", complete the OAuth dance.

## Sibling repos

Flightdeck is one of four repos under `~/all-salonx-repo/`:

- `salon-x` — production code.
- `salon-x-business` — product docs hub.
- `salonx-kb` — knowledge base (Docusaurus).
- `salonx-flightdeck` — this repo. PM ops tooling.
