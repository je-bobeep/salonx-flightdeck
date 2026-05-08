# KILLSWITCH

Status of all automated workflows in salonx-flightdeck (and across the SalonX repo family). To disable a workflow: flip its **Status** to `disabled` here. Each workflow checks this file at the start of every run; a `disabled` row aborts before any side effects.

This is a deliberate pre-flight kill switch — it exists *before* the first workflow ships so disabling is one edit, not a rebuild + redeploy.

## Workflows

| Workflow | Trigger | Home repo | Status | Last run | Notes |
|---|---|---|---|---|---|
| `bd-scoping-flow` | User clicks "Scope this for dev" on a BD Feedback row in flightdeck | salonx-flightdeck | enabled | — | Drafts a Feature Development row from a BD row via Claude. Writes are propose-then-approve. |
| `pair-sanity-flow` | User clicks "Sanity-check this pair" on a linked BD↔Dev pair in flightdeck | salonx-flightdeck | enabled | — | Verdict only (covered / partial / drifted). May propose `update_bd_status` writes. |
| `weekly-review-flow` | User clicks "Draft this week's update" on the Pipeline view | salonx-flightdeck | enabled | — | Output is a Markdown file in `scoping-outputs/<YYYY-MM-DD>-stakeholder.md`. No Lark writes. |
| `lark-bd-poller` | Background — every 15 min while `flightdeck-poller.service` is up on hubbibi | salonx-flightdeck | enabled | — | Reads new messages from Lark group chat `oc_545df3dd4bdb3b1f625ff88fbd3b9380`, classifies BD-shaped ones, writes BD Feedback rows directly. **Auto-fires** (no propose-then-approve in v1, since there is no human in the loop). Disable here to make the next cycle no-op without restarting the service. |

## How to use

1. PR adding a workflow must add a row here.
2. Each workflow's first step: read this file, check its row, abort if `Status: disabled`.
3. If a workflow is misbehaving, edit this file to set `Status: disabled` and commit. The next scheduled run will no-op.
4. `Last run` is updated by the workflow itself on success/fail; treat as a heartbeat.

## Audit log

| Date | Workflow | Action | Reason |
|---|---|---|---|
| 2026-05-08 | `lark-bd-poller` | disabled | Pause unattended Claude Code subprocess use against jiaen's personal Anthropic subscription pending discussion with Elwin about routing classification through hubbibi's locally hosted model instead. |
| 2026-05-08 | `lark-bd-poller` | enabled | Re-enabled after re-reading Anthropic's Claude Code Legal & Compliance page + Consumer Terms §3(7): subscription `claude -p` use for own-workload automation at low volume sits on the permitted side ("ordinary, individual usage" of Claude Code, the explicit-permission carveout). Deployment now Tailnet-only with single-Lark-identity gating. Classifier prompt also simplified — Item field now stores raw original text verbatim, Translate auto-filled by Lark, Category & Sub-category mandatory. |

## Stuck `proposed_actions` recovery

If a row in `proposed_actions` is stuck in `state='firing'`, it means the approve route claimed the row but never transitioned it to `fired` / `failed` (process killed, route timed out, etc.). The composer stays disabled, the card shows a pulsing **firing…** badge, and clicking Approve again 409s.

**Was the Lark write actually performed?** Inspect Lark Base directly. Two outcomes:

- **Write didn't happen** → reset to `pending` so the user can re-approve:
  ```bash
  sqlite3 .data/tokens.db "UPDATE proposed_actions SET state='pending', resolved_at=NULL WHERE id='act_...';"
  ```
- **Write did happen** → mark `fired` so the UI clears the card:
  ```bash
  sqlite3 .data/tokens.db "UPDATE proposed_actions SET state='fired', resolved_at=$(date +%s)000 WHERE id='act_...';"
  ```

A future enhancement: add a "force resolve" admin button on `/sessions/<id>` so this doesn't require sqlite.
