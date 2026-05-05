# Lark Suite Scopes for salonx-flightdeck

**Audience:** the Lark workspace admin (storehub.sg.larksuite.com) reviewing the OAuth scope request, and the engineers wiring up the OAuth flow.

**Strategy:** request **all scopes for v1 + v2 in a single admin submission** so we don't burn another approval round when future workflows ship. Default every scope to **user access token (UAT)** — the app sees only what the signed-in user can already see in Lark. **Zero tenant scopes are requested** — see Section 2 for the analysis.

**Domain note:** all endpoints and scope strings here are for **Lark Suite** (`open.larksuite.com`), **not Feishu** (`open.feishu.cn`).

---

## 1. TL;DR — Single Combined Scope Request

Space-delimited (the format Lark's `/authen/v1/authorize` expects). URL-encode spaces as `%20` when placed in the query string.

```
offline_access bitable:app base:record:retrieve base:record:create base:record:update base:table:read base:field:read wiki:wiki:readonly drive:drive:readonly contact:user.base:readonly im:message im:message.send_as_user im:message:readonly docx:document:readonly
```

That's 14 scopes (well under Lark's 50-per-request limit). Each is **user-token compatible** — none require tenant approval.

| # | Scope | Bucket | Why we want it |
|---|---|---|---|
| 1 | `offline_access` | OAuth | Required to get a `refresh_token`; without it every API call after 2h forces re-login. |
| 2 | `bitable:app` | Bitable (legacy umbrella) | Transitional fallback during Lark's migration to fine-grained `base:*` scopes; some endpoints still gate on it. |
| 3 | `base:record:retrieve` | Bitable | List/get/search records in BD Feedback + Feature Dev. |
| 4 | `base:record:create` | Bitable | Create new rows (used by automated workflows in v2). |
| 5 | `base:record:update` | Bitable | Update Status / Priority / link DuplexLink in v1 dashboard. |
| 6 | `base:table:read` | Bitable | Discover table IDs by name; validate table existence. |
| 7 | `base:field:read` | Bitable | Read field schemas before writes (avoids the `Sub-category\n` trailing-newline class of bug). |
| 8 | `wiki:wiki:readonly` | Wiki | Resolve the SalonX Phase 2 Tracker wiki node (`LyN0w7ukQiLZ70k3yMclfCy7gwc`) to its bitable `app_token`. |
| 9 | `drive:drive:readonly` | Drive | **Defensive:** download attachment binaries if any Bitable field becomes an attachment column. No current use; costs nothing to include now. |
| 10 | `contact:user.base:readonly` | Contact | Render "Signed in as <Name> (email)" in the dashboard UI via `/authen/v1/user_info`. |
| 11 | `im:message` | IM | Prerequisite for the user-token send scope below. |
| 12 | `im:message.send_as_user` | IM (v2) | Post status pings to a Lark channel from automations, attributed to me as the user. |
| 13 | `im:message:readonly` | IM (v2) | Read messages from group chats I'm a member of (for the "Lark thread → PRD draft" workflow). |
| 14 | `docx:document:readonly` | Docs (v2) | Read Lark Docs I can already open (for the "ingest meeting notes into PRD" workflow). |

---

## 2. Tenant token scopes — must we ask for any?

**Answer: no. Zero tenant scopes are required for the workflows in scope.**

The bar set by admin is: tenant scopes only with **exact reasons why they are required**. Every operation across v1 + v2 can be accomplished as the signed-in user. Here's the audit, workflow by workflow:

| Workflow | Lark operations | UAT sufficient? | Tenant alternative considered |
|---|---|---|---|
| v1 dashboard — BD Feedback / Feature Dev CRUD, Wiki resolve, whoami | Bitable read+write, wiki get_node, user_info | ✅ Yes | None needed. |
| Future #1 — Lark thread → PRD draft | Read messages from group chats I'm a member of | ✅ Yes (`im:message:readonly`) | Tenant `im:message:readonly` would also let us read chats I'm not in — but jiaen is already in every chat we'd want to monitor. Skip. |
| Future #2 — release-notes-on-merge | Post status pings to a Lark channel I'm in | ✅ Yes (`im:message.send_as_user`) | Tenant `im:message:send_as_bot` would post as a "flightdeck-bot" identity. Cleaner-feeling but cosmetic; jiaen-as-author works. Skip. |
| Future #3 — BD row → suggest dev ticket | Read BD row, create Feature Dev row, link, post draft | ✅ Yes (already-included scopes) | None needed. |
| Future #4 — KB articles flag | None (pure GitHub Actions on local files) | N/A | None needed. |

