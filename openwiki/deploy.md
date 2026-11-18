# Deploy

The app is one Docker container: a Node server that serves the API and the static UI, with SQLite in `./data`.

## Quick start

```bash
git clone https://github.com/okaldev/life-agile.git && cd life-agile
docker compose up -d --build
```

Open `http://localhost:8080`. With no users, the app shows the first-run page `/kurulum`: the first account is the admin. The admin invites other people from Ayarlar → Kişiler.

## Environment

All values are optional. Put them in `.env` (see `.env.example`). Docker Compose reads it when it exists.

| Name | Default | Use |
|---|---|---|
| `PUBLIC_URL` | address of the request | Public address. Needed for Google login, invite links and `Secure` cookies (https) |
| `HOST_PORT` | `8080` | Host port in `docker-compose.yml` |
| `APP_TIMEZONE` | `Europe/Istanbul` | IANA time zone for days, sprints and reminders |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | empty (off) | Google login. Redirect URI `PUBLIC_URL/auth/google/callback` |
| `ALLOWED_EMAILS` | empty | `email:Name` pairs, created at start |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `data/vapid.json` | Web Push keys. Created on the first start when empty |
| `SOURCE_URL` | this repository | "Kaynak kodu" link in the app (AGPL-3.0) |
| `DB_PATH` | `data/agile.db` | SQLite file |
| `DEV_LOGIN` | off | `1` only for local development (refused in production) |

## HTTPS and a reverse proxy

Run the container behind a proxy that terminates TLS (Caddy, Traefik, nginx) and set `PUBLIC_URL=https://your.domain`. Forward the whole site to port 8080. The SSE stream (`/api/events`) needs response buffering off (the app sends `X-Accel-Buffering: no`).

To keep machine-specific settings (proxy labels, networks) out of git, put them in `docker-compose.override.yml`. Docker Compose merges it automatically. Example for Traefik:

```yaml
services:
  life-agile:
    ports: !reset []
    networks: [web]
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.life-agile.rule=Host(`agile.example.com`)"
      - "traefik.http.routers.life-agile.tls.certresolver=letsencrypt"
      - "traefik.http.services.life-agile.loadbalancer.server.port=8080"
networks:
  web:
    external: true
```

## Update

```bash
git pull && docker compose up -d --build
```

Migrations run at start, in one transaction each, and are additive only.

## Backups and restore

- Daily: the scheduler writes `data/backups/agile-YYYY-MM-DD.db` at 03:00 and keeps 30 files.
- Copy `data/` to keep everything (database, backups, VAPID keys).

Restore:

```bash
docker compose stop
cp data/agile.db data/agile.db.broken-$(date -u +%Y%m%dT%H%M%SZ)
rm -f data/agile.db-wal data/agile.db-shm
cp data/backups/agile-<date>.db data/agile.db
docker compose up -d
```

## Local development

```bash
npm install && npm --prefix web install
DEV_LOGIN=1 node --watch server/src/index.ts   # API + static UI on :8080, dev login with Alice/Bob
npm --prefix web run dev                       # UI on :4321, proxies /api and /auth
npm test                                       # server tests
```

`npm run demo:seed` creates `data/demo.db` with sample data (see README).

## Maintainer deploy script

`scripts/ship.sh` tests, builds, commits and deploys to one server over SSH. The target comes from `deploy.local/ship.env` (not in git; `HOST`, `REMOTE_DIR`, `CONTAINER`, `SITE_URL`). It copies `deploy.local/docker-compose.override.yml` to the server, never touches the server `data/` or `.env`, and takes a `VACUUM INTO` backup (`data/backups/pre-deploy-*.db`, keeps 10) before every deploy. Flags: `--no-deploy`, `--deploy-only`, `--no-test`, `-b "body"`.
