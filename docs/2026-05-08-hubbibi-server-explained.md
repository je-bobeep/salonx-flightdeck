# What's going on with the hubbibi server — plain-language version

Companion to `2026-05-08-hubbibi-server-audit.md`. Same findings, no jargon. Read this if you want the gist; read the technical version if you want the receipts.

## What the server is

A desktop PC sitting somewhere on your home/office LAN, running Ubuntu Linux. The hostname is **hubbibi**. It's a Gigabyte motherboard with an Intel i7-8700 (12 logical cores), 32 GB of RAM, an NVIDIA GTX 1060 graphics card, and two drives — a 230 GB SSD for the operating system and apps, and a 1 TB spinning disk used as a backup vault.

It's been on for **12 days straight without a hiccup**. Nothing has crashed. The clock is correct. The CPU is mostly bored (about 3% busy on average).

You reach it remotely through **Tailscale**, which is a private VPN — so even though you SSH'd in via the address `100.113.34.13`, that's not a public internet address. It's only reachable by devices already on your tailnet.

## What it's doing for a living

Quite a lot, actually. Think of it as your personal mini data centre. There are roughly four "tenants" sharing the box:

### 1. The auction bot

A WhatsApp bot plus a web dashboard, with a database and a Redis cache. There are **two copies** of this: a "production" one that real users hit, and a "staging" one for testing changes before they go live. The production version is exposed to the public internet through a **Cloudflare Tunnel** (`dhobbyuniverse.shop`). The staging version is internal-only.

### 2. feedback-dex

Another web app with its own backend, frontend, worker process, Postgres database (the special pgvector flavour that does AI-style similarity search), and Redis cache. All of its ports are locked to the local machine, so it's not exposed beyond the host itself unless something proxies it.

### 3. The monitoring stack

A standard set of "watch the server" tools:

- **Prometheus** — collects metrics every few seconds.
- **Grafana** — pretty dashboards built on top of Prometheus.
- **cAdvisor** — measures each container's CPU/memory.
- **node-exporter** — measures the host's CPU/memory/disk.
- **nvidia-gpu-exporter** — measures the graphics card.
- **Uptime Kuma** — pings your services and tells you when they're down.

### 4. Odds and ends

- **Portainer** — a web UI for managing the Docker containers.
- **Watchtower** — automatically updates Docker images when new versions ship.
- **Tailscale** — the VPN, running as a container.
- **Two GitHub Actions runners** — these execute build/deploy jobs for the `auction-bot` and `the-librarian` repos. When you push code to those repos, the work happens on this machine.
- **Two PM2 apps** ("payback" and "mdr-calculator") — small Node.js services managed without Docker.
- **Librarian** — a self-hosted knowledge base (the largest single thing in your home directory, 11 GB).
- **A system Postgres 16 database** — separate from the container databases.
- **Two Cloudflare tunnels** — secure pipes from this machine out to Cloudflare so things like the auction bot can be reached from the public internet without opening any ports on your router.

In total: **24 Docker containers**, plus the non-Docker stuff above. Despite all that, the machine is using less than a fifth of its RAM and barely any CPU.

## Is it healthy?

Yes. Boringly healthy.

- **Disk:** the SSD is 31% full (150 GB free), the backup drive is 2% full (860 GB free). Plenty of room.
- **Memory:** 6 GB used out of 32 GB. The rest is mostly disk cache, which is fine.
- **CPU:** average load is about 3% across all cores.
- **No errors:** nothing has crashed, no failed services, no kernel errors in the last week.
- **Time:** synced to internet time servers, no drift.
- **No suspicious logins:** zero failed SSH attempts in the last 24 hours.

## Backups

Every night at around 2-3am, automated jobs dump your databases and copy them onto the separate spinning disk (`/mnt/hdd`). Daily for `payback`, daily for `feedback-dex`, weekly for `auction-bot`, daily for `mdr-calculator`. Old backups are deleted after 7 days. This is good practice — backups live on a different physical drive from the originals, so a single disk failure can't take both out.

## Updates

Ubuntu has 23 small updates waiting:

- A point upgrade for Docker (29.4.2 → 29.4.3).
- A graphics driver update for the NVIDIA card.
- A minor image-library update.

Your machine is set to install security updates automatically (this is the `unattended-upgrades` thing), so most of the time you don't have to think about this. The graphics driver update is the only one that probably needs a reboot to actually take effect — worth doing the next time you can spare a few minutes of downtime.