### Tenant scopes considered and rejected

For completeness, here are the tenant scopes that are technically *adjacent* to our needs and the reason each falls below the "exact reasons why they are required" bar:

- **`bitable:app:readonly` (tenant)** — would shield us from the edge case where jiaen's UAT refresh token dies during a >30-day vacation. **Rejected:** any automation runs at least daily/hourly, which keeps the rolling refresh token alive indefinitely. Worst case is a "go re-auth" alert on first day back — annoying, not blocking.
- **`im:message:send_as_bot` (tenant)** — would post automation messages as a bot identity instead of as jiaen. **Rejected:** cosmetic; doesn't unlock new capability.
- **`contact:user.base:readonly` (tenant)** — would allow looking up *any* user's profile by `open_id`. **Rejected:** Bitable User fields (e.g. "Created By", "Assignee") already inline `name` / `en_name` / `email` / `avatar_url` directly in the API response, so no separate lookup is required. The user-token version (already in our request) covers the only case we actually need: identifying the signed-in user.
- **`drive:drive` (tenant, read+write)** — would let us upload files to Drive on the tenant's behalf. **Rejected:** flightdeck doesn't generate files that need uploading. The read-only user-token version is the defensive ask.
- **App event subscription (webhooks)** — needed for real-time event-driven workflows. **Not requested:** this is configured at app level, not as an OAuth scope, and v1/v2 are explicitly polling-only. Revisit when (a) we host the app and (b) we want real-time triggers.

### What would change this analysis

If any of the following enters scope, **revisit and request the corresponding tenant scope**:

- We want to monitor / post in Lark channels that jiaen isn't a member of.
- Multiple PMs need to use flightdeck simultaneously and we don't want a per-user OAuth dance for each.
- We want to receive Lark webhook events in real time (requires an app-level event subscription, not a scope, but typically pairs with tenant tokens).
- We want to attribute automated actions to a "flightdeck-bot" identity rather than to jiaen.

None of these are in scope today.

---

## 3. OAuth Flow Specifics for User Access Tokens

### 3.1 Endpoints (Lark Suite)

| Step | Method | URL |
|---|---|---|
| Authorize (browser redirect) | GET | `https://accounts.larksuite.com/open-apis/authen/v1/authorize` |
| Exchange code → user token | POST | `https://open.larksuite.com/open-apis/authen/v2/oauth/token` |
| Refresh user token | POST | `https://open.larksuite.com/open-apis/authen/v2/oauth/token` |
| Whoami | GET | `https://open.larksuite.com/open-apis/authen/v1/user_info` |

The v2 `/oauth/token` endpoint is the **modern** flow — accepts `client_id` + `client_secret` directly, no pre-fetched `app_access_token` needed.

### 3.2 Authorize request

```
GET https://accounts.larksuite.com/open-apis/authen/v1/authorize
  ?client_id=<APP_ID>
  &redirect_uri=<URL-encoded redirect URI registered in console>
  &response_type=code
  &scope=offline_access%20bitable:app%20base:record:retrieve%20...   ← space-delimited, URL-encoded
  &state=<CSRF nonce>
  &code_challenge=<base64url(sha256(verifier))>     ← optional, recommended
  &code_challenge_method=S256
```

- **Scope encoding:** space-delimited (spaces → `%20`). Not comma-delimited. Case-sensitive.
- **Max scopes per request:** 50.
- **Code lifetime:** 5 minutes, single-use.
- **For local-only flightdeck:** redirect URI is `http://localhost:3000/auth/lark/callback`.

### 3.3 Code → token exchange

```
POST https://open.larksuite.com/open-apis/authen/v2/oauth/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "client_id": "<APP_ID>",
  "client_secret": "<APP_SECRET>",
  "code": "<auth code from redirect>",
  "redirect_uri": "<exact same URI as authorize step>",
  "code_verifier": "<PKCE verifier if you used code_challenge>"
}
```

Response:

