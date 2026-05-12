# Deploying salonx-flightdeck to hubbibi — design sketch

Captured 2026-05-08. This is a sketch, not an implementation plan — revisit before executing.

## Why deploy at all

The locked decision in `docs/scope.md` (#4) was "local-only for v1, revisit when a second user needs access or unattended automation is required." The trigger here is **automation**: we want a worker watching Lark group chat `oc_545df3dd4bdb3b1f625ff88fbd3b9380` and auto-logging BD-request-shaped messages into the BD Feedback table. That worker needs to run 24/7, which can't happen on a laptop that sleeps.

(The `log-bd-feedback` skill already mirrored in flightdeck per CLAUDE.md encodes the BD Feedback field set and write quirks — polling essentially automates a flow that's manual today.)

This document covers only the deployment shape. The polling design itself — chat-message classification, propose-then-approve vs auto-fire, dedup state, refresh-token contention, Lark `im:message:readonly` scope verification — is a separate problem and intentionally not in scope here.

## Why a dedicated user, not just `elwin`

hubbibi already runs:

- 24 Docker containers (auction-bot, feedback-dex, monitoring, etc.) under `elwin`.
- Two GitHub Actions self-hosted runners that execute workflow code from `jackuson14/auction-bot` and `storehubai/the-librarian` as `elwin`.
- Two PM2 apps and the librarian service, also under `elwin`.

The Claude Code credential is an OAuth session for an Anthropic subscription. If it sits in `~elwin/.claude/`, anyone who can land code in any of those workflows or any of the apps running as `elwin` can read it and use the subscription. Cost: free Claude usage for the attacker, plus whatever capabilities a stolen Claude Code session brings (file tools, web fetch, etc.) running under the victim's identity.

A dedicated `flightdeck` user with a 0700 home directory cuts that blast radius down to "only flightdeck's own processes can read the credential."

## Layout on hubbibi

```
/srv/flightdeck/                    # home for the dedicated user, chmod 700
├── .claude/                         # Claude Code session (only flightdeck can read)
├── .config/gh/                      # gh CLI auth
├── .ssh/                            # authorized_keys for jiaen's desktop rsync push
├── data/                            # SQLite DB (was .data/ in repo)
│   └── tokens.db
├── scoping-outputs/                 # weekly-review markdown writes here
└── repos/
    ├── salonx-flightdeck/           # the app itself
    ├── salon-x/                     # sibling — for git log / file reads
    ├── salon-x-business/            # sibling — PRDs, decisions
    └── salonx-kb/                   # sibling — docs grep
```

## One-time bootstrap

As `root`:

```bash
useradd -m -d /srv/flightdeck -s /bin/bash flightdeck
chmod 700 /srv/flightdeck
loginctl enable-linger flightdeck    # so user-level processes persist without an active session
```

As `flightdeck` (`sudo -iu flightdeck`):

```bash
# Per-user pnpm (cleanest isolation)
curl -fsSL https://get.pnpm.io/install.sh | sh -

# Claude Code CLI — signed in to jiaen's personal Anthropic account, but as the `flightdeck` user.
# The 0700 home dir + systemd ProtectHome=true keeps the credential isolated from elwin's
# processes, GitHub Actions runners, and the other apps on hubbibi.
curl -fsSL https://claude.ai/install.sh | sh
claude login                          # device-code flow; paste URL into a browser

# gh CLI auth (system gh is fine, auth is per-user). Used by `siblings.gh_pr_search` MCP tool.
gh auth login                         # device-code flow

# Authorise jiaen's desktop SSH key for rsync push (see "Auth & sibling-repo sync" below)
mkdir -p ~/.ssh && chmod 700 ~/.ssh
# paste desktop pubkey into ~/.ssh/authorized_keys, chmod 600

# Empty repos directory — populated later by the first rsync from desktop, NOT by `git clone`
mkdir -p ~/repos
```

**Pause here.** The next commands require `~/repos/salonx-flightdeck` to exist, which only happens after the first rsync from the desktop fires. Trigger one manually from the desktop, then come back:

```bash
cd ~/repos/salonx-flightdeck
pnpm install
pnpm --filter dashboard build
```

## flightdeck config changes

`/srv/flightdeck/repos/salonx-flightdeck/apps/dashboard/.env.local`:

```ini
LARK_APP_ID=...                       # same values as your local .env.local
LARK_APP_SECRET=...
NEXTAUTH_SECRET=<fresh 32-byte random> # NOT the same as your laptop — independent cookie sessions
NEXTAUTH_URL=https://flightdeck.hubbibi.online       # see "Exposure" below
# NOTE 2026-05-12: domain is no longer active. NEXTAUTH_URL on hubbibi
# currently points at http://100.113.34.13:3002 instead (verify on the
# server's .env.local). See the "Exposure" section.
PORT=3002

FLIGHTDECK_REPO_ROOT=/srv/flightdeck/repos           # already wired in code
FLIGHTDECK_DB_PATH=/srv/flightdeck/data/tokens.db    # already wired in code
FLIGHTDECK_OUTPUT_DIR=/srv/flightdeck/scoping-outputs # added 2026-05-08
```

Status of code-side support (verified 2026-05-08):

1. **`FLIGHTDECK_DB_PATH`** ✅ already wired in 8+ files (`lib/auth/db.ts:18`, `lib/mcp-tools/tools/propose.ts:19`, `lib/services/lark-poller/state.ts:11`, `apps/dashboard/lib/{scoping-db,theme-overrides-db,scoping-telemetry,thread-context}.ts`, `apps/dashboard/app/api/data/sessions/route.ts:10`). Note the actual env var is a **file path**, not a directory — earlier sketch wrongly called it `FLIGHTDECK_DATA_DIR`.
2. **`FLIGHTDECK_REPO_ROOT`** ✅ already wired in `lib/sibling-repos/paths.ts:11`.
3. **`FLIGHTDECK_OUTPUT_DIR`** ✅ added 2026-05-08 in `lib/claude/paths.ts` — `scopingOutputsDir()` honors the env var when set.
4. **`lib/claude/mcp-config.ts`** ✅ fixed 2026-05-08 to propagate parent `FLIGHTDECK_DB_PATH` and `FLIGHTDECK_REPO_ROOT` to the spawned MCP child. Without this fix, in deployment the dashboard and MCP child would write to different DBs and the propose-then-approve flow would silently break.

## Systemd unit

`/etc/systemd/system/flightdeck.service`:

```ini
[Unit]
Description=salonx-flightdeck dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=flightdeck
Group=flightdeck
WorkingDirectory=/srv/flightdeck/repos/salonx-flightdeck/apps/dashboard
ExecStart=/srv/flightdeck/.local/share/pnpm/pnpm start
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3002
Environment=HOSTNAME=127.0.0.1

# Sandbox
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/flightdeck
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictRealtime=true
LockPersonality=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
```

`ReadWritePaths=/srv/flightdeck` is coarse but easy to reason about; tighten later to just the dirs that actually need writes (`data/`, `scoping-outputs/`, `.claude/`, `.config/`, `.cache/`, `.next/`).

`sudo systemctl daemon-reload && sudo systemctl enable --now flightdeck`.

### Poller systemd unit

`/etc/systemd/system/flightdeck-poller.service`:

```ini
[Unit]
Description=salonx-flightdeck Lark BD-feedback poller
After=network-online.target flightdeck.service
Wants=network-online.target

[Service]
Type=simple
User=flightdeck
Group=flightdeck
WorkingDirectory=/srv/flightdeck/repos/salonx-flightdeck
ExecStart=/srv/flightdeck/.local/share/pnpm/pnpm -F @flightdeck/poller start
Restart=on-failure
RestartSec=30
EnvironmentFile=/srv/flightdeck/repos/salonx-flightdeck/.env.local
Environment=NODE_ENV=production

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/flightdeck
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

The poller is a separate unit (not a worker inside the dashboard process) so it can be enabled/disabled independently. Don't enable until after a manual `pnpm poll:once` run verifies auth and classification work end-to-end.

The KILLSWITCH.md `lark-bd-poller` row gives a *no-restart* abort path: flip its Status to `disabled`, the next cycle no-ops without bouncing the service.

## Exposure (current: Tailscale-only)

> **Current state (as of 2026-05-12):** The Cloudflare Tunnel route `flightdeck.hubbibi.online` is no longer active. Access is via Tailscale only — `http://100.113.34.13:3002` from any device on the tailnet. The section below describes how the tunnel was originally set up; revive only if you need public reach again.

Decided 2026-05-08, replacing the original "tailnet-only via `tailscale serve`" plan. Reason: hubbibi's tailscale runs inside a Docker container (`tailscale/tailscale` image), so the host has no `tailscale` CLI. `tailscale serve` is unavailable.

Reuse the existing `cloudflared.service` (tunnel `mdr-calculator`) which already publishes:
- `payback.hubbibi.online` → `localhost:7788`
- `davefromsales.hubbibi.online` → `localhost:1800`

Add `flightdeck.hubbibi.online` → `localhost:3002` as a third ingress.

Edit `/home/elwin/.cloudflared/config.yml`, inserting the new entry **before** the catch-all:

```yaml
ingress:
  - hostname: davefromsales.hubbibi.online
    service: http://localhost:1800
  - hostname: payback.hubbibi.online
    service: http://localhost:7788
  - hostname: flightdeck.hubbibi.online        # ← new
    service: http://localhost:3002             # ← new
  - service: http_status:404
```

Then:

```bash
sudo systemctl reload cloudflared.service
```

Cloudflare DNS: add a CNAME for `flightdeck.hubbibi.online` → `c01ce73d-d856-4577-a807-2b524f9e6732.cfargotunnel.com` (the tunnel UUID from the existing config). Or run `cloudflared tunnel route dns mdr-calculator flightdeck.hubbibi.online` from elwin's shell.

Trade-offs vs the original tailnet-only plan:
- ✅ Real HTTPS (Lark OAuth requires it for non-localhost redirect URIs).
- ✅ Reachable from your phone without Tailscale.
- ✅ Reuses existing infra — one config line, no new systemd unit.
- ⚠️ Public on the internet. Mitigation: every page is gated by Lark OAuth; no UI without a valid session cookie. Optional follow-up: layer Cloudflare Access in front for an additional auth gate.

## Lark Developer Console

Add a second OAuth redirect URI: `https://flightdeck.hubbibi.online/auth/lark/callback`. Keep the localhost one for laptop dev. Lark allows multiple. (Note 2026-05-12: with the Cloudflare tunnel decommissioned, only the localhost + IP-based redirect URIs are currently in use.)

(Path comes from `lib/lark/env.ts` `REDIRECT_PATH` — verify before adding.)

## Order of operations

1. **On hubbibi:** create the `flightdeck` user, install CLIs, `claude login`, `gh auth login`, paste desktop pubkey into `~/.ssh/authorized_keys`.
2. **On the desktop:** install the rsync cron, fire it manually once to populate `/srv/flightdeck/repos/`.
3. **On hubbibi:** `cd ~/repos/salonx-flightdeck && pnpm install && pnpm -F salonx-flightdeck-dashboard build`.
4. **On hubbibi (elwin):** add `flightdeck.hubbibi.online` ingress to `~/.cloudflared/config.yml`, route the DNS CNAME via Cloudflare, reload `cloudflared.service`.
5. **In Lark Developer Console:** add `https://flightdeck.hubbibi.online/auth/lark/callback` as a redirect URI. Keep localhost one.
6. **On hubbibi:** write `.env.local` (final `NEXTAUTH_URL=https://flightdeck.hubbibi.online`); install both systemd units; `systemctl enable --now flightdeck` (poller stays disabled until verification).
7. **From the laptop:** open `https://flightdeck.hubbibi.online`, sign in with Lark, complete OAuth — refresh token lands in `/srv/flightdeck/data/tokens.db`.
8. Verify whoami. Run `pnpm poll:once` manually on hubbibi to verify polling works. If clean: `systemctl enable --now flightdeck-poller`.

## Auth & sibling-repo sync

**Decided 2026-05-08:** hubbibi has **no GitHub access at all**. jiaen's org policy makes deploy keys awkward, and the cleaner architecture is to keep all GitHub credentials on jiaen's desktop. Hubbibi receives both the flightdeck source and the three sibling repos via `rsync` push from desktop over Tailscale.

Trade-off accepted: sync only fires while the desktop is awake. Hubbibi's repo copies go stale during desktop downtime. For the cross-repo lookup use case in scoping flows, "since you last had your desktop on" is fine — and the polling worker (the actual 24/7 need) doesn't depend on sibling repos at all.

flightdeck's `siblings.read_file`, `siblings.git_log_grep`, and `siblings.kb_search` MCP tools read from the local copies on hubbibi, so they observe whatever staleness the rsync cadence creates. `siblings.gh_pr_search` queries GitHub's API live via the `gh` CLI (using jiaen's `gh auth login` session under the `flightdeck` user) — that one stays fresh regardless of rsync state. If jiaen's org policy also blocks GitHub PATs, this single MCP tool degrades to "unavailable"; not a v1 blocker.

### Desktop side: rsync cron

On jiaen's desktop (`crontab -e`):

```cron
*/15 * * * * rsync -a --delete --timeout=30 \
  --exclude=node_modules \
  --exclude=.next \
  --exclude=.env.local \
  --exclude=.data \
  --exclude=scoping-outputs \
  ~/all-salonx-repo/salonx-flightdeck \
  ~/all-salonx-repo/salonx-kb \
  ~/all-salonx-repo/salon-x-business \
  ~/all-salonx-repo/salon-x \
  flightdeck@hubbibi:repos/ \
  >> ~/Library/Logs/flightdeck-sync.log 2>&1
```

Notes:
- `-a` preserves perms/timestamps; `--delete` keeps the destination clean of files removed locally.
- Includes `.git/` directories — `siblings.git_log_grep` needs them. First sync transfers a few hundred MB; incrementals are tiny.
- `--timeout=30` prevents hangs if hubbibi becomes unreachable mid-sync.
- The excludes are **load-bearing**:
  - `.env.local` — hubbibi's `.env.local` differs from the desktop's (different `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `PORT`). Without this exclude, every cron tick clobbers hubbibi's config and OAuth callbacks start pointing at `localhost:3000`. This is the breakage one.
  - `node_modules` — `better-sqlite3` ships native bindings; desktop has macOS `.node` files, hubbibi runs Linux. Syncing them would push hundreds of MB of useless arch-mismatched binaries and create a window where the running process is misaligned with disk state.
  - `.next` — built fresh on hubbibi; pointless to ship.
  - `.data` and `scoping-outputs` — relocated to `/srv/flightdeck/data/` and `/srv/flightdeck/scoping-outputs/` outside the repo on hubbibi. Without the exclude these aren't broken, just wasted bytes — but excluding them keeps the picture clean.
- macOS cron only fires while the Mac is awake. It does **not** catch up missed runs. Acceptable per the trade-off above.
- If you later want sync to fire immediately on wake (instead of waiting up to 15 min), switch to `launchd` with `RunAtLoad=true` + `StartInterval=900`.

Resource cost on the desktop: ~2–10 sec of one core per fire, ~50 MB RAM transient, KB-to-MB network. Not measurable in practice.

### Hubbibi side: SSH access for the rsync push

On hubbibi as `flightdeck`:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
# Paste jiaen's desktop SSH public key into ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

That's the only auth — jiaen's desktop SSH key, scoped to the `flightdeck` user on hubbibi via Tailscale. No GitHub keys, no PATs, no GitHub-reachable credentials anywhere on the server.

### Performance (hubbibi side)

- *Disk:* ~300 MB total for the four repos including `.git/`. Trivial — you have 150 GB free on `/`.
- *Read overhead at MCP-tool call time:* `git log --grep "keyword"` over a few thousand commits is sub-second on the SSD. `grep -r` over docs is sub-second. `siblings.read_file` is free.
- *Concurrency during a sync:* rsync writes to temp files and atomically renames per-file. A `git log` running concurrently with a sync sees the old state until rename completes. Narrow race window, no correctness issue worth designing around for v1.

## Code updates (flightdeck itself)

flightdeck source arrives on hubbibi via the same rsync that syncs the siblings — no separate transport. But code updates still need a deliberate rebuild + service restart, because rsync doesn't know to run `pnpm install` or restart the systemd unit.

Manual deploy from the desktop:

```bash
# After committing + rsync has fired (or trigger one immediately with the cron command)
ssh flightdeck@hubbibi '
  cd ~/repos/salonx-flightdeck
  pnpm install
  pnpm --filter dashboard build
'
ssh elwin@hubbibi 'sudo systemctl restart flightdeck'
```

Wrap into a `scripts/deploy.sh` on the desktop once we deploy more than twice. **Don't auto-restart on every rsync** — sibling repos sync every 15 min and that would cause flightdeck to bounce constantly without any flightdeck code having changed. The deploy is intentional, the sync is automatic. **Don't use Watchtower** — that's for Docker images; flightdeck isn't a container in this design.

## What this does NOT solve

- ~~**Polling design.**~~ ✅ Resolved 2026-05-08: poller exists at `lib/services/lark-poller/`, chat ID wired in `config.ts:8`, `im:message:readonly` is in the approved scope set per `docs/lark-user-token-scopes.md` line 13. Decision: auto-fire (no propose-then-approve) since there's no human in the loop for a polling worker — explicit deviation from CLAUDE.md's general write-policy rule, captured in KILLSWITCH.md row.
- **Token contention.** Lark refresh tokens are single-use and rotate (`docs/scope.md`, CLAUDE.md). Interactive web use + a polling worker = a race. Need a single in-process scheduler that owns all token use, or a refresh mutex in SQLite. Design before shipping polling.
- **Prompt-injection blast radius.** The Claude subprocess can read anything `flightdeck` can read — the SQLite tokens DB included. The dedicated-user setup limits this to flightdeck's own files plus the sibling repos (sibling content is non-sensitive — public-ish code, docs). Acceptable, but worth keeping in mind when designing what context flightdeck feeds into Claude.
- **Backups for `tokens.db`.** Holds proposed actions, scoping conversations, and the Lark refresh token. Add a daily dump to `/mnt/hdd/backups/` alongside the existing Postgres dumps. Two lines of cron.
- **Observability.** Nothing wired to Prometheus yet. If flightdeck OOMs or its Claude subprocesses leak memory, you'll find out via Uptime Kuma noticing the port is unreachable. Fine for v1; revisit if it gets noisy.

## Decisions made 2026-05-08

- **GitHub access on hubbibi:** none. Org policy makes deploy keys awkward, and we don't need server-side GitHub auth if all repos arrive via rsync from the desktop. All GitHub credentials stay on jiaen's desktop. Server can't talk to GitHub by design.
- **Sibling-repo sync:** `rsync` push from desktop → hubbibi every 15 min via macOS cron. Fires only while desktop is awake; staleness during desktop downtime is acceptable for the planning use case. Polling-the-Lark-chat (the actual 24/7 need) doesn't depend on sibling repos.
- **Polling location:** hubbibi (not desktop), because the chat watcher needs to run continuously and the desktop sleeps.
- **Claude Code account:** jiaen's personal Anthropic subscription, signed in as the `flightdeck` user (not elwin). Credential isolation comes from the dedicated user + 0700 home + `ProtectHome=true` in the systemd unit. Trust boundary is "elwin and root", which is acceptable.
- **`gh` CLI on hubbibi:** kept for `siblings.gh_pr_search`, signed in under the `flightdeck` user using whatever GitHub auth jiaen's org permits (likely a fine-grained PAT). If org policy forbids that too, this single MCP tool degrades to "unavailable" — not a blocker for v1.
- **Exposure mechanism:** Cloudflare Tunnel via the existing `mdr-calculator` tunnel on hubbibi. Original "tailnet-only via `tailscale serve`" plan was abandoned because tailscale runs in a Docker container on hubbibi, leaving no host CLI. Cloudflare Tunnel reuses existing infrastructure (one ingress line in `~/.cloudflared/config.yml`), gives proper HTTPS that Lark OAuth requires, and the OAuth gate is the access-control mechanism. Public on the internet but not browsable without a Lark login.
- **Polling at first deploy:** enabled. KILLSWITCH.md `lark-bd-poller` row controls whether new cycles do work; flipping to `disabled` no-ops the next cycle without restarting the service.

## Open questions

- Is `elwin` (server owner) happy with us creating system-level config (the `flightdeck` user, two systemd units, one new ingress in `~/.cloudflared/config.yml`) on hubbibi? Coordinate before executing.
- Does jiaen's org policy permit `gh auth login` with a fine-grained PAT under the `flightdeck` user on hubbibi? If not, `siblings.gh_pr_search` is unavailable — confirm we're OK shipping v1 without live PR search.