The motherboard's firmware (BIOS) was last updated in January 2019. That's old — about 7 years. Not on fire, but worth a one-off afternoon to update it whenever convenient.

## Who can log in

- **You** (`elwin`) can log in over SSH using one of 4 keys you have registered. You're also in the `sudo` group, which means you can run admin commands.
- **Root** (the all-powerful admin account) cannot log in over SSH because it has no keys registered. Good.
- The `postgres` user exists for the database to run as, but no human logs in as it.

All recent SSH logins in the past two weeks have been you, coming in via Tailscale.

## The two security things worth knowing

Neither is on fire. Both are easy to fix.

### 1. Password login is still allowed for SSH

Right now, in addition to logging in with your SSH keys, the server will *also* accept a username + password if anyone tried. You don't use this — you've been using keys the whole time — but it's a door that's open without a reason. Anyone who can reach the server (so: you, plus anything else on your tailnet) could try to brute-force the password.

The fix is one config line: tell SSH to only accept keys, not passwords. Once that's set, the door is bolted shut.

### 2. The firewall doesn't actually cover the Docker apps

There's a thing called UFW (Uncomplicated Firewall) on the machine. In theory, it blocks every incoming connection except SSH. In practice, when you start a Docker container that "publishes" a port, Docker installs its own firewall rule that *bypasses* UFW and lets the traffic through.

The practical effect: anyone on your LAN — i.e. anyone connected to your home/office wifi — can reach **Grafana (port 3000)**, **Uptime Kuma (3001)**, **mall-integration-support (4000)**, **Portainer (9000)**, and **Prometheus (9090)** directly. They can't reach the auction bot, feedback-dex, or the databases, because those are correctly bound to "localhost only".

Whether that matters depends on your threat model. If your LAN is "just me and my devices", it's fine. If random guests join your wifi, those dashboards probably shouldn't be accessible to them — Portainer especially, since it can launch and stop containers. The fix is to bind the same ports to `127.0.0.1` in the docker-compose files, the way the other services already are; then they'd only be reachable through Tailscale.

Also: there's no fail2ban (the tool that auto-bans IPs after too many failed logins). Worth installing — five-minute job — even though your tailnet is small, just for hygiene.

## The "to-do if you feel like it" list

Ordered roughly by effort / payoff:

1. **Turn off SSH password login.** (One config line. ~2 min.)
2. **Install fail2ban.** (`apt install fail2ban`. ~5 min.)
3. **Reboot to apply the NVIDIA driver update.** (~10 min, schedule when nothing's mid-task.)
4. **Decide whether the LAN-exposed dashboards bother you.** If yes, edit the relevant docker-compose files to bind them to `127.0.0.1`. (~15 min.)
5. **Update the motherboard BIOS sometime.** (Non-urgent. An afternoon.)

None of these are emergencies. The server is healthy, your backups are running, your apps are up, and nothing is on fire.

## Glossary (for if any of the above tripped you up)

- **SSH** — the standard way to log into a Linux machine remotely. You type `ssh user@host` and you're in.
- **Tailscale / tailnet** — a private VPN that makes a bunch of devices act as if they're on the same network even when they're not. The `100.x.x.x` addresses you see come from Tailscale.
- **Docker / container** — a way to package an app so it brings its own libraries and runs in a sandbox. Lets you have, say, two different versions of Postgres on the same machine without them fighting.
- **docker-compose** — a config file that says "start these N containers together with this networking and these volumes". Each app on this server has one.
- **UFW** — the simple firewall tool that comes with Ubuntu.
- **Cloudflare Tunnel** — a service that creates a secure tunnel from your server out to Cloudflare, so you can publish a website to the public internet without opening any ports on your router.
- **PM2** — a tool for running Node.js apps as long-lived background processes (like a lightweight alternative to Docker for simple JS scripts).
- **systemd / service** — Linux's "things that run in the background" manager. Most of the stuff on the server is started by systemd at boot.
- **Cron** — Linux's "run this command at this time" scheduler. Your backups are scheduled with cron.
- **Prometheus / Grafana** — Prometheus collects numbers (CPU%, memory used, requests/sec) every few seconds; Grafana draws graphs of those numbers.
- **Portainer** — a web app that gives you a clickable UI for the Docker containers running on this machine.
- **GitHub Actions runner** — a process that listens for GitHub to say "hey, someone pushed code, run the tests/deploy". Self-hosted means it runs on your machine instead of GitHub's.
