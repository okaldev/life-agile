#!/usr/bin/env bash
# Commit + deploy in one command, with short output.
#
# Usage:
#   scripts/ship.sh -m "feat: message" [file ...]   # test, build, commit the files, deploy, verify
#   scripts/ship.sh -m "fix: x" -b "body text" a.ts # add a commit body
#   scripts/ship.sh --no-deploy -m "docs: x" f.md   # commit only
#   scripts/ship.sh --deploy-only                   # deploy the current tree, no commit
#   scripts/ship.sh --no-test ...                   # skip tests and web build
#
# With no files, the script commits what is already staged.
# It never touches the server data/ directory or .env.
#
# This is the maintainer's deploy script. The target comes from deploy.local/ship.env (not in git):
#   HOST, REMOTE_DIR, CONTAINER, SITE_URL
# deploy.local/docker-compose.override.yml (optional) is copied to the server as docker-compose.override.yml.
set -euo pipefail

cd "$(dirname "$0")/.."

HOST="" REMOTE_DIR="" CONTAINER="life_agile" SITE_URL=""
[[ -f deploy.local/ship.env ]] && source deploy.local/ship.env
OVERRIDE="deploy.local/docker-compose.override.yml"
TRAILER="Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEPLOY_PATHS=(server shared web Dockerfile .dockerignore docker-compose.yml package.json package-lock.json openwiki .env.example)

msg="" body="" do_test=1 do_commit=1 do_deploy=1
files=()
while (($#)); do
  case "$1" in
    -m) msg="$2"; shift 2 ;;
    -b) body="$2"; shift 2 ;;
    --no-test) do_test=0; shift ;;
    --no-deploy) do_deploy=0; shift ;;
    --deploy-only) do_commit=0; do_test=0; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    --) shift; files+=("$@"); break ;;
    *) files+=("$1"); shift ;;
  esac
done

log() { printf '[ship] %s\n' "$*"; }
fail() { printf '[ship] FAIL: %s\n' "$*" >&2; exit 1; }

# 1. Tests, type check and web build (output only on failure).
if ((do_test)); then
  out=$(mktemp)
  if npm test --silent >"$out" 2>&1; then
    log "tests: $(grep -E '^ℹ pass' "$out" | sed 's/ℹ //') $(grep -E '^ℹ fail' "$out" | sed 's/ℹ //')"
  else
    grep -E 'not ok|Error|assert|✖' "$out" | head -30 >&2
    rm -f "$out"; fail "tests failed, nothing committed or deployed"
  fi
  if ! npx tsc -p . >"$out" 2>&1; then
    head -20 "$out" >&2; rm -f "$out"; fail "server type check failed"
  fi
  [[ -d web/node_modules ]] || npm --prefix web ci --no-audit --no-fund >/dev/null 2>&1 || fail "npm ci failed"
  if npm --prefix web run build >"$out" 2>&1; then
    log "web build: ok ($(grep -oE '[0-9]+ page\(s\) built' "$out" | tail -1))"
  else
    grep -iE 'error' "$out" | head -20 >&2; rm -f "$out"; fail "web build failed, nothing committed or deployed"
  fi
  rm -f "$out"
fi

# 2. Commit.
if ((do_commit)); then
  [[ -n "$msg" ]] || fail "missing -m \"message\""
  if ((${#files[@]})); then git add -- "${files[@]}"; fi
  git diff --cached --quiet && fail "nothing staged to commit"
  full="$msg"
  [[ -n "$body" ]] && full+=$'\n\n'"$body"
  full+=$'\n\n'"$TRAILER"
  git commit -q -m "$full"
  log "commit: $(git log -1 --format='%h %s') ($(git show --stat --format= HEAD | tail -1 | sed 's/^ *//'))"
fi

((do_deploy)) || { log "deploy skipped"; exit 0; }
[[ -n "$HOST" && -n "$REMOTE_DIR" && -n "$SITE_URL" ]] || fail "deploy target missing: create deploy.local/ship.env (HOST, REMOTE_DIR, SITE_URL)"

# 3. Sync code (tar pipeline keeps the server data/ directory and .env).
tar --exclude='./data' --exclude='.env' --exclude='node_modules' \
  --exclude='web/dist' --exclude='web/.astro' -cf - "${DEPLOY_PATHS[@]}" \
  | ssh "$HOST" "mkdir -p $REMOTE_DIR/data && tar -xf - -C $REMOTE_DIR" || fail "file sync failed"
if [[ -f "$OVERRIDE" ]]; then
  ssh "$HOST" "cat > $REMOTE_DIR/docker-compose.override.yml" <"$OVERRIDE" || fail "override sync failed"
fi
ssh "$HOST" "test -f $REMOTE_DIR/.env" || fail "server .env is missing ($REMOTE_DIR/.env), see openwiki/deploy.md"
log "sync: ok"

# 3b. Pre-deploy backup of the live DB (consistent copy through VACUUM INTO). Keep the newest 10.
#     A new image may run a migration on start, so a failed backup stops the deploy.
backup=$(ssh "$HOST" bash -s <<REMOTE 2>&1
set -e
if ! docker inspect $CONTAINER >/dev/null 2>&1; then echo "skip: no container"; exit 0; fi
ts=\$(date -u +%Y%m%dT%H%M%SZ)
docker exec $CONTAINER node -e "
  const { DatabaseSync } = require('node:sqlite');
  require('node:fs').mkdirSync('data/backups', { recursive: true });
  const db = new DatabaseSync('data/agile.db');
  db.exec(\"VACUUM INTO 'data/backups/pre-deploy-\$ts.db'\");
  const fs = require('node:fs');
  const old = fs.readdirSync('data/backups').filter((f) => /^pre-deploy-.*\\.db\$/.test(f)).sort().slice(0, -10);
  for (const f of old) fs.rmSync('data/backups/' + f);
  console.log('ok pre-deploy-\$ts.db');
"
REMOTE
) || { printf '%s\n' "$backup" >&2; fail "pre-deploy backup failed, nothing deployed"; }
log "backup: $(tail -1 <<<"$backup")"

# 4. Rebuild and restart (output only on failure).
out=$(mktemp)
if ! ssh "$HOST" "cd $REMOTE_DIR && docker compose up -d --build" >"$out" 2>&1; then
  tail -20 "$out" >&2; rm -f "$out"; fail "docker compose failed"
fi
rm -f "$out"
log "build: ok"

# 5. Verify: container runs, no crash in fresh logs, site answers.
sleep 8
state=$(ssh "$HOST" "docker inspect -f '{{.State.Status}} restarts={{.RestartCount}}' $CONTAINER" 2>/dev/null || echo "missing")
logs=$(ssh "$HOST" "docker logs --since 30s $CONTAINER 2>&1 | tail -40")
code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$SITE_URL" || echo "000")
log "container: $state | site: $code"
if [[ "$state" != running* ]] || grep -qE 'Uncaught|SyntaxError|TypeError|unhandled error' <<<"$logs"; then
  printf '%s\n' "$logs" | tail -25 >&2
  fail "container is not healthy"
fi
[[ "$code" == 200 ]] || fail "site returned HTTP $code"
log "last log: $(tail -1 <<<"$logs" | cut -c1-160)"
log "done"
