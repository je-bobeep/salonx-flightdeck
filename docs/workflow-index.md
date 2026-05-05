# Workflow Index

Catalog of all automated workflows across the SalonX repo family. salonx-flightdeck owns net-new automation; existing automation lives next to its agent in the repo it operates on.

## Active workflows

_none yet_

## Planned

| Workflow | Trigger | Home repo | Lark scopes used | Status | Notes |
|---|---|---|---|---|---|
| **release-notes-on-merge** | salon-x merge to main / release branch creation | salon-x-business | none | Planned (v2) | Wraps the existing `release-notes-author` agent. Runs as a GitHub Action; opens a PR in salon-x-business with `release-notes/v<X.Y.Z>.md`. |
| **Lark thread → PRD draft** | Hourly poll of designated Lark group chats | salonx-flightdeck | `im:message:readonly`, `bitable:app` | Planned (v2/v3) | Needs a hosted runtime (current local-only constraint blocks this). Reads thread, drafts a PRD per salon-x-business format, opens a PR. |
| **BD Feedback row → suggest dev ticket** | Hourly poll of BD Feedback table | salonx-flightdeck | `base:record:retrieve`, `base:record:create`, `base:record:update` | Planned (v2/v3) | View 1 of the dashboard partially obsoletes this — promotion is one click in the UI. Decide later whether unattended is still worth it. |
| **salon-x release tag → flag KB articles** | GitHub release tag on salon-x | salonx-kb | none | Planned (v3+) | Depends on release-notes-on-merge being solid. Opens PRs in salonx-kb with EN article updates marked `draft: true`. |

## Cross-repo dependency

salonx-flightdeck's dashboard does NOT depend on any of these workflows existing. Workflows are additive — they extend the loop, but the dashboard works with manual data flow today.

## Adding a new workflow

1. Decide which repo owns it (Option B in `docs/scope.md`).
2. Add a row here AND a row in `KILLSWITCH.md` *before* writing code.
3. Use `lib/lark/` (in salonx-flightdeck) for any Lark calls; do not re-implement OAuth.
4. First step of the workflow's run: check `KILLSWITCH.md` and abort on `disabled`.
5. Last step: post a status ping to the designated PM channel (success/failure heartbeat).
