# Scoping improvements — review (2026-05-06)

Static + light dynamic audit of the 9 shipped items in `docs/scoping-improvements.md`.
`pnpm -r typecheck` passes. The orphan-reader grep
(`system.*claude_session_uuid|content_json.*claude_session_uuid`) returns zero hits —
confirming no leftover readers of the legacy fake-system-message hack outside the
deliberate fallback in `getClaudeSessionUuid`.

## Summary

| # | Item | Verdict |
| - | ---- | ------- |
| 1 | `claude_session_uuid` column | ✅ |
| 2 | Shared team table | ✅ |
| 3 | Per-flow tool allowlist | ⚠️ |
| 4 | Idempotent approve / reject | ⚠️ |
| 5 | Stop button | ✅ |
| 7 | Compaction trigger | ✅ |
| 8 | Schema-drift guard | ❌ |
| 9 | Session timeline view | ✅ |
| 10 | Workspace-root helper | ✅ |

## Findings

### #1 claude_session_uuid column ✅

`lib/auth/db.ts:51` declares the column on the CREATE; `:122-127` runs an
idempotent `PRAGMA table_info` check before `ALTER TABLE … ADD COLUMN`. Same
pattern is reused for `recap_md` / `recap_at_turn`. `apps/dashboard/lib/scoping-db.ts:71-87`
writes the new column on insert; `:99-124` reads from the column with a legacy
fallback to a `role='system'` first message. The legacy fallback is the only
remaining reader of system-role messages anywhere — the orphan-reader grep
confirms.

`apps/dashboard/app/api/scoping/messages/route.ts:20` has a redundant filter
(`m.role !== "system"`) — `listMessages` (`scoping-db.ts:154`) already excludes
`system` rows in SQL. Belt-and-suspenders, harmless.

The timeline view at `app/(dashboard)/sessions/[id]/page.tsx:28` calls the same
filtered `listMessages`, so legacy system rows can't leak into the chat UI or
timeline UI. Verdict: complete.

### #2 Shared team table ✅

`lib/claude/team.ts` is the single source of truth. The 6 open_ids match
`memory/reference_lark_base.md:52-57` exactly. Consumers verified:
- `lib/claude/prompts/bd-to-dev.ts:10,33` — `teamTableMarkdown()` in system prompt.
- `apps/dashboard/app/api/scoping/turn/route.ts:7,249` — iterated for per-turn
  CONTEXT.
- `apps/dashboard/lib/field-options.ts:69` re-exports `TEAM as KNOWN_ASSIGNEES`,
  consumed by `TicketPanel.tsx:30,470` and indirectly by `EditableField.tsx:353`.

Grep for the literal open_id strings (`ou_08cf01cd…`, etc.) finds them only in
`team.ts` and `memory/reference_lark_base.md`. No stragglers. Verdict: complete.

### #3 Per-flow tool allowlist ⚠️

`lib/claude/runner.ts:48-63` defines `FLOW_ALLOWED_TOOLS` for all three flows
(`bd-to-dev`, `pair-sanity`, `weekly-review`) — none missing. The runner at
`:90-93` correctly serializes the array space-separated and passes it via
`--allowedTools`. `app/api/scoping/turn/route.ts:98` plumbs it through.

**Gap: the wildcard fallback is silent.** `runner.ts:90-93`:

```ts
const allowed =
  opts.allowedTools && opts.allowedTools.length > 0
    ? opts.allowedTools.join(" ")
    : MCP_ALLOWED_TOOLS_WILDCARD;
```

If a future flow_type is added without an entry in `FLOW_ALLOWED_TOOLS`,
`FLOW_ALLOWED_TOOLS[session.flow_type]` is `undefined`, the runner falls back
to the wildcard, and the new flow gets *all* propose_* tools — the exact
foot-gun T3 was meant to prevent. A `console.warn` (or a typed `flow_type` enum
that fails closed) would catch this. Functionally OK today since all flows are
covered, but the latent risk is real.

### #4 Idempotent approve / reject ⚠️

`scoping-db.ts:248-260` — `claimProposedAction` does the right thing:
single-statement `UPDATE … WHERE id = ? AND state = 'pending'`, returns
`changes === 1`. Approve route (`:37-47`) and reject route (`:22-32`) both
pre-claim and 409 on race-loss with the canonical state. Solid.

**Gaps worth flagging (intentional but documented partially):**

