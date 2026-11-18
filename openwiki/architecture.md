# Architecture

## Stack

| Layer | Choice | Reason |
|---|---|---|
| UI | Astro (static build) + React islands + Tailwind v4 + shadcn/ui | No server runtime for pages. |
| Drag and drop | `@dnd-kit` | Touch support for phones. |
| Charts | `recharts` | Simple React charts. |
| API | Node 24 + Hono, TypeScript with Node type stripping | One language with the UI. No build step for the server. |
| Database | SQLite through built-in `node:sqlite`, WAL mode | No native module, one file, enough for 2 users. |
| Realtime | Server-Sent Events | One-way stream is enough. Writes use normal HTTP calls. |
| Push | Web Push (VAPID), `web-push` package, service worker | Phone notifications without an app store. |

## Components

```
Browser (PWA)
  Astro pages -> React island <App page="..."> -> api client + SSE client
        |  HTTPS (Cloudflare -> Traefik)
Node process (container life_agile, port 8080)
  Hono app
    /auth/*        password login, setup, invites, Google OAuth, dev login, logout
    /api/*         JSON API (session required)
    /api/events    SSE stream (session required)
    static         web/dist (session required, except /giris and assets)
  realtime hub     in-memory map of SSE clients, presence
  jobs             1-minute ticker: reminders, daily backup
  db               node:sqlite, migrations at start
data/agile.db      persistent volume
```

## Directory layout

- `server/src/index.ts`: app start (migrations, routes, static, jobs).
- `server/src/db/`: connection, migrations, query helpers.
- `server/src/auth/`: sessions, middleware, Google OAuth, password login, setup and invites (`auth.ts`); scrypt hashing, invite tokens, rate limiter (`password.ts`).
- `server/src/routes/`: one file per resource.
- `server/src/domain/`: pure logic (week math, recurrence, sprint close, metrics). Unit tested.
- `server/src/realtime/`: SSE hub and presence.
- `server/src/jobs/`: scheduler, push sender, backup.
- `shared/types.ts`: DTO types used by server and web.
- `web/src/pages/`: one Astro page per route. Each page mounts the React app with a page name.
- `web/src/components/ui/`: shadcn components. `web/src/components/app/`: app components.
- `web/src/lib/`: API client, store, SSE client, date helpers, Turkish strings.

## Routes (UI)

| Path | Page |
|---|---|
| `/` | Calendar (start page) |
| `/takvim` | Calendar (old link, same page) |
| `/board` | Board |
| `/backlog` | Backlog |
| `/tekrarlayan` | Recurring rules |
| `/planlama` | Planning wizard |
| `/dashboard` | Metrics |
| `/ayarlar` | Settings |
| `/giris` | Login |

## State on the client

- One small store (`web/src/lib/store.tsx`, React context + reducer) holds users, categories, the open sprints, their tasks and the backlog, rules, presence and activity.
- The store loads with `GET /api/bootstrap`. SSE events patch the store. `sprint.changed` / `planning.changed` and a reconnect load the bootstrap again. Per-type event counters (`versions`) let pages refetch their own data (retro, availability, metrics).
- Task edits are optimistic (`patchTask`); a failed call restores the old task.

## Security

- Session cookie: `HttpOnly`, `Secure` when `PUBLIC_URL` is https, `SameSite=Lax`, random 32-byte id stored in `sessions`.
- Write requests (and `POST /auth/*`) in production check the `Origin` header against `PUBLIC_URL`. Without `PUBLIC_URL`, the Origin host must equal the `Host` header.
- Passwords: scrypt (N=16384, r=8, p=1, 16-byte salt), constant-time compare, 8–200 characters. Login failures are limited to 5 per 15 minutes per email + client IP (in memory).
- Invite tokens: 32 random bytes; only the SHA-256 hash is stored; 7 days; single use.
- OAuth `state` is checked with a short-lived cookie.
- `DEV_LOGIN=1` is refused when `NODE_ENV=production`.
