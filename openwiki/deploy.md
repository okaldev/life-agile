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
| `HOLIDAYS` | `TR` | Public holidays on the calendars and in capacity: `TR` (Turkey) or `none` |
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

## Automatic deploy (maintainer)

`.github/workflows/ci.yml` runs the tests, the type check and the web build on every push and pull request. A push to `main` of `okaldev/life-agile` then runs the `deploy` job:

1. The job runs only on `main`, only in the `production` GitHub environment (branch policy: `main` only), only when the repo variable `DEPLOY_ENABLED` is `true` (the on/off switch), one at a time (`concurrency: production`).
2. It connects over SSH with a deploy key from the environment secrets (`DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER`, `DEPLOY_KNOWN_HOSTS`; strict host key check).
3. On the server, `authorized_keys` binds that key to one forced command: `scripts/deploy-server.sh` (`no-pty`, no forwarding). The key cannot open a shell. It sends `deploy <sha>`.
4. `scripts/deploy-server.sh` (the server folder is a git clone of the public repo):
   - takes a lock, fetches `origin/main` over HTTPS (no credentials), refuses a SHA that is not on `main`;
   - writes `data/backups/pre-deploy-<UTC>.db` with `VACUUM INTO` (keeps 10) and tags the running image `life-agile:previous`;
   - checks out the SHA, runs `docker compose up -d --build`, and checks `/api/health` inside the container;
   - on failure: checks out the previous commit, starts `life-agile:previous`, and logs to `data/deploy.log`.
   - It never touches `data/`, `.env`, `docker-compose.override.yml` and never runs `git clean`.

Pull requests and forks never get the secrets (`pull_request` events have no secrets; `pull_request_target` is not used). Workflows from outside contributors need approval. `main` blocks force pushes and deletion.

Stop automatic deploys: set `DEPLOY_ENABLED` to `false`. Revoke the key: remove its line from the server `authorized_keys`.

## Maintainer script

`scripts/ship.sh` tests, builds, commits, pushes `main`, waits for the CI run (`gh run watch`) and checks `SITE_URL` from `deploy.local/ship.env` (not in git). `--direct` deploys over the maintainer's own SSH key (`ssh HOST REMOTE_DIR/scripts/deploy-server.sh <sha>`) when GitHub Actions is down. Flags: `--no-deploy`, `--deploy-only`, `--no-test`, `--direct`, `-b "body"`.
