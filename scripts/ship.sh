#!/usr/bin/env bash
# Commit + push (+ wait for the automatic deploy) in one command, with short output.
#
# Usage:
#   scripts/ship.sh -m "feat: message" [file ...]   # test, build, commit the files, push, wait for CI deploy, verify
#   scripts/ship.sh -m "fix: x" -b "body text" a.ts # add a commit body
#   scripts/ship.sh --no-deploy -m "docs: x" f.md   # commit only (no push)
#   scripts/ship.sh --deploy-only                   # push what is committed, wait for the deploy
#   scripts/ship.sh --direct ...                    # emergency: deploy over the maintainer SSH key instead of CI
#   scripts/ship.sh --no-test ...                   # skip tests and web build
#
# With no files, the script commits what is already staged.
# A push to main starts .github/workflows/ci.yml: tests, then scripts/deploy-server.sh on the server.
# Maintainer settings come from deploy.local/ship.env (not in git): HOST, REMOTE_DIR, CONTAINER, SITE_URL.
set -euo pipefail

cd "$(dirname "$0")/.."

HOST="" REMOTE_DIR="" CONTAINER="life_agile" SITE_URL=""
[[ -f deploy.local/ship.env ]] && source deploy.local/ship.env
TRAILER="Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"

msg="" body="" do_test=1 do_commit=1 do_deploy=1 direct=0
files=()
while (($#)); do
  case "$1" in
    -m) msg="$2"; shift 2 ;;
    -b) body="$2"; shift 2 ;;
    --no-test) do_test=0; shift ;;
    --no-deploy) do_deploy=0; shift ;;
    --deploy-only) do_commit=0; do_test=0; shift ;;
    --direct) direct=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
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
[[ -n "$SITE_URL" ]] || fail "SITE_URL missing: create deploy.local/ship.env"
[[ "$(git branch --show-current)" == main ]] || fail "not on main"

# 3. Push (gh provides the HTTPS credentials).
sha=$(git rev-parse HEAD)
git -c credential.helper= -c credential.helper='!gh auth git-credential' push -q origin main 2>&1 | grep -v '^$' >&2 || true
[[ "$(git rev-parse origin/main)" == "$sha" ]] || fail "push failed"
log "push: ok ${sha:0:7}"

# 4. Deploy: CI (default) or the emergency path over the maintainer SSH key.
if ((direct)); then
  [[ -n "$HOST" && -n "$REMOTE_DIR" ]] || fail "HOST/REMOTE_DIR missing in deploy.local/ship.env"
  ssh "$HOST" "$REMOTE_DIR/scripts/deploy-server.sh $sha" | tail -3 || fail "direct deploy failed"
else
  run=""
  for _ in $(seq 1 30); do
    run=$(gh run list -c "$sha" -w CI -L 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
    [[ -n "$run" ]] && break
    sleep 2
  done
  [[ -n "$run" ]] || fail "no CI run found for ${sha:0:7}"
  if ! gh run watch "$run" --exit-status >/dev/null 2>&1; then
    gh run view "$run" --log-failed 2>/dev/null | tail -25 >&2
    fail "CI run $run failed (tests or deploy); the server rolls back on a failed deploy"
  fi
  log "ci: ok (run $run)"
fi

# 5. Verify the site.
code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$SITE_URL" || echo "000")
[[ "$code" == 200 ]] || fail "site returned HTTP $code"
log "site: $code"
log "done"
