# Notifications and jobs

Code: `server/src/jobs/`, `web/public/sw.js`.

## Web Push

- VAPID keys come from env (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). When they are empty, the server creates `data/vapid.json` on the first start and uses it (`loadVapidKeys`, `server/src/jobs/push.ts`).
- The settings page asks for permission and posts the subscription to `POST /api/push/subscribe`.
- iOS: works only after "Ana ekrana ekle" (iOS 16.4+). Android: works in Chrome.
- A `404` or `410` from the push service deletes the subscription.

## Scheduler

A ticker runs every 60 s in the app time zone (`APP_TIMEZONE`) (`server/src/jobs/scheduler.ts`). A scheduled job fires only in the 30 minutes after its time, so a restart at noon does not send the morning summary. `sent_notifications` stops double sends (rows older than 14 days are deleted).

| Job | When | Condition |
|---|---|---|
| Planning reminder | Sunday 20:00 | `planning_reminder` on, no planning session open |
| Daily summary | Every day 08:30 | `daily_summary` on, user has planned parts or events today |
| Task / event reminder | `task_reminder_min` before the start of a planned part or event | user is assignee / attendee |
| Partner change | On assign (`hooks.onAssigned`) | `partner_changes` on, the other user assigned a task to you |
| Backup | Every day 03:00 | always |

## Backup

`VACUUM INTO 'data/backups/agile-YYYY-MM-DD.db'`. Keep the newest 30 files.
