# KILLSWITCH

Status of all automated workflows in salonx-flightdeck (and across the SalonX repo family). To disable a workflow: flip its **Status** to `disabled` here. Each workflow checks this file at the start of every run; a `disabled` row aborts before any side effects.

This is a deliberate pre-flight kill switch — it exists *before* the first workflow ships so disabling is one edit, not a rebuild + redeploy.

## Workflows

| Workflow | Trigger | Home repo | Status | Last run | Notes |
|---|---|---|---|---|---|
| _none yet_ | — | — | — | — | The dashboard is not a workflow. Workflows land here as they ship per `docs/workflow-index.md`. |

## How to use

1. PR adding a workflow must add a row here.
2. Each workflow's first step: read this file, check its row, abort if `Status: disabled`.
3. If a workflow is misbehaving, edit this file to set `Status: disabled` and commit. The next scheduled run will no-op.
4. `Last run` is updated by the workflow itself on success/fail; treat as a heartbeat.

## Audit log

| Date | Workflow | Action | Reason |
|---|---|---|---|
| _none yet_ | — | — | — |
