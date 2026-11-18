# CLAUDE.md

**Read `AGENTS.md` first.** It holds the binding project rules. Docs live in `openwiki/` (start with `openwiki/index.md`).

## Commands

```bash
npm install && npm --prefix web install          # dependencies
DEV_LOGIN=1 node --watch server/src/index.ts     # API + static on :8080 (dev login enabled)
npm --prefix web run dev                         # Astro dev on :4321, proxies /api and /auth to :8080
npm test                                         # server unit tests (node --test)
npm --prefix web run build                       # astro check + build to web/dist
scripts/ship.sh -m "feat: ..." files...          # test, build, commit, deploy, verify
```

## Architecture (short)

- `server/`: Node 24 + Hono + `node:sqlite`, TypeScript run directly by Node (type stripping). Entry `server/src/index.ts`.
- `web/`: Astro static pages, each mounts the React `App` island with a page name. shadcn/ui in `web/src/components/ui`.
- `shared/types.ts`: DTOs for both sides.
- Realtime: SSE `/api/events`, in-memory hub. Planning wizard state is the `planning_step` of the planned sprint.
- Deploy: `docker compose up -d --build` (see `openwiki/deploy.md`). Maintainer server details: `deploy.local/DEPLOY.md` (not in git).
