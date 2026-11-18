# AGENTS.md — Life Agile project rules

Self-hosted agile board for a couple or a small group (Turkish UI). Public repo: https://github.com/okaldev/life-agile (AGPL-3.0 + commercial license).

## 1. Language
- UI text (visible strings in `web/`) is **Turkish**. Keep UI strings in `web/src/lib/strings.ts` where practical.
- Code, identifiers, comments, logs, commit messages and docs are **English**.
- Writing style: ASD-STE100 (short sentences, active voice).

## 2. Docs (OpenWiki)
- `openwiki/` is the single knowledge source. Start with `openwiki/index.md`.
- Read the related page before a change. Update it in the same commit as an architecture or logic change.

## 3. Git and deploy
- Commit after each meaningful change. Commit only the files you changed.
- Use `scripts/ship.sh -m "feat: ..." file1 file2` (tests + web build + commit + deploy + verify). Run it directly; do not delegate it.
- `--no-deploy` commits only. The deploy target lives in `deploy.local/` (not in git; maintainer only).
- Never commit personal data: no real names, emails, hosts, IPs or domains. Use `deploy.local/` or `.env` for them.

## 4. Data safety
- Never delete or overwrite the server `data/` directory or `.env`.
- Every new setting needs a default that keeps existing installs working without a `.env` change.
- Database migrations are additive only (`server/src/db/migrations.ts`). Add a new migration; never edit an old one.

## 5. Code layout
- Pure logic goes to `server/src/domain/` with unit tests in `server/test/`.
- Server TypeScript must stay "erasable" (Node type stripping): no `enum`, no `namespace`, no parameter properties. Import local files with the `.ts` extension.
- Every mutation route broadcasts an SSE event (`server/src/realtime/hub.ts`) and writes an activity row when the change is user-visible.
- Time zone for all day logic: `APP_TIMEZONE` (default `Europe/Istanbul`), set at boot in `server/src/domain/time.ts`; the web app gets it from `/api/bootstrap`.