```json
{
  "code": 0,
  "access_token": "u-...",
  "token_type": "Bearer",
  "expires_in": 7200,
  "refresh_token": "ur-...",
  "refresh_token_expires_in": 2592000,
  "scope": "offline_access bitable:app ..."
}
```

- `access_token` is prefixed `u-`. Use as `Authorization: Bearer u-...` on every API call.
- `refresh_token` is **only returned if `offline_access` was granted**.

### 3.4 Refresh

```
POST https://open.larksuite.com/open-apis/authen/v2/oauth/token
{
  "grant_type": "refresh_token",
  "client_id": "<APP_ID>",
  "client_secret": "<APP_SECRET>",
  "refresh_token": "<previous refresh token>",
  "scope": "<optional, can downscope>"
}
```

### 3.5 TTLs and rotation

| Token | TTL | Rotation |
|---|---|---|
| Authorization code | 5 minutes | Single-use |
| `access_token` (UAT) | ~7200 s (2 h) — read `expires_in`, do not hardcode | Not rotated; just expires |
| `refresh_token` | ~30 days (~2,592,000 s) — read `refresh_token_expires_in` | **Single-use / rotating.** Each refresh call invalidates the old refresh token and returns a new one. Persist the new one immediately or the user must re-auth. Error code `20064` = "refresh token has been revoked / already used." |

### 3.6 What to do in the Lark Developer Console

