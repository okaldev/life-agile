# Calendar: parts, events, marks, progress

Code: `server/src/domain/blocks.ts`, `server/src/domain/events.ts`, `server/src/routes/calendar.ts`, `web/src/components/app/calendar/`.

## Task parts (blocks)

- A task can have zero or more calendar parts in `task_blocks` (date, optional start/end, status).
- Example: homework in two sessions = one task with two parts.
- `tasks.date/start_time/end_time` are a cache of the earliest part (`syncTaskSchedule`). Do not write them directly. Sorting and old code read them.
- The old task API shape (`date/startTime/endTime` on task create or PATCH) still works for a task with zero or one part. With more parts it answers 409; use the part routes.
- Recurring occurrences always have exactly one part.
- Schema v2 migration created one part for every task that had a date (status `done` for done tasks).

## Who

- Every calendar item shows its people with one soft person-color strip on the right edge (two colors for shared items). The category is the small dot before the title (no category border).
- Photo badges (uploaded photo, else Google photo, else initial) sit in the top-right corner when the item is at least 64 px wide (CSS container query). Narrow items show only the strip, so the title stays readable.
- Events show the same badges; there is no second attendee row.

## Long events

Timed events of 8 hours or more (for example "İstanbul'dayım 00:15–23:59") are drawn as a hatched background band over the whole day column, not as a column item. Tasks keep the full width. A small label (title, kind icon, photos) sticks just below the day header and opens the event; the rest of the band lets clicks and drags reach the grid.

## Marks: done / missed

A part has status `planned`, `done` or `missed`. An event has the same three values (shown as Gerçekleşti / Gerçekleşmedi).

- A task with exactly one part follows the part:
  - part `done` → task `done`
  - part `missed` → task `missed_at` is set, task is not done
  - part back to `planned` → task back to `todo`, `missed_at` cleared
- Board status change on a one-part task updates the part too (`followTaskStatus`).
- A split task: marking a part done moves the task from `todo` to `in_progress`. The task is done only when a user marks it done.
- Past parts and events still `planned` are "işaretlenmemiş". The calendar highlights them and lists them for quick marking. Nothing is marked automatically during the sprint.
- Sprint close: recurring occurrences of the closed sprint that are not done get `missed_at`, and their planned parts become `missed`.

## Opening a part

Clicking a task part opens the task view directly (`openTask(taskId, { blockId })`). While that part is still planned, a top line "Bu parça" asks Yapıldı / Yapılmadı (rules above). After marking, the line goes away. The Takvim badge shows the result: one part = green (done) or red (missed) badge; several parts = one dot per part (green, red, gray). Undo is in the parts list of the Takvim badge: each part row has a fixed-width ✓ / ✕ toggle; a click on the active one sets the part back to planned. Progress (slider, %25/50/75, back to auto) and "Görevi tamamla" are in the task view's İlerleme property (shared `ProgressControl`, `web/src/components/app/TaskParts.tsx`).

## Progress

`computeProgress` (0–100), first rule that applies:

1. Task done → 100.
2. `progress_manual` set (user override in the task dialog) → that value.
3. Task has parts → done part minutes / all part minutes. A part without time or end counts as 60 minutes. Missed parts stay in the total.
4. Checklist → done items / all items.
5. Else 0.

## Events

- `calendar_events`: general events outside sprints (kind: `meet` buluşma, `guest` misafir, `out` dışarıda, `busy` meşgul, `other` diğer). Attendees: one or both users. Optional time.
- Events do not count in SP or metrics. The estimation step shows busy hours per person and the target suggestion uses them.
- Repeating events: `event_rules` (daily / weekdays / weekly mask, optional time, `start_date`). `GET /api/calendar-events?from&to` creates the missing occurrences in the range (only dates ≥ `start_date`; the unique index `(rule_id, occurrence_date)` stops duplicates).
- Editing one occurrence changes only that occurrence. Editing the rule updates future `planned` occurrences. Deleting the rule soft-deletes it and removes future planned occurrences; past ones stay.
- Busy hours of a user in a range = minutes of timed events the user attends (all-day event = 8 h), status not `missed`.

## Convert a task to recurring

`POST /api/tasks/:id/to-recurring` creates a rule from the task (title, description, category, assignees, SP as default SP) and the given schedule. If the task date matches the rule, the task becomes that day's occurrence. Then occurrences are generated for the active sprint (from today) and the groomed planned sprint. Otherwise the task stays a normal task.
