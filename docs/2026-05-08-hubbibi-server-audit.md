# hubbibi server audit — 2026-05-08

Audit of `elwin@100.113.34.13` (hostname `hubbibi`) captured Fri 2026-05-08 10:17 +08 over Tailscale SSH. The `100.113.34.13` address is in Tailscale's CGNAT range (100.64/10), so the host is reached over the tailnet rather than the public internet.

## TL;DR

| Area | Status | Notes |
|---|---|---|
| Uptime / health | 🟢 | Up 12d, load 0.4 / 12 cores, no failed units, no kernel errors |
| Disk | 🟢 | / 31%, /boot 11%, /mnt/hdd 2% — plenty of headroom |
| Memory | 🟢 | 5.8 / 31 GiB used, 36 MiB swap |
| SSH security | 🟡 | Password auth **enabled**, no fail2ban, root login `without-password` (but root `authorized_keys` is empty so effectively keys-only) |
| Firewall | 🟡 | UFW active but only allows 22/tcp; all the other listening ports (3000/3001/4000/9000/9090) are exposed because Docker bypasses UFW via the `DOCKER` chain |
| Updates | 🟡 | 23 packages upgradable (NVIDIA 570 driver + docker-ce 29.4.2→29.4.3 + libheif). Unattended-upgrades is enabled. |
| Backups | 🟢 | Daily pg_dumps + app backups land on `/mnt/hdd/` (separate physical disk), 7-day retention cron present |
| Failed logins (24h) | 🟢 | 0 |

Two items worth attention: (1) password SSH on the tailnet, (2) UFW gives a false sense of port restriction because Docker publishes ports outside UFW.

---

## 1. Host

| | |
|---|---|
| Hostname | `hubbibi` (static) |
| Chassis | desktop (Gigabyte Z390 M GAMING, BIOS F5c, 2019-01-16 — **firmware 7y old**) |
| OS | Ubuntu 24.04.4 LTS (Noble) |
| Kernel | Linux 6.8.0-110-generic |
| Architecture | x86_64 |
| Virtualization | none (bare metal) |
| Timezone | Asia/Kuala_Lumpur, NTP active, clock synced |
| Uptime | 12 days, 3:19 |
| Machine ID | `07347f43e87941f4904f14f20d4abb6a` |

### Hardware

- **CPU:** Intel Core i7-8700 @ 3.20 GHz — 6 cores / 12 threads, max 4.6 GHz, VT-x.
- **RAM:** 31 GiB total · 5.8 GiB used · 22 GiB buff/cache · 25 GiB available · swap 4 GiB (36 MiB used).
- **GPU:** NVIDIA GeForce GTX 1060 6 GB, driver 570.211.01, CUDA 12.8 — currently idle (10 W, 43 °C, 0% util, 3 MiB VRAM in use).
- **Storage:**
  - `/` — `/dev/mapper/ubuntu--vg-ubuntu--lv` ext4 on NVMe, 227 GB, **65 GB used (31%)**, 150 GB free.
  - `/boot` — `nvme0n1p2`, 2 GB, 200 MB used (11%).
  - `/mnt/hdd` — `sda1` (931 GB spinning disk), **11 GB used (2%)**, 860 GB free. Used for backups.

### Load & top processes

Load average **0.41 / 0.35 / 0.37** on 12 logical cores → idle.

Top by RSS (resident set):

| PID | User | RSS | Process |
|---|---|---|---|
| 104343 | root | 1.0 GB | `dockerd` |
| 3768347 | root | 720 MB | `node .output/server/index.mjs` (likely auction-bot web staging) |
| 3768606 | elwin | 380 MB | `tsx services/bot/index.ts` (auction-bot wa staging) |
| 725683 | elwin | 300 MB | `tsx services/bot/index.ts` (auction-bot wa prod) |
| 2045884 | elwin | 290 MB | `node server.mjs` (mdr-calculator pm2) |
| 1760598 | nobody | 260 MB | Prometheus |
| 1760601 | uid 472 | 160 MB | Grafana |

---

## 2. Network

### Interfaces

- `eno1` — physical NIC, **192.168.204.7/22** (LAN), gateway 192.168.204.1, DHCP.
- `lo` — 127.0.0.1.
- 8 docker bridges (`docker0`, `br-*`) on 172.17–172.25.0.0/16 — `docker0` is `linkdown` (unused), the rest are populated by compose stacks.
- ~20 `veth*` pairs into containers.

DNS via systemd-resolved stub (127.0.0.53). No additional `/etc/hosts` overrides.

### Listening ports

Public-facing on `0.0.0.0` (reachable from LAN + tailnet):

| Port | Process | Purpose |
|---|---|---|
| 22 | sshd | SSH |
| 3000 | docker-proxy → Grafana | Grafana UI |
| 3001 | docker-proxy → Uptime Kuma | Uptime Kuma UI |
| 4000 | docker-proxy → mall-integration-support | App container :3000 |
| 9000 | docker-proxy → Portainer | Portainer UI |
| 9090 | docker-proxy → Prometheus | Prometheus UI |

