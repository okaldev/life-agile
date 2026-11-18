#!/usr/bin/env bash
# Server-side deploy of one commit. Runs on the server, from the app folder (a git clone).
#
#   scripts/deploy-server.sh <40-char commit SHA>
#
# The CI deploy key may run only this script (forced command in authorized_keys):
#   command="/path/to/life-agile/scripts/deploy-server.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... ci-deploy
# The SHA then comes from SSH_ORIGINAL_COMMAND.
#
# Steps: lock -> fetch -> the commit must be on origin/main -> DB backup -> checkout -> build and start
# -> health check -> on failure, back to the previous commit and image.
# It never touches data/, .env or docker-compose.override.yml (all untracked), and never runs git clean.
# See openwiki/deploy.md (Automatic deploy).

# The whole script is one function, so bash reads it fully before it runs. A checkout can then
# replace this file safely while it runs.
main() {
  set -euo pipefail
  local app_dir sha prev container ts backup
  app_dir="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
  cd "$app_dir"
  container="${CONTAINER:-life_agile}"

  sha="${1:-${SSH_ORIGINAL_COMMAND:-}}"
  sha="${sha#deploy }"
  if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "usage: deploy-server.sh <40-char commit sha>" >&2
    exit 2
  fi

  exec 9>"$app_dir/data/.deploy.lock"
  if ! flock -w 600 9; then
    echo "another deploy is running" >&2
    exit 3
  fi

  log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$app_dir/data/deploy.log"; }

  log "request $sha"
  git fetch --quiet origin main
  if ! git merge-base --is-ancestor "$sha" origin/main; then
    log "refused: $sha is not on origin/main"
    exit 4
  fi
  prev="$(git rev-parse HEAD)"
  if [[ "$prev" == "$sha" ]] && docker inspect "$container" >/dev/null 2>&1; then
    log "already at $sha"
    exit 0
  fi

  # Backup of the live DB before a new image can run a migration. Keep the newest 10.
  if docker inspect "$container" >/dev/null 2>&1; then
    ts="$(date -u +%Y%m%dT%H%M%SZ)"
    backup="$(docker exec "$container" node -e "
      const fs = require('node:fs');
      const { DatabaseSync } = require('node:sqlite');
      fs.mkdirSync('data/backups', { recursive: true });
      new DatabaseSync('data/agile.db').exec(\"VACUUM INTO 'data/backups/pre-deploy-$ts.db'\");
      for (const f of fs.readdirSync('data/backups').filter((f) => /^pre-deploy-.*\\.db\$/.test(f)).sort().slice(0, -10))
        fs.rmSync('data/backups/' + f);
      console.log('pre-deploy-$ts.db');
    ")" || { log "backup failed, nothing deployed"; exit 5; }
    log "backup $backup"
    docker image inspect life-agile:latest >/dev/null 2>&1 && docker tag life-agile:latest life-agile:previous
  fi

  git -c advice.detachedHead=false checkout --quiet --force "$sha"
  log "checkout $sha (was $prev)"

  if docker compose up -d --build --quiet-pull >/dev/null 2>"$app_dir/data/.deploy.err" && healthy "$container"; then
    log "ok $sha"
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi

  log "FAILED $sha, rolling back to $prev"
  tail -20 "$app_dir/data/.deploy.err" >&2 || true
  docker logs --tail 30 "$container" >&2 2>&1 || true
  git -c advice.detachedHead=false checkout --quiet --force "$prev"
  if docker image inspect life-agile:previous >/dev/null 2>&1; then
    docker tag life-agile:previous life-agile:latest
    docker compose up -d --no-build >/dev/null 2>&1 || true
  else
    docker compose up -d --build >/dev/null 2>&1 || true
  fi
  if healthy "$container"; then log "rolled back to $prev"; else log "ROLLBACK UNHEALTHY, check the server"; fi
  exit 1
}

# Container runs, did not restart, and /api/health answers from inside the container.
healthy() {
  local i
  for i in $(seq 1 20); do
    sleep 3
    if [[ "$(docker inspect -f '{{.State.Status}}' "$1" 2>/dev/null)" == running ]] &&
      docker exec "$1" node -e "fetch('http://127.0.0.1:8080/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

main "$@"