1. **`firing` is never recovered.** `approve/route.ts:33-36` says the row "is
   left in `firing` rather than reverting to `pending`, so retries surface the
   actual ambiguity instead of silently double-writing." That's a defensible
   design but there's no UI affordance or admin route — the only recovery is
   `sqlite3` by hand. For a single-user local-only app this is acceptable, but
   should be called out in `docs/scoping-improvements.md` or `KILLSWITCH.md`.

2. **`firing` is unlabeled in the UI.** `ProposedActionCard.tsx:111-135`'s
   `StateBadge` only special-cases `pending` / `fired` / `rejected` / `failed`.
   `firing` falls into the generic neutral branch and renders the literal text
   "firing" — readable but not styled.

3. **Composer race window.** `ChatShell.tsx:73-75` disables the composer only
   while `state === "pending"`. The instant `claimProposedAction("firing")`
   succeeds, the composer re-enables — even though the Lark write is still
   in-flight. Sending another message during that window won't cause data
   corruption (Lark write is independent of the chat turn) but it's a small UX
   sharp edge. The card itself shows `busy` so the Approve/Reject buttons stay
   disabled, just not the composer.

### #5 Stop button ✅

`ChatShell.tsx:40,94-95,101,133-135` — `AbortController` per send, plumbed to
the fetch's `signal`. The `catch` block (`:122-124`) intentionally swallows
`AbortError` rather than surfacing as a red banner. `app/api/scoping/turn/route.ts:99`
passes `req.signal` into `runClaudeTurn` as `abortSignal`. Next.js does fire
`req.signal.abort()` on client disconnect for streaming responses (App Router
behavior), so the chain works.

`runner.ts:124-134` listens to `abortSignal` and `child.kill("SIGTERM")`s the
subprocess. The `{ once: true }` listener avoids double-killing.

**Half-stream caveat**: any `assistant` events that arrive *before* the abort
are persisted via `appendMessage(sessionId, "assistant", …)` at
`turn/route.ts:104`. Events after the abort never arrive. So a stopped turn
leaves a partial assistant message in SQLite, visible in the timeline. Not a
bug — Claude Code's streaming output is itself partial — but worth knowing.

### #7 Compaction trigger ✅

Schema migration: `db.ts:128-133` adds `recap_md` + `recap_at_turn` idempotently.
`scoping-db.ts:38-50` writes them; `:31-34` exposes on `SessionRowRaw`.
`turn/route.ts:115` calls `void maybeCompactInBackground(sessionId)` after
`controller.close()` — truly fire-and-forget. The function (`:284-351`) wraps
everything in `try/catch` and `console.warn`s on failure; nothing bubbles up to
the client.

Threshold logic (`:292-294`): first compaction at 20 user turns, then every 10
past the previous threshold. Looks correct.

`runClaudeOneShot` call (`:328-339`) uses `model: "sonnet"`, `disableMcp: true`
(no MCP tool overhead), bounded `200-400 word` recap target. Self-bounding.

Recap re-injection: `buildPerTurnContext` (`:255-262`) reads the latest
`recap_md` from the session row and prepends it. So even after Claude Code's
`--resume` history grows, the recap re-grounds it on every turn. The doc's
caveat about not actually shrinking Claude's prompt is honest.

### #8 Schema-drift guard ❌

`scripts/check-lark-schema.mjs` is well-written: imports `listFields`,
`TRACKER`, `BD_FIELDS`, `FD_FIELDS`; iterates expected names; prints missing
in red and unknown new fields in yellow; exits non-zero on drift. The
field-name match against `f.fieldName` lines up with `bitable.ts:60-67`.

**Broken: the script can't actually be invoked.** `pnpm check:lark-schema`
fails at `tsx: command not found`:

```
$ pnpm check:lark-schema
> tsx scripts/check-lark-schema.mjs
sh: tsx: command not found
 ELIFECYCLE  Command failed.
```

`tsx` is only declared as a devDep under `lib/mcp-tools/package.json:27` —
it's not in the root `package.json` and pnpm doesn't expose nested-package
bins to root scripts by default. Running directly via the hoisted binary
(`./node_modules/.pnpm/node_modules/.bin/tsx scripts/check-lark-schema.mjs`)
works — it gets past resolution and only fails on the auth check (expected
in this audit env, no signed-in token).

