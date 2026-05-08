---
name: Metabase iframe embedding blocked at metabase.shub.us
description: metabase.shub.us refuses iframe embeds via X-Frame-Options/frame-ancestors and the user lacks admin access to change it — affects any "embed Metabase in flightdeck" plan
type: project
---

`metabase.shub.us` (StoreHub Metabase instance) sends `X-Frame-Options: DENY` (or `Content-Security-Policy: frame-ancestors 'none'`) and blocks iframe embedding from `http://localhost:3000`. Confirmed 2026-05-07 when attempting plain-iframe embed of dashboard 374-salonx — browser shows "metabase.shub.us refused to connect".

**Why:** The flightdeck user (jiaen) does NOT have admin access to `metabase.shub.us` and cannot toggle Admin → Settings → Embedding → Authorized origins. So the simplest option (plain iframe relying on the user's existing Metabase session cookie) is unavailable without an external admin conversation.

**How to apply:** When the user asks to embed Metabase content into flightdeck (or any other localhost tool), don't propose a plain `<iframe>` of the dashboard URL as the default — it will be blocked. Default proposals should be:
1. Ask them to request the admin allowlist localhost (lowest-effort win, but requires admin cooperation).
2. External link fallback (sidebar item opens Metabase in a new tab) — trivial and unblocked.
3. Native rendering via Metabase REST API (`POST /api/session` then `POST /api/card/:id/query`) — most work, no admin dependency, full control.
4. Public-link-per-dashboard requires the same admin conversation as #1 (global "public sharing" toggle), so it doesn't dodge the bottleneck.

The signed-JWT embed path (option #2 in the original conversation) is also gated behind admin enabling embedding, so it has the same dependency as #1.
