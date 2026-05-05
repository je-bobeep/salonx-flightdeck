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

(Partial — confirm against `base:field:read` before writes.)

`Description`, `Story description`, `Status` (SingleSelect), `Module` (MultiSelect), `Product` (MultiSelect), `Request Type` (SingleSelect: Bug / Feature Enhancement / New Feature / Tech), `Priority` (SingleSelect), `Milestone` (SingleSelect), `Sprint`, `Customer Feedback` (Checkbox), `BD Feedback` (DuplexLink → BD Feedback), `Assignee` (User), `Needs Translation Review` (Checkbox).

## API quirks

- **Field name with trailing newline:** the BD Feedback `Sub-category` field is literally named `Sub-category\n` in the schema — payloads must include the `\n`. Easy to miss; always derive from `base:field:read` rather than hardcoding strings.
- **Create records:** pass `"query": {}` (empty object). Do **not** pass `user_id_type` — that returns an error.
- **Update records:** must pass `"query": { "ignore_consistency_check": true }` or the request fails with code `9499`.
- **URL fields:** shape is `{ "link": "https://...", "text": "https://..." }`.
- **DuplexLink fields on writes:** plain array of record IDs — `"BD Feedback": ["recvhGQlyRUnjF"]`. The `{ "link_record_ids": [...] }` shape that comes back in *read* responses is NOT accepted on writes — fails with code `1254074`.
- **Description / Story description on Feature Dev:** rich-text fields. Pass as `[{"type": "text", "text": "..."}]`. Plain strings cause code `1254060` (TextFieldConvFail).
- **Refresh token rotation:** Lark refresh tokens are single-use. Persist the new one *before* using it. Treat code `20064` as "force re-auth," not retry.
- **Console version publish:** after editing scopes in the developer console, click "Create version & publish" or scopes don't take effect for OAuth (error `99991672`).

## Known team members (Assignee open_ids)

| Name | Email | open_id |
|---|---|---|
| Winney (Jingjing Feng) | winney.feng@storehub.com | `ou_51608c1bf8b218635550ac47967cd4e2` |
| Yi Wang | yi.wang@storehub.com | `ou_a7a2283efe297e66f1d1e2c6647c75f5` |
| Feida Zhang | feida.zhang@storehub.com | `ou_257d0781302b95b415c560e7ce93526b` |
| Philly Cai | philly.cai@storehub.com | `ou_af82e2a3260db7119a6caed743d920f2` |

## Why direct REST instead of MCP

- MCP is designed for an LLM client (Claude Code, Claude Desktop), not unattended scripts or long-running web apps.
- MCP streaming URLs expire after ~7 days and need regeneration — fine for dev sessions, terrible for an app that should run for months.
- The OAuth UAT we get from the Developer Console can refresh indefinitely as long as the rolling refresh token is exercised.
- Direct REST + UAT also matches what a future hosted version of flightdeck would need — no migration cost.
