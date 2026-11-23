# Sprint flow

Code: `server/src/domain/sprint.ts`, `server/src/routes/planning.ts`, `web/src/components/app/planning/`.

## Lifecycle

```
(no sprint) --start first planning--> planned --start--> active --start planning--> (active + planned) --start--> closed + active
                                                                        \--schedule--> (active + scheduled) --00:00 of start date--> closed + active
```

- First use: there is no sprint. The board shows "İlk sprinti planla". The wizard runs without the retro step.
- Week of the new sprint: the week after the active sprint. If that week is already over, the current week. Without an active sprint the current week is used; only on Sunday the next week (Sunday evening is planning time).
- Only one planning session exists at a time. It is the `planned` sprint with `planning_step` not NULL.
- A user can cancel planning. The `planned` sprint is deleted. Task moves done in grooming go back (tasks return to their origin).

## Wizard steps

Both users see the same step. `planning_step` is stored on the planned sprint and broadcast by SSE. Any user can move to the next or previous step.

### 1. Retro (`retro`)
- Shows the active sprint result: SP done vs target per person, carry-over count.
- Three columns: İyi giden (`good`), Kötü giden (`bad`), Deneyeceğiz (`try`). Both users add and delete items live.
- Skipped for the first sprint.

### 2. Grooming (`grooming`)
- When the step opens the first time, the server:
  1. Moves unfinished tasks (`todo`, `in_progress`) of the active sprint to the planned sprint. It sets `carried_from_sprint_id` and keeps the status. Recurring occurrences of the old week stay in the old sprint. Open occurrences already dated in the new week (`occurrence_date >= new start`) move to the new sprint; they get `carried_from_sprint_id` so cancel can move them back, but they do not count as carry-over.
  2. Generates recurring occurrences for the new week (see [recurring.md](recurring.md)).
- Left side: backlog (smart sort). Right side: new sprint (carried tasks marked "Devreden", recurring tasks marked "Tekrarlayan").
- A user moves a task between backlog and sprint, edits it, or creates a new one.
- "Onayla ve puanla" goes to estimation.

### 3. Estimation (`estimation`)
- Non-recurring sprint tasks: SP buttons 1–5. Each user can see which task the other user focuses on.
- Recurring tasks: one row per rule. Default SP = SP of the latest occurrence of the rule before this sprint, else `default_sp`. A change updates all occurrences of the rule in this sprint and the rule `default_sp`.
- Capacity panel: per person leave days in the sprint week and SP target. Suggestion = last target (or average done SP of the last 3 sprints) × available days / 7, rounded.
- Live bar: planned SP vs target per person.
- Sprint goal input.
- Unestimated tasks are allowed but shown as a warning.

### 4. Start (`start`)
- Summary: task count, SP per person, targets, goal.
- When the sprint week has not begun yet (`startDate > today`), two options: **Zamanında başlat** (schedule) and **Şimdi başlat** (start now). Otherwise only "Sprinti başlat".
- "Şimdi başlat" / "Sprinti başlat":
  1. Active sprint: snapshot `done_sp_snapshot` per member, `status=closed`, `closed_at=now`. Recurring occurrences that are not done get `missed_at` and their planned parts become `missed`.
  2. Planned sprint: `status=active`, `planning_step=NULL`.
  3. Broadcast `sprint.changed`. Both clients go to the board.

### Scheduled start (planning early)

- "Zamanında başlat" (`POST /api/planning/schedule`): the planned sprint gets `scheduled_at`, `planning_step=NULL`; the wizard closes. Refused when the week has begun.
- Until the start, the active sprint keeps running. Tasks carried in grooming are already in the planned sprint, but the board and the calendar side panel still show them as work of the running week (`isActiveWork`, `web/src/lib/store.tsx`).
- The scheduler (`server/src/jobs/scheduler.ts`, every minute) runs `finishPlanning` when `today >= startDate` (00:00 local time), broadcasts `sprint.changed` and `planning.changed`, writes an activity row without a user, and sends a "Sprint N başladı" push once per user.
- At this start, `finishPlanning` also: moves carried tasks that became `done` before the start back to the old sprint (they count there), and carries open non-recurring tasks added to the old sprint after grooming (no backlog return).
- Planlama page shows the scheduled plan: **Şimdi başlat**, **Planı düzenle** (`POST /api/planning/start` opens the wizard at the start step and clears `scheduled_at`), **Planı iptal et** (same as cancel). A banner on other pages shows the start time.

## Mid-sprint

- Users can add tasks to the active sprint, move tasks to the backlog, and change targets.
- A task moved to the backlog keeps its SP.