Loopback only (`127.0.0.1`):

- 8787 (node), 3100/3101 (auction-bot web prod/staging), 4010 (feedback-dex backend), 8080/8081 (feedback-dex frontend / adminer), 5432 (postgres 16), 20241/20242 (cloudflared metrics).

Tailscale UDP listener on 0.0.0.0:60270 (control plane).

Two `cloudflared` tunnel processes are running — one of them is `cloudflared-auction.service` ("Cloudflare Tunnel for auction-bot (dhobbyuniverse.shop)"), so at least the auction-bot is exposed publicly via Cloudflare Tunnel.

### Firewall

UFW is **active** with default `deny incoming / allow outgoing / deny routed`, but the only explicit allow rule is `22/tcp` from anywhere. Everything else listening on 0.0.0.0 (Grafana, Prometheus, Portainer, Uptime Kuma, mall-integration-support) is reachable because **Docker installs its own iptables `DOCKER` chain ahead of UFW** and accepts traffic to published container ports directly. This is the well-known Docker/UFW interaction, not a misconfiguration per se, but it's worth knowing UFW is not actually gating those ports.

Fail2ban is **not installed / inactive**.

---

## 3. Identity & access

### Users with login shells

| User | UID | Home | Shell |
|---|---|---|---|
| root | 0 | /root | /bin/bash |
| elwin | 1000 | /home/elwin | /bin/bash |
| postgres | 110 | /var/lib/postgresql | /bin/bash |

`sudo` group: `elwin` only. No `wheel` group.

### SSH

- `~/.ssh/authorized_keys` for elwin: **4 keys**, last touched 2026-05-08 10:15 (today). Also a `github_deploy` ED25519 keypair — likely a deploy key for repo access.
- `/root/.ssh/authorized_keys` — **empty file**. So even though sshd has `PermitRootLogin without-password`, root SSH is effectively closed.

### Effective sshd config

```
port 22
permitrootlogin without-password
pubkeyauthentication yes
passwordauthentication yes      ← password auth allowed
permitemptypasswords no
maxauthtries 6
x11forwarding yes
```

🟡 **Findings:**

1. `passwordauthentication yes` — anyone on the LAN or tailnet who reaches port 22 can attempt password auth. With no fail2ban, brute-force is rate-limited only by sshd itself.
2. `PermitRootLogin without-password` is fine in practice (empty root authorized_keys) but I'd set it to `prohibit-password` or `no` for belt-and-braces.
3. `X11Forwarding yes` is on by default; harmless on this host but unneeded for a server role.

### Recent activity

- 0 failed SSH attempts in the last 24 h (`journalctl -u ssh`).
- All `last` entries in the past two weeks are `elwin from 127.0.0.1` — i.e. tailnet-routed (Tailscale rewrites peer IPs to 127.0.0.1 in `last` when SSH is via the tailnet).

---

## 4. Services & workloads

### Systemd services (running, non-default)

- `docker.service` + `containerd.service` — container runtime.
- `pm2-elwin.service` — PM2 manager for elwin.
- `cloudflared.service` + `cloudflared-auction.service` — two Cloudflare tunnels (auction-bot + a default one).
- `librarian.service` — "Librarian — self-hosted KB service".
- `actions.runner.jackuson14-auction-bot.hubbibi-auction-bot.service` — GitHub Actions self-hosted runner for `jackuson14/auction-bot`.
- `actions.runner.storehubai-the-librarian.hubbibi-librarian.service` — GitHub Actions self-hosted runner for `storehubai/the-librarian`.
- `postgresql@16-main.service` — system Postgres 16 (separate from container Postgres).
- `nvidia-persistenced.service` — NVIDIA persistence daemon.
- `unattended-upgrades.service` — auto security updates.

No failed units. Boot is clean.

### PM2 (user `elwin`)

| id | name | uptime | mem | status |
|---|---|---|---|---|
| 0 | payback | 44h | 75 MB | online |
| 2 | mdr-calculator | 40h | 75 MB | online |

### Docker containers (24 running)

Grouped by stack:

**Auction-bot (prod)** — `auction-bot-wa`, `auction-bot-web` (→ 127.0.0.1:3100), `auction-bot-redis`, `auction-bot-db` (postgres 16-alpine).

**Auction-bot (staging)** — `auction-bot-wa-staging`, `auction-bot-web-staging` (→ 127.0.0.1:3101), `auction-bot-redis-staging`, `auction-bot-db-staging`, `auction-bot-adminer` (→ 127.0.0.1:8081).

**feedback-dex** — `feedback-dex-backend` (→ 127.0.0.1:4010), `feedback-dex-worker`, `feedback-dex-frontend` (→ 127.0.0.1:8080), `feedback-dex-redis`, `feedback-dex-postgres` (pgvector/pg17).

**Monitoring** — `prometheus` (:9090), `grafana` (:3000), `cadvisor`, `node-exporter`, `nvidia-gpu-exporter`, `uptime-kuma` (:3001).

**Misc** — `mall-integration-support` (:4000), `portainer` (:9000), `watchtower` (auto-updater), `tailscale` (containerised tailscaled).