**Fix**: add `tsx` to the root `package.json` `devDependencies`, or change
the script to `pnpm -F @flightdeck/mcp-tools exec tsx ../../scripts/check-lark-schema.mjs`,
or invoke node directly with a TS loader. Until then, the documented
`pnpm check:lark-schema` workflow is non-functional.

### #9 Session timeline view ✅

`app/(dashboard)/sessions/[id]/page.tsx` — server component, force-dynamic,
merges `messages` and `proposedActions` and sorts by `ts` (`:31-42`). Renders
session metadata (flow_type, status, claude_session_uuid, model, ticket,
recap header) plus a `<details>` for the recap markdown (`:99-108`).

Auth gating: yes — the `(dashboard)/layout.tsx:19-22` calls `getToken()` and
`redirect("/")` if absent. Since `/sessions/[id]` lives under `(dashboard)/`,
unauthenticated visitors get bounced.

`MessageBlock` renders `pretty(m.contentJson)` (`:208-214`) — pretty-prints
JSON via `JSON.parse`/`JSON.stringify` with 2-space indent, falls back to raw
on parse failure. For assistant messages this means the raw Claude
stream-json envelope shows up — verbose but readable, and the design intent
("debug view") matches that. The CONTEXT block we inject into user messages
isn't persisted as part of the user row (we only persist `{text: message}`
in `turn/route.ts:64`), so timeline shows the *bare* user message. The
CONTEXT exists only at runtime; the recap is fetched from the session row
and rendered in the metadata header. No leakage concern.

`SessionsView.tsx:115-122` — `<a href="/sessions/${s.id}">timeline</a>`
linked off each row with `e.stopPropagation()` so it doesn't open the panel.

### #10 Workspace-root helper ✅

`lib/claude/paths.ts` — `workspaceRoot()` uses
`fileURLToPath(import.meta.url)` + `"../.."` (correct: paths.ts lives at
`lib/claude/paths.ts`). `scopingOutputsDir` and `dataDir` derive from it.

Consumers verified:
- `lib/claude/mcp-config.ts:3,20` uses `workspaceRoot()`.
- `app/api/lark/proposed-action/[id]/approve/route.ts:4,162` uses `scopingOutputsDir()`.

**Other `..`-counting that didn't get migrated** (and intentionally so):
`lib/auth/db.ts:20`, `apps/dashboard/lib/scoping-db.ts:11`, `lib/services/lark-poller/state.ts:13`,
`apps/dashboard/app/api/data/sessions/route.ts:12`, `lib/mcp-tools/tools/propose.ts:20`
all do `path.resolve(process.cwd(), "../../.data/tokens.db")`. These are
**cwd-relative** (intentionally, because the dashboard's cwd is `apps/dashboard/`),
not `import.meta.url`-relative. They're the `FLIGHTDECK_DB_PATH` fallback —
not something `workspaceRoot()` should replace, since the helper uses
`import.meta.url` and would resolve from the file's location, breaking
`FLIGHTDECK_DB_PATH` env-override semantics. So the lack of migration here is
correct, but it does mean `dataDir()` and the DB-path resolution duplicate
some logic. Acceptable.

## Bottom line (5 bullets)

- **Solid (7 of 9)**: T1 (claude_session_uuid column), T2 (shared team table),
  T5 (Stop button), T7 (compaction trigger), T9 (timeline view), T10
  (workspace-root helper) all match intent cleanly. T4 is functionally correct
  on the happy path.
- **T8 is broken in practice**: `pnpm check:lark-schema` fails because `tsx`
  isn't a root devDependency. Either add it to root `package.json` or change
  the script to invoke a workspace-package's tsx. This is the only must-fix.
- **T3 has a fail-open footgun**: an unmapped `flow_type` silently inherits
  the `mcp__flightdeck__*` wildcard. Recommend a `console.warn` or a typed
  enum so future flows fail closed.
- **T4 race / recovery edge cases**: the `firing` state has no UI affordance
  and no recovery path beyond manual SQLite — defensible for single-user
  local-only, but should be documented in `KILLSWITCH.md`. Composer
  re-enables the moment `firing` is claimed (before the Lark write returns).
  `firing` falls through to a default neutral badge (literal text "firing").
- **Follow-up nice-to-haves**: a redundant `role !== "system"` filter in
  `messages/route.ts` (the SQL already excludes them); the `pretty()` JSON
  dump in the timeline view is verbose for assistant messages but matches the
  debug-view intent; a partial assistant message can persist if Stop fires
  mid-stream — unavoidable but worth noting in user-facing docs.
