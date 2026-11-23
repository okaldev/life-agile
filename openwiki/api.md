# HTTP API

All `/api/*` routes need a session cookie, except `/api/health`. Write calls (`POST`, `PATCH`, `PUT`, `DELETE`) must send an `Origin` equal to `PUBLIC_URL` and may send `X-Client-Id` (used to skip own SSE echoes). Bodies are JSON. Errors: `{error: string}` with 4xx/5xx.

## Auth

| Method | Path | Notes |
|---|---|---|
| GET | `/auth/options` | `{google, password, setupNeeded, dev}` |
| POST | `/auth/setup` | `{name, email, password}`. Only while there are no users. Creates the admin and a session |
| POST | `/auth/login` | `{email, password}`. 401 on wrong data, 429 after 5 failures in 15 min |
| GET | `/auth/invite/:token` | Open invite `{email, name}` or 404 |
| POST | `/auth/invite/:token` | `{name, password}`. Creates the user, marks the invite used, starts a session |
| GET | `/auth/google` | Redirect to Google (only when `GOOGLE_CLIENT_ID` is set) |
| GET | `/auth/google/callback` | Checks state; the email must belong to an existing user. Sets session, redirects to `/` |
| GET | `/auth/dev?email=` | Only with `DEV_LOGIN=1` and not production |
| POST | `/auth/logout` | Deletes session |
| GET | `/api/me` | Current user or 401 |
| PUT | `/api/me/avatar` | `{dataUrl}` webp/jpeg/png data URL, max 200 KB. Broadcasts `users.changed` |
| DELETE | `/api/me/avatar` | Back to the Google photo |
| GET | `/api/me/password` | `{hasPassword}` |
| PUT | `/api/me/password` | `{current?, password}`. `current` is needed when a password exists |
| GET | `/api/admin/invites` | Open invites (admin) |
| POST | `/api/admin/invites` | `{name, email}` → `{invite, url}` (admin). The URL holds the token; it is shown once |
| DELETE | `/api/admin/invites/:id` | Revoke an open invite (admin) |
| GET | `/api/avatars/:userId` | Photo bytes (session required, long cache; the URL carries `?v=updated_at`) |

## Core

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{ok: true}` |
| GET | `/api/bootstrap` | me (with `isAdmin`), users, categories, active + planned sprint with members, their tasks and the backlog, recurring rules, presence, VAPID public key, `timeZone`, `sourceUrl`, `holidays` |
| GET | `/api/events` | SSE stream ([realtime.md](realtime.md)) |
| POST | `/api/presence` | `{page, taskId}` |
| GET | `/api/activity?limit=` | Recent activity |

## Tasks

| Method | Path | Notes |
|---|---|---|
| GET | `/api/tasks?sprintId=` / `?backlog=1` | Task list |
| GET | `/api/tasks/:id` | Task with checklist and comments |
| GET | `/api/tasks/:id/history` | Change history, newest first |
| POST | `/api/tasks` | Create. `assigneeIds` required |
| PATCH | `/api/tasks/:id` | Partial update (any field, `assigneeIds`, `progressManual`, `unplanned: boolean`, `cancelled: boolean`). `sp` must be 0, 0.5, 1, 2, 3, 4, 5 or null. `date/startTime/endTime` edit the single part; 409 if the task has several parts |
| DELETE | `/api/tasks/:id` | Delete |
| POST | `/api/backlog/reorder` | `{ids: number[]}` sets `backlog_rank` in this order |
| POST | `/api/tasks/:id/blocks` | `{date, endDate?, startTime?, endTime?}` adds a calendar part (`endDate`: multi-day, no times) |
| PATCH | `/api/blocks/:id` | `{date?, endDate?, startTime?, endTime?, status?}` (`planned`/`done`/`missed`). Moving keeps a multi-day length |
| DELETE | `/api/blocks/:id` | Removes a part |
| POST | `/api/tasks/:id/checklist` | `{text}` |
| PATCH/DELETE | `/api/checklist/:id` | `{text?, done?}` |
| POST | `/api/tasks/:id/comments` | `{body}` |
| DELETE | `/api/comments/:id` | Own comments only |

## Categories, recurring, availability

| Method | Path |
|---|---|
| GET/POST | `/api/categories` |
| PATCH | `/api/categories/:id` |
| GET/POST | `/api/recurring` |
| PATCH/DELETE | `/api/recurring/:id` |
| GET | `/api/availability?from=&to=` |
| PUT | `/api/availability` `{date, kind: 'off'|'half'|null, note?, userId?}` (default: own user) |

## Sprints and planning

| Method | Path | Notes |
|---|---|---|
| GET | `/api/sprints` | All sprints with members and SP stats |
| GET | `/api/sprints/:id/tasks` | Tasks of any sprint (also closed) |
| PATCH | `/api/sprints/:id` | `{goal}` |
| PUT | `/api/sprints/:id/members/:userId` | `{targetSp}` |
| POST | `/api/planning/start` | Creates the planned sprint, step `retro` (or `grooming` for the first sprint). On a scheduled plan: opens it again at step `start` |
| POST | `/api/planning/step` | `{step}`; entering `grooming` the first time carries tasks and generates occurrences |
| POST | `/api/planning/recurring-sp` | `{ruleId, sp}` |
| POST | `/api/planning/schedule` | Closes the wizard; the planned sprint starts by itself at 00:00 of its start date. 409 when the week has begun |
| POST | `/api/planning/cancel` | Deletes the planned sprint, restores tasks |
| POST | `/api/planning/finish` | Closes the active sprint, activates the planned one |
| GET | `/api/retro/:sprintId` | Items |
| POST | `/api/retro/:sprintId` | `{kind, text}` |
| PATCH | `/api/retro/items/:id` | `{taskId}`: links an action to the task made from it |
| DELETE | `/api/retro/items/:id` | |

## Calendar

| Method | Path | Notes |
|---|---|---|
| GET | `/api/calendar-events?from=&to=` | Events in range (max 62 days). Creates missing occurrences of event rules first |
| POST | `/api/calendar-events` | `{title, kind, date, endDate?, startTime?, endTime?, note?, attendeeIds, repeat?: {freq, weekdaysMask}}` (`endDate` only for one-off events; max 32 days). With `repeat` it creates a rule; returns the created events |
| PATCH | `/api/calendar-events/:id` | Any field, `status` (`planned`/`done`/`missed`) |
| DELETE | `/api/calendar-events/:id` | One-off: deletes. Occurrence of a series: marks it `missed` (so the rule does not create it again) |
| GET | `/api/event-rules` | Active series |
| PATCH/DELETE | `/api/event-rules/:id` | Edit or soft-delete a series; future planned occurrences follow |
| GET | `/api/calendar?from=&to=` | Tasks that have parts in the range (also closed sprints) |
| GET | `/api/busy?from=&to=` | `[{userId, hours}]` event hours per user |
| POST | `/api/tasks/:id/to-recurring` | `{freq, weekdaysMask?, startTime?, endTime?, assigneeIds?, defaultSp?}` → `{rule, linked}` |

## Metrics and push

| Method | Path |
|---|---|
| GET | `/api/metrics` |
| POST | `/api/push/subscribe` |
| POST | `/api/push/unsubscribe` |
| POST | `/api/push/test` |
| GET/PUT | `/api/notification-prefs` |
