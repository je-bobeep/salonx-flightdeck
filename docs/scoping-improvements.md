# Scoping flow improvements — 2026-05-06

Implementing the 10-item priority list. This doc tracks what shipped and the design notes for the one item deferred (long-lived runner per session).

## Shipped

| # | Improvement | Files |
|---|---|---|
| 1 | `claude_session_uuid` column on `scoping_sessions` (drops the fake-system-message hack) | `lib/auth/db.ts`, `apps/dashboard/lib/scoping-db.ts`, `apps/dashboard/app/api/scoping/messages/route.ts` |
| 2 | Single source of truth for the team table — `lib/claude/team.ts` re-used by prompt builder, per-turn CONTEXT, and the inline assignee picker | `lib/claude/team.ts`, `lib/claude/prompts/bd-to-dev.ts`, `apps/dashboard/app/api/scoping/turn/route.ts`, `apps/dashboard/lib/field-options.ts` |
| 3 | Per-flow tool allowlist via `--allowedTools` — weekly-review can no longer fire `propose_create_dev_ticket` | `lib/claude/runner.ts` (`FLOW_ALLOWED_TOOLS`), `apps/dashboard/app/api/scoping/turn/route.ts` |
| 4 | Idempotent approve / reject — atomic pre-claim flips `pending → firing` (or `pending → rejected`) so a second click 409s safely instead of double-firing the Lark write | `apps/dashboard/lib/scoping-db.ts:claimProposedAction`, `apps/dashboard/app/api/lark/proposed-action/[id]/{approve,reject}/route.ts` |
| 5 | Stop button during streaming — client `AbortController` cancels the fetch, `req.signal` propagates server-side, `runClaudeTurn`'s existing `abortSignal` plumbing kills the subprocess | `apps/dashboard/components/scoping/ChatShell.tsx`, `apps/dashboard/app/api/scoping/turn/route.ts` |
| 7 | Compaction trigger at 20 user turns — generates a markdown recap via `runClaudeOneShot`, persists in `scoping_sessions.recap_md`, re-injects into per-turn CONTEXT block | `apps/dashboard/lib/scoping-db.ts:setSessionRecap`, `apps/dashboard/app/api/scoping/turn/route.ts:maybeCompactInBackground` |
| 8 | Schema-drift guard — `pnpm check:lark-schema` reads live Lark field metadata and asserts every name in `BD_FIELDS` / `FD_FIELDS` resolves; lists newly-added Lark fields too | `scripts/check-lark-schema.mjs`, `package.json:scripts.check:lark-schema` |
| 9 | Session timeline / debug view at `/sessions/[id]` — every message + every proposal in chronological order, plus the recap if present, plus the linked Claude Code session UUID | `apps/dashboard/app/(dashboard)/sessions/[id]/page.tsx`, link in `apps/dashboard/components/views/SessionsView.tsx` |
| 10 | Shared workspace-root helper — single source of truth in `lib/claude/paths.ts` (used by `mcp-config.ts` and the approve route's `scopingOutputsDir`) | `lib/claude/paths.ts`, `lib/claude/mcp-config.ts`, `apps/dashboard/app/api/lark/proposed-action/[id]/approve/route.ts` |
| 6 | Long-lived runner per scoping session — pool keyed on scoping session id, processes survive across user turns, MCP toolserver boots once per session. Probe-confirmed protocol; HMR-safe via `globalThis` registry; SIGTERM cleanup on dev-server shutdown | `lib/claude/process-pool.ts`, `lib/claude/runner.ts` (facade), `apps/dashboard/app/api/scoping/session/[id]/evict/route.ts`, `apps/dashboard/components/scoping/ChatShell.tsx` |

### Caveats on #7

The recap is generated and re-injected, but it does NOT reduce Claude Code's actual prompt size on subsequent turns. Claude Code's `--resume` machinery owns the conversation history; we can't compact what's already in there. The recap is still useful because:

- It re-grounds Claude every turn even if its own memory drifts.
- The PM can read it on `/sessions/<id>` to audit the conversation.
- Once we move to a long-lived runner (#6), the recap becomes the seed for the new system prompt when we choose to break the `--resume` chain — bounding prompt growth strictly.

## #6 long-lived runner — implementation notes

Phase A (probe) and Phase B (pool) both shipped. See `T6 probe findings` below for the protocol details. Architecture summary:

- **`lib/claude/process-pool.ts`** owns the pool. Registry lives on `globalThis.__flightdeckProcessPool` so HMR re-imports find the same `Map<sessionId, Entry>` instead of orphaning the old one.
- `runClaudeTurn` in `lib/claude/runner.ts` is now a thin facade over `processPool.sendTurn`. The signature gained one required field (`scopingSessionId`); call sites updated.
- Stop button (T5): aborting the fetch evicts the pool entry (kills the child via SIGTERM). The next turn re-spawns with `--resume` and Claude Code re-loads the persisted history. No regression vs. the per-turn-spawn model.
- Panel unmount: `ChatShell.tsx`'s effect cleanup sends `POST /api/scoping/session/[id]/evict` with `keepalive: true` so abandoned panels don't leak processes.
- Idle reaper: 10-min timeout (configurable via `FLIGHTDECK_POOL_IDLE_MS`). 60-s sweep. The reaper's `setInterval` is `unref()`-ed so it doesn't keep Node alive.
- Dev-server shutdown: `process.once("SIGINT" | "SIGTERM" | "exit")` handlers SIGTERM every entry in the pool.
- Per-session mutex: `entry.current !== null` is enforced; concurrent `sendTurn` for the same session id rejects with a clear error. UI's `composerDisabled` is the primary defense, this is defense-in-depth.

## T6 probe findings — 2026-05-06

Phase A of the T6 plan: ran `scripts/probe-stream-json.mjs` to confirm the wire format and per-turn boundary before writing any pool code. **Result: clean. Phase B is a go.**

### Working stdin format

```
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}\n
```

One NDJSON event per user turn. No alternates needed.

### Per-turn end marker

```json
{"type":"result","subtype":"success","is_error":false,"session_id":"…","num_turns":1,…}
```

`type:"result", subtype:"success"` fires at the end of every turn, unambiguously. No silence-timeout fallback required. The pool's `sendTurn` iterator should complete on this event.

`stop_reason` on the trailing `assistant` event is `null` in this protocol — the `result` event is the authoritative boundary, not stop_reason.

### Two-turn measurement

Single haiku process, no MCP, two trivial turns:

| Turn | Stdin → first-token (assistant) | Stdin → result |
|---|---|---|
| 1 | 6.79 s (cold start: spawn + Claude Code init + model warm) | 9.93 s |
| 2 | 1.53 s | 3.78 s |

**Turn 2 first-token is 22% of turn 1's** — beats the plan's 30% target. The savings are exactly where expected: the toolserver does not re-boot, Claude Code's init is per-turn but cheap (~4 ms after stdin write), the API call dominates.

### Per-turn artifacts inside the same process

Claude Code re-emits `system:init` before each turn (with the same `session_id` across turns). This is event-level, not a process restart — observable from the timing (turn 2 init is sub-millisecond after the stdin write).

### Implementation handle

For `process-pool.ts`'s stdout dispatcher:

- Lift the line-buffer / NDJSON parser from `runClaudeTurn` (`lib/claude/runner.ts:158-178`) verbatim.
- Per-turn iterator completes when `evt.type === "result"`. Yield the `result` event, then return.
- Persist every event the same way the existing turn route does (`assistant` → `appendMessage(... "assistant")`, `user` → `appendMessage(... "tool_result")`, etc.).
- The trailing `result:success` event can drive an end-of-turn observability log if useful (`num_turns`, total cost, etc.) but doesn't need to be persisted.

The probe trace lives in `/tmp/probe-stream-json.json` for reference.