1. Open `https://open.larksuite.com/app` and pick the SalonX PM-tooling app.
2. **Credentials & Basic Info** → copy `App ID` (this is your `client_id`) and `App Secret` (`client_secret`). Keep `App Secret` out of the repo (`.env.local` only).
3. **Security Settings** → **Redirect URLs** → add `http://localhost:3000/auth/lark/callback` (and any future hosted URL when we get there). Up to 300 entries; query-string `?` and fragment `#` parts are stripped.
4. **Permissions & Scopes** → add every scope from Section 1 under the **User token scopes** column. Use "Batch import" with the space-delimited string in Section 1.
5. Some scopes show an **"Apply"** button instead of a checkbox — those require workspace-admin approval. The admin sees them in the Lark Admin Console approval queue. Justifications in Section 5 are written for direct paste into the application form.
6. After admin approval, click **"Create version & publish"** so the new scope set is live for OAuth requests. (See Gotcha #10.)

---

## 4. Scope-by-Scope Reference Table

Every scope below is verified to support `user_access_token` against Lark Suite endpoints.

| Scope (exact string) | What it grants | Endpoints (in our usage) | Modern vs legacy | Docs |
|---|---|---|---|---|
| `offline_access` | Tells the OAuth server to issue a `refresh_token`. | `/authen/v2/oauth/token` (refresh) | Modern (OIDC-style) | [Get user_access_token](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token) |
| `bitable:app` | Full read/write on Bases the user can see. Umbrella scope. | All Bitable v1 endpoints — list/get/search/create/update/batch_*, list tables, list fields, list views. | Legacy umbrella | [list records](https://open.larksuite.com/document/server-docs/docs/bitable-v1/app-table-record/list) |
| `base:record:retrieve` | Read/list/search records | `GET .../records`, `POST .../records/search`, `GET .../records/{record_id}` | Modern fine-grained | [search records](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/bitable-v1/app-table-record/search) |
| `base:record:create` | Create records | `POST .../records`, `POST .../records/batch_create` | Modern fine-grained | [create record](https://open.larksuite.com/document/server-docs/docs/bitable-v1/app-table-record/create) |
| `base:record:update` | Update records (incl. `ignore_consistency_check`) | `PUT .../records/{record_id}`, `POST .../records/batch_update` | Modern fine-grained | [update record](https://open.larksuite.com/document/server-docs/docs/bitable-v1/app-table-record/update) |
| `base:table:read` | List tables, read table metadata. (Note: `:read`, not `:read_only`.) | `GET .../apps/{app_token}/tables` | Modern fine-grained | [list tables](https://open.larksuite.com/document/server-docs/docs/bitable-v1/app-table/list) |
| `base:field:read` | List fields/columns and metadata | `GET .../tables/{table_id}/fields` | Modern fine-grained | [list fields](https://open.larksuite.com/document/server-docs/docs/bitable-v1/app-table-field/list) |
| `wiki:wiki:readonly` | Read wiki nodes; resolve `node_token` → `obj_token` | `GET /open-apis/wiki/v2/spaces/get_node` | Modern fine-grained | [wiki get_node](https://open.larksuite.com/document/server-docs/docs/wiki-v2/space-node/get_node) |
| `drive:drive:readonly` | Read Drive files, including download of Bitable attachments via `file_token` | `GET /open-apis/drive/v1/files/...`, attachment download endpoints | Modern fine-grained | [Drive overview](https://open.larksuite.com/document/server-docs/docs/drive-v1/overview) |
| `contact:user.base:readonly` | Read basic profile (name, email) of the **logged-in user** via `/authen/v1/user_info` | `GET /open-apis/authen/v1/user_info` | Modern fine-grained | [user_info](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/authen-v1/user_info/get) |
| `im:message` | Send/receive single and group messages | `POST /open-apis/im/v1/messages`, `GET .../messages` | Foundational | [IM v1](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create) |
| `im:message.send_as_user` | Send a message attributed to the user (vs. as a bot). **Note: dot, not colon, before `send_as_user`** — see Gotcha #6. | `POST /open-apis/im/v1/messages` | Modern fine-grained | [Send message](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create) |
| `im:message:readonly` | Read message history in chats the user is in | `GET /open-apis/im/v1/messages` | Modern fine-grained | [List messages](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/list) |
| `docx:document:readonly` | Read Lark Docs the user can already open | `GET /open-apis/docx/v1/documents/{document_id}/raw_content` | Modern fine-grained | [Docx get document](https://open.larksuite.com/document/server-docs/docs/docs/docx-v1/document/get) |

### Modern vs legacy — why both `bitable:app` and the fine-grained `base:*` scopes

Lark is migrating from app-wide scopes (`bitable:app`, `bitable:app:readonly`) to fine-grained per-resource scopes (`base:record:retrieve`, `base:table:read`, `base:field:read`). The endpoints we use accept *either*. Strategy:

1. **Request both now.** Cheap insurance during the migration window.
2. **In ~6 months**, if all our calls succeed against fine-grained alone, drop `bitable:app` and re-test. The admin will appreciate the eventual narrowing.

The fine-grained `base:*` scopes do **not** have separate `:read_only` vs `:write` suffixes — instead they split by verb (`:retrieve`, `:create`, `:update`, `:read`). `base:record:retrieve` is the smallest read scope available.

---

## 5. Per-Scope Justifications (paste into admin approval form)

Frame: "the app acts only as me, the user, and only sees what I can see in Lark."

- **`offline_access`** — Required by Lark's OAuth v2 to issue a refresh token alongside the user access token. Without this, the app forces a full re-login every 2 hours, which makes scheduled syncs impossible. Refresh tokens can be revoked at any time from my Lark security page, so this scope does not expand permission, only persistence.

- **`bitable:app`** — Legacy umbrella scope for Lark Base. Requested as a transitional fallback during Lark's migration to fine-grained `base:*` scopes; some Bitable v1 endpoints still gate on this older scope. Bound to my user identity only — the app cannot see any Base I cannot already open in the Lark UI. We will narrow this scope away once the fine-grained `base:*` scopes cover 100% of our calls.

- **`base:record:retrieve`** — Read-only access to records in Bases I am a collaborator on. Used to list / get / search records in the SalonX Phase 2 Tracker (`MObXbnFnkafeEAsRrFUlcwrRgcf`), specifically the BD Feedback (`tbl49YoFep0cYYDd`) and Feature Development (`tblU2lOjqHwSbWor`) tables. The app cannot see records I cannot already see in Lark.

- **`base:record:create`** — Permission to create new rows in Bases I can edit. Used by automated PM workflows that file BD feedback or feature requests on my behalf. Cannot create records in any Base where I am not already an editor.

- **`base:record:update`** — Permission to edit existing rows in Bases I can edit. Used to update Status / Priority fields, link related records (DuplexLink), and write back AI-generated summaries. Bounded by my existing edit rights — cannot edit any record I cannot already edit by hand.

- **`base:table:read`** — Read-only access to table metadata (table list, table names) inside Bases I can already see. Required to discover the table IDs `tbl49YoFep0cYYDd` and `tblU2lOjqHwSbWor` programmatically rather than hardcoding them.

- **`base:field:read`** — Read-only access to field/column schemas inside tables I can already see. Required so the app validates writes against the live schema (field types, options, the `Sub-category\n` field's trailing-newline quirk) before sending an update. Prevents data-corruption bugs.

- **`wiki:wiki:readonly`** — Read-only access to Wiki nodes I can already see. The SalonX Phase 2 Tracker is registered in Wiki under node `LyN0w7ukQiLZ70k3yMclfCy7gwc`. The Wiki `get_node` endpoint resolves that wiki token to the underlying Base `app_token`. Without this scope, the only alternative is hardcoding the Base ID, which breaks if the Base is moved within the wiki tree.

- **`drive:drive:readonly`** — Read-only access to Drive files I can already open. Required to download attachment binaries (file tokens) referenced from Bitable attachment-type fields. Bound to my user identity — cannot see any Drive file I cannot already open in Lark UI.

- **`contact:user.base:readonly`** — Read basic profile fields (name, email) of the **logged-in user only** (via `/authen/v1/user_info`). Used to render "Signed in as <Name>" in the app's UI so I can confirm which account I authorized. Does not grant any access to other users' contact info.

- **`im:message`** — Send and receive messages in chats I am already a member of. Foundational scope required as a prerequisite for the user-token send scope (`im:message.send_as_user`). Cannot send to or read from any chat I am not in.

- **`im:message.send_as_user`** — Send messages **attributed to me as the user** (not as a bot) to chats I am already a member of. Used to post status updates from automated PM workflows into my designated PM channel. Messages are fully traceable to my account; the app cannot post in any chat I am not in.

- **`im:message:readonly`** — Read message history from chats I am already a member of, so the app can transcribe a Lark thread into a draft PRD. Cannot read any chat I am not in.

- **`docx:document:readonly`** — Read Lark Docs I can already open. Used to ingest meeting notes into PRD drafts in an automated workflow. Cannot read any doc I cannot already open.

---

## 6. The "whoami" endpoint

```
GET https://open.larksuite.com/open-apis/authen/v1/user_info
Authorization: Bearer u-<UAT>
```

Returns: `name`, `en_name`, `avatar_url` (+ `_thumb`/`_middle`/`_big`), `open_id`, `union_id`, `user_id`, `email`, `enterprise_email`, `tenant_key`, `mobile`, `employee_no`.

Sensitive fields gate on additional contact scopes:

- `name`, `en_name`, `avatar_url`, `open_id`, `union_id`, `tenant_key` — always returned, **no scope needed**.
- `email`, `enterprise_email` — require `contact:user.base:readonly` (in our request).
- `mobile` — would require `contact:user.phone:readonly`. **Not requested** — admin would push back, no need.
- `employee_no`, `user_id` — would require `contact:user.employee_id:readonly`. **Not requested** — `open_id` is the stable user identifier we need.

---

## 7. Gotchas

1. **Bitable advanced permissions** ("高级权限"). If a Base has Advanced Permissions on (Settings → Permissions → Advanced), the OAuth scope alone is *not enough*. The user must additionally be added as a collaborator at **both** the document permission layer (the Base file in Drive) **and** the advanced-permission layer (record/field rules inside the Base). The two collaborator lists are tracked separately. Verify each user is in both layers before they hit OAuth.

2. **User-token model means per-user trust.** Every individual user must run the OAuth dance — there's no "share my UAT with my teammate." Plan storage as one row per user (`open_id` → encrypted `refresh_token`). For salonx-flightdeck v1 (single-user, local-only), this is one row total.

3. **Refresh tokens rotate / are single-use.** As soon as you call refresh, the old refresh token is invalidated. If the new one is lost (DB write fails, race between two workers refreshing simultaneously), the user must re-auth from scratch. Mitigations: (a) serialize refresh per-user with a lock, (b) store the new token *before* deleting the old one and accept the brief overlap window, (c) treat error code `20064` as "force re-auth," not retry.

4. **Fine-grained `base:*` scopes don't always replace `bitable:app` 1:1.** Several specific endpoints (some batch endpoints, attachment upload, view operations) are still documented only with `bitable:app`. As of May 2026 the migration is incomplete. Keeping `bitable:app` in our request is the safe call; revisit in 6 months.

5. **Lark Suite ≠ Feishu scope strings.** All scopes here are confirmed against Lark Suite documentation. Don't copy scope lists from Feishu blog posts — `wiki:node:read` (sometimes seen in third-party SDK READMEs) does not exist on Lark Suite; the correct string is `wiki:wiki:readonly`.

6. **`im:message:send_as_user` vs `im:message.send_as_user`.** Lark's docs are inconsistent. The user-token sending scope on the actual scope center entry is rendered with a **dot** before `send_as_user`: `im:message.send_as_user`. The bot-only scope uses a colon: `im:message:send_as_bot`. The dot form is what we want.

7. **The authorize URL host differs from the API host.** Authorize is on `accounts.larksuite.com`; everything else (token, API) is on `open.larksuite.com`. Don't paste the same host for both.

8. **`offline_access` must be in the *initial* authorize request.** You cannot "upgrade" later. If the first OAuth dance didn't request it, no `refresh_token` is ever returned for that user — the only fix is to send the user back through `/authen/v1/authorize` with the right scope set.

9. **Empty scope-list page.** The official "Scope list" page renders the catalog from a JS component that doesn't fetch when scraped headless. Source of truth for any new scope is the **specific API endpoint's "Permission scope" section**, not the central scope-list URL.

10. **Error 99991672 — Permission required.** Common failure mode after a scope edit. Cause: scope was added in the console but a new app version was not published. After every scope edit, click **"Create version & publish"** or the change doesn't take effect for OAuth.

11. **Tenant-token columns in the developer console.** The Permissions UI in Lark's developer console has separate columns for **Tenant token scopes** and **User token scopes**. Be careful to add scopes in the **User token scopes** column only — accidentally checking the same scope under "Tenant token" will trigger a tenant-scope review from admin, defeating the whole strategy.

---

## Sources

Primary Lark Suite documentation:

- [Get user_access_token (v2 OAuth token endpoint)](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token)
- [Refresh user_access_token (single-use rotation, error 20064)](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/refresh-user-access-token)
- [Obtain OAuth code (authorize endpoint, scope encoding, PKCE)](https://open.larksuite.com/document/common-capabilities/sso/api/obtain-oauth-code)
- [Get User Information (whoami / user_info)](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/authen-v1/user_info/get)
- [Configure redirect URLs in Developer Console](https://open.larksuite.com/document/server-docs/getting-started/authen-v1/redirect-urls)
- [Lark Open Platform — Scope list (catalog index)](https://open.larksuite.com/document/server-docs/getting-started/scope-list)

Bitable / Base endpoint scope confirmations:

- [Bitable: list records](https://open.larksuite.com/document/server-docs/docs/bitable-v1/app-table-record/list)
- [Bitable: search records](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/bitable-v1/app-table-record/search)
- [Bitable: create record](https://open.larksuite.com/document/server-docs/docs/bitable-v1/app-table-record/create)
- [Bitable: update record (ignore_consistency_check)](https://open.larksuite.com/document/server-docs/docs/bitable-v1/app-table-record/update)
- [Bitable: list tables](https://open.larksuite.com/document/server-docs/docs/bitable-v1/app-table/list)
- [Bitable: list fields](https://open.larksuite.com/document/server-docs/docs/bitable-v1/app-table-field/list)
- [Bitable advanced permissions overview](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/bitable-v1/app-role/advanced-permission-guide)
- [Use Base advanced permissions (help center)](https://www.larksuite.com/hc/en-US/articles/360048488440-use-base-advanced-permissions)

Wiki / Drive / Docs:

- [Wiki get_node (resolve wiki token to obj_token)](https://open.larksuite.com/document/server-docs/docs/wiki-v2/space-node/get_node)
- [Drive v1 overview (file download)](https://open.larksuite.com/document/server-docs/docs/drive-v1/overview)
- [Docs (docx) get document](https://open.larksuite.com/document/server-docs/docs/docs/docx-v1/document/get)

IM / messaging:

- [IM v1: send message](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create)
- [IM v1: get chat history (list messages)](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/list)
- [Lark CLI — IM messages reply skill (`im:message.send_as_user` confirmation)](https://github.com/larksuite/cli/blob/main/skills/lark-im/references/lark-im-messages-reply.md)
