---
name: Lark Base — SalonX Phase 2 Tracker
description: App token, table IDs, field names, and Lark API quirks for direct REST access from salonx-flightdeck. UAT-based — no MCP.
type: reference
---

salonx-flightdeck calls the Lark Open API directly via `lib/lark/`, using a user access token (UAT) obtained through OAuth. **Do not use Lark MCP from inside this app** — MCP is for Claude Code sessions, not long-running web apps. See `docs/lark-user-token-scopes.md` for the scope set and OAuth flow.

## SalonX Phase 2 Tracker

- **Wiki token:** `LyN0w7ukQiLZ70k3yMclfCy7gwc`
- **Bitable app_token:** `MObXbnFnkafeEAsRrFUlcwrRgcf`
- **URL:** https://storehub.sg.larksuite.com/wiki/LyN0w7ukQiLZ70k3yMclfCy7gwc

### Tables

| Name | table_id |
|---|---|
| BD Feedback | `tbl49YoFep0cYYDd` |
| Feature Development | `tblU2lOjqHwSbWor` |
| Bugs (QA) | `tblsY2Bov8Y8PNXx` |

### BD Feedback fields

`Number`, `Category` (MultiSelect), `Sub-category` ⚠️ trailing-newline, `Item`, `Translate`, `Priority` (SingleSelect), `Development Task` (DuplexLink → Feature Development), `Date Created`, `Date recorded`, `Day of deploying`, `From the POC merchant`, `Parent items`, `Created By` (User), `Status` (SingleSelect), `Request source (if applicable)` (URL).

### Feature Development fields

Confirmed via Phase B roundtrip 2026-05-05 (28 fields total).

`Description` (Text — plain string), `Story description` (Text — plain string), `Status` (SingleSelect), `Module` (MultiSelect), `Product` (MultiSelect), `Request Type` (SingleSelect: Bug / Feature Enhancement / New Feature / Tech), `Priority` (SingleSelect), `Milestone` (SingleSelect), `Sprint`, `Customer Feedback` (Checkbox), `BD Feedback` (DuplexLink → BD Feedback), `Assignee` (User), `Needs Translation Review` (Checkbox), `ETA`, `Release Date`, `Date Created`, `Created By` (User), `PRD`, `T-shirt Sizing`, `Must-have`, `Order`, `AI Summary`, `Attachment`, `Linked Record`, `Parent items`, `Growthbook FG Link`, `Is Growthbook Controlled`, `N/A`.

## API quirks

- **Field name with trailing newline:** the BD Feedback `Sub-category` field is literally named `Sub-category\n` in the schema — payloads must include the `\n`. Easy to miss; always derive from `base:field:read` rather than hardcoding strings.
- **Create records:** pass `"query": {}` (empty object). Do **not** pass `user_id_type` — that returns an error.
- **Update records:** must pass `"query": { "ignore_consistency_check": true }` or the request fails with code `9499`.
- **URL fields:** shape is `{ "link": "https://...", "text": "https://..." }`.
- **DuplexLink fields on writes:** plain array of record IDs — `"BD Feedback": ["recvhGQlyRUnjF"]`. The `{ "link_record_ids": [...] }` shape that comes back in *read* responses is NOT accepted on writes — fails with code `1254074`.
- **Description / Story description on Feature Dev:** plain Multiline text — pass as plain strings. The rich-text array form `[{"type": "text", "text": "..."}]` returns code `1254060` (TextFieldConvFail). (This corrects an earlier note in this file. Authoritative source: `salon-x-business/.claude/skills/dev-ticket/SKILL.md`.)
- **Refresh token rotation:** Lark refresh tokens are single-use. Persist the new one *before* using it. Treat code `20064` as "force re-auth," not retry.
- **Console version publish:** after editing scopes in the developer console, click "Create version & publish" or scopes don't take effect for OAuth (error `99991672`).

## Known team members (Assignee open_ids — open.larksuite.com tenant)

⚠️ **These open_ids are scoped to the `open.larksuite.com` tenant** (the SalonX Phase 2 Tracker lives there). The same people have *different* open_ids in `open.feishu.cn`, so do NOT copy IDs from `salon-x-business/.claude/skills/` — those skills target feishu.cn and will fail here with `code=1254066 UserFieldConvFail`.

Verified 2026-05-06 by reading the Assignee field on live Feature Development rows.

| Name | open_id |
|---|---|
| Jingjing Feng (Winney) | `ou_08cf01cd3ec1f3790c2b88d7dc573fdf` |
| Yi Wang | `ou_928341220770d0181c5cae0efd2a46b4` |
| Feida Zhang | `ou_bb0a5e2f5e84f2fb68e53f556a07aef9` |
| Philly Cai | `ou_fb3479ce4e9b2e98fcfdae0803379661` |
| Jia En Chai | `ou_50c267dd36ca03ad02cca05eda7117c6` |
| Kan Lu | `ou_433b91ac0b296b1fcecfd5441f554d66` |

## Why direct REST instead of MCP

- MCP is designed for an LLM client (Claude Code, Claude Desktop), not unattended scripts or long-running web apps.
- MCP streaming URLs expire after ~7 days and need regeneration — fine for dev sessions, terrible for an app that should run for months.
- The OAuth UAT we get from the Developer Console can refresh indefinitely as long as the rolling refresh token is exercised.
- Direct REST + UAT also matches what a future hosted version of flightdeck would need — no migration cost.
