# Realtime and presence

Code: `server/src/realtime/hub.ts`, `web/src/lib/sse.ts`.

## Transport

- `GET /api/events` opens an SSE stream. The server sends `event: ping` every 25 s (Cloudflare closes idle connections after 100 s).
- Headers: `Cache-Control: no-cache`, `X-Accel-Buffering: no`.
- The client reconnects with backoff. After a reconnect it loads `GET /api/bootstrap` again.
- Writes use normal HTTP calls. The server broadcasts the result to all streams, including the writer (the writer ignores events with its own `clientId`).

## Events

| Event | Data |
|---|---|
| `task.upsert` | full task DTO |
| `task.delete` | `{id}` |
| `sprint.changed` | sprint DTO (or `null`) and members |
| `planning.changed` | planned sprint with step |
| `retro.upsert` / `retro.delete` | retro item / `{id}` |
| `category.changed` | full category list |
| `recurring.changed` | full rule list |
| `availability.changed` | list for the affected user |
| `presence` | `{userId, page, taskId, hover, online, at}` |
| `activity` | activity row |
| `calendarEvent.upsert` / `calendarEvent.delete` | event / `{id}` |
| `eventRules.changed` | full event rule list |
| `users.changed` | full user list (profile photo change) |

Every event has `{by: userId, clientId}`.

## Presence

- The client sends `POST /api/presence {page, taskId}` on page load, on focus of a task, and every 60 s.
- The server keeps presence in memory. A user is online while at least one stream is open.
- The UI shows the partner avatar in the header with the page name, and a ring on the task card or row the partner focuses.
- Pointing (`web/src/lib/hover.tsx`): the client also sends `{hover: "task:12" | "event:3" | "rule:2" | "retro:7" | null}`. Mouse: on enter after 120 ms, cleared 500 ms after leave. Touch: a tap counts. The partner sees a ring and a name tag on the same item on any screen size (the key is the item, not a pixel position). A page change clears it. This is enough for "which task are we talking about" in grooming and estimation; no WebSocket is needed.

## Conflicts

- Last write wins per field. The server only updates the fields in the request body (PATCH).