Compose files live under `/home/elwin/docker/{tailscale,watchtower,uptime-kuma,portainer,llm,monitoring}` and `/home/elwin/apps/{feedback-dex,auction-bot-staging}`.

### Cron (user `elwin`)

```
0  3 * * *   pg_dump -Fc payback | gzip > /mnt/hdd/backups/payback-<ts>.sql.gz
5  3 * * *   find /mnt/hdd/backups -name "*.sql.gz" -mtime +7 -delete
0  9 * * *   curl …/api/cron/daily-reminder (payback)
30 2 * * *   /home/elwin/apps/mdr-calculator/scripts/mdr-backup.sh
0  4 * * 0   /home/elwin/scripts/auction-backup.sh        (Sundays)
0  2 * * *   /home/elwin/scripts/backup-feedback-dex-pg.sh
```

System cron has only the default Ubuntu jobs (apport, apt-compat, logrotate, man-db, sysstat).

---

## 5. Storage usage in `~`

```
16K   /home/elwin/scripts
36K   /home/elwin/tailscale-data
100K  /home/elwin/backups
17M   /home/elwin/logs
26M   /home/elwin/repos
2.4G  /home/elwin/actions-runners   ← GH Actions self-hosted runner workspaces
4.7G  /home/elwin/docker            ← compose stacks
5.4G  /home/elwin/apps              ← feedback-dex + auction-bot-staging
11G   /home/elwin/kb                ← largest single subtree
```

`/mnt/hdd` is the backup target — only 11 GB used of 916 GB. Backups won't run out of space any time soon.

---

## 6. Updates

`unattended-upgrades` is enabled and running (`APT::Periodic::Unattended-Upgrade "1"`).

23 packages currently upgradable — all from `noble-updates`:

- `docker-ce`, `docker-ce-cli`, `docker-ce-rootless-extras` 29.4.2 → 29.4.3
- NVIDIA 570 stack 0ubuntu0.24.04.2 → 0ubuntu1.24.04.1 (driver, dkms, utils, libnvidia-*, xserver-xorg-video-nvidia)
- libheif 1.17.6-1ubuntu4.2 → 4.3
- distro-info-data

The NVIDIA driver upgrade typically requires a reboot to take effect. Docker minor bump is rolling.

965 dpkg packages installed. No snaps, no flatpaks.

---

## 7. Recommendations

Ordered by effort/impact:

1. **Disable SSH password auth** (`PasswordAuthentication no` in `/etc/ssh/sshd_config.d/`, then `systemctl reload ssh`). All 4 of your authorized keys clearly work; passwords are pure attack surface.
2. **Tighten root SSH**: `PermitRootLogin no` (or `prohibit-password`). Currently it's `without-password` with an empty key file — works but is sloppy.
3. **Install fail2ban** (`apt install fail2ban`) — 5-minute setup, default jail covers sshd. Useful even on tailnet-only because tailscale ACLs aren't a substitute for per-IP rate limiting.
4. **Apply available updates**, especially the NVIDIA 570 stack. Schedule a reboot window since the driver upgrade needs it. Docker minor bump can be rolled with `docker compose pull && up -d` per stack (or watchtower will get to it).
5. **Remember UFW does not gate Docker-published ports**. If you want Grafana / Prometheus / Portainer / Uptime Kuma / mall-integration-support not exposed on the LAN, either bind them to `127.0.0.1` in the compose files (like you've done for adminer, feedback-dex, auction-bot-web) or add `iptables` rules in the `DOCKER-USER` chain. Reaching them via Tailscale is fine; LAN-wide exposure may not be intended.
6. **Firmware**: the BIOS is from January 2019 (7+ years old). Not urgent, but Gigabyte has likely shipped microcode + security updates since. Worth a one-off update window.
7. **Note**: two GitHub Actions self-hosted runners are running with full elwin-level access. They'll execute any workflow scoped to those repos. Make sure those repos restrict who can push workflow changes.

---

## 8. Raw command summary

Captured via SSH:

- `uname -a`, `uptime`, `hostnamectl`, `timedatectl`, `systemd-detect-virt`
- `lscpu`, `free -h`, `df -hT`, `lsblk`, `nvidia-smi`
- `ip -br addr/route`, `ss -tulnp`, `cat /etc/hosts /etc/resolv.conf`
- `sudo sshd -T`, `ufw status verbose`, `iptables -L -n`, `fail2ban-client status`
- `awk /etc/passwd`, `getent group sudo`, `last -n 20`, `who`, `ls -la ~/.ssh /root/.ssh`
- `systemctl list-units/list-unit-files/list-timers`, `systemctl --failed`
- `docker ps`, `docker images`, `docker compose` discovery via `find`
- `crontab -l`, `ls /etc/cron.*`
- `apt list --upgradable`, `dpkg -l | wc -l`, `snap list`
- `pm2 list`, `tailscale status`
- `journalctl -u ssh -S "24 hours ago"`, `journalctl -k -p err -S "7 days ago"`

No write actions taken. Everything was read-only.
