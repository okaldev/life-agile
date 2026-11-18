# Data model

SQLite file: `data/agile.db`. Migrations run at start (`server/src/db/migrations.ts`). Migrations are additive only. Never drop or rewrite user data.

Dates are `YYYY-MM-DD` strings in the app time zone (`APP_TIMEZONE`, default Europe/Istanbul). Times are `HH:MM`. Timestamps are ISO-8601 UTC strings.

## Tables

### users
`id`, `email` (unique), `name`, `avatar_url`, `color`, `password_hash` (v6, scrypt string or NULL), `is_admin` (v6). Rows come from `ALLOWED_EMAILS` at start, the first-run setup, or an accepted invite. At start, if no user is admin, the oldest user becomes admin.

### invites (v6)
`id`, `token_hash` (SHA-256 of the link token, unique), `email`, `name`, `created_by`, `expires_at`, `used_at`, `created_at`.

### sessions
`id` (random token), `user_id`, `expires_at`.

### categories
`id`, `name`, `color`, `archived`. Seed: Ev, İş, Sağlık, Finans, Sosyal, Kişisel.

### sprints
`id`, `number`, `start_date` (Monday), `end_date` (Sunday), `status` (`planned` | `active` | `closed`), `goal`, `planning_step` (`retro` | `grooming` | `estimation` | `start` | NULL), `closed_at`, `created_at`.
- Max one `active` and max one `planned` sprint.

### sprint_members
`sprint_id`, `user_id`, `target_sp`, `done_sp_snapshot` (set on close). Primary key (`sprint_id`, `user_id`).

### availability
`id`, `user_id`, `date`, `kind` (`off` | `half`), `note`. Unique (`user_id`, `date`).

### tasks
`id`, `title`, `description`, `category_id`, `sprint_id` (NULL = backlog), `status` (`todo` | `in_progress` | `done`), `sp` (1–5 or NULL), `priority` (0 none, 1 low, 2 high, 3 urgent), `due_date`, `date`, `start_time`, `end_time`, `backlog_rank` (REAL, lower = higher in list), `recurring_rule_id`, `occurrence_date`, `carried_from_sprint_id`, `started_at`, `done_at`, `created_by`, `created_at`, `updated_at`.
- `start_time` needs `date`. `end_time` needs `start_time`.
- `started_at` is set when status first becomes `in_progress`. `done_at` is set when status becomes `done`, cleared when it leaves `done`.
- Unique (`recurring_rule_id`, `occurrence_date`) for generated tasks.

### task_blocks (v2)
`id`, `task_id` (cascade delete), `date`, `start_time`, `end_time`, `status` (`planned` | `done` | `missed`), `created_at`, `updated_at`. Calendar parts of a task. See [calendar.md](calendar.md).

v2 also adds `tasks.progress_manual` (0–100 or NULL) and `tasks.missed_at`. Since v2, `tasks.date/start_time/end_time` are a cache of the earliest part.

### tasks: story points and unplanned flag (v3)
- `tasks.points` (REAL): story points, one of 0, 0.5, 1, 2, 3, 4, 5 or NULL (not estimated). The v3 migration copied `sp` into it.
- `tasks.sp` is legacy since v3 (its CHECK only allows 1–5). Do not read or write it; it is kept so old rows stay untouched.
- `tasks.unplanned_at`: set when a task enters the **active** sprint (created there, moved there, or a recurring occurrence generated there by a rule added mid-sprint). Cleared when the task leaves the sprint or is carried into a new sprint in grooming. Users can toggle it in the task dialog.
- `recurring_rules.default_sp` has no CHECK and also stores 0.5.

### user_avatars (v4)
`user_id` (PK), `mime` (`image/webp` | `image/jpeg` | `image/png`), `data` (BLOB, max 200 KB, 256×256 from the client crop), `updated_at`. A custom photo wins over `users.avatar_url` (the Google photo, updated at every login). Stored in the DB so the backups include it.

### calendar_events, calendar_event_attendees (v2)
`id`, `title`, `note`, `kind` (`meet` | `guest` | `out` | `busy` | `other`), `date`, `start_time`, `end_time`, `status` (`planned` | `done` | `missed`), `rule_id`, `occurrence_date`, `created_by`, timestamps. Unique (`rule_id`, `occurrence_date`).

### event_rules, event_rule_attendees (v2)
`id`, `title`, `note`, `kind`, `freq`, `weekdays_mask`, `start_time`, `end_time`, `start_date`, `active`, `deleted_at`, `created_by`, `created_at`.

### task_history (v5)
`id`, `task_id` (cascade delete), `user_id`, `field`, `old_value`, `new_value` (JSON), `created_at`. One row per change: task fields (title, status, sp, priority, categoryId, sprintId, dueDate, assigneeIds, progressManual, unplannedAt, missedAt; description only as "changed"), `created`, `part.add/remove/move/status`, `checklist.add/done`, `comment`. Code: `server/src/domain/history.ts`.

### task_assignees
`task_id`, `user_id`. One or two rows per task.

### checklist_items
`id`, `task_id`, `text`, `done`, `rank`.

### comments
`id`, `task_id`, `user_id`, `body`, `created_at`.

### recurring_rules
`id`, `title`, `description`, `category_id`, `freq` (`daily` | `weekdays` | `weekly`), `weekdays_mask` (bit 0 = Monday … bit 6 = Sunday, used by `weekly`), `start_time`, `end_time`, `default_sp`, `active`, `created_by`, `created_at`.

### recurring_rule_assignees
`rule_id`, `user_id`.

### retro_items
`id`, `sprint_id` (the sprint being reviewed), `user_id`, `kind` (`good` | `bad` | `try`), `text`, `created_at`.

### activity
`id`, `user_id`, `action`, `entity`, `entity_id`, `summary`, `created_at`. Keep the last 1000 rows.

### push_subscriptions
`id`, `user_id`, `endpoint` (unique), `p256dh`, `auth`, `created_at`.

### notification_prefs
`user_id`, `planning_reminder`, `daily_summary`, `task_reminder_min` (0 = off), `partner_changes`.

### sent_notifications
`key` (unique, e.g. `task-reminder:42:2026-11-16`), `sent_at`. Stops double sends.

## SP rules

- Person SP done in a sprint = sum of `sp` of `done` tasks in that sprint where the person is an assignee.
- Total SP done = sum of `sp` of `done` tasks (a shared task counts once in the total, once per person in person numbers).
