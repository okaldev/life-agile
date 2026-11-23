# Recurring tasks

Code: `server/src/domain/recurrence.ts`, `server/src/routes/recurring.ts`.

## Rule

- `freq=daily`: every day of the week.
- `freq=weekdays`: Monday to Friday.
- `freq=weekly`: days in `weekdays_mask` (bit 0 = Monday … bit 6 = Sunday).
- Optional `start_time` and `end_time`. Without time the task shows in the calendar "all day" row.
- Assignees: one or both users. Category. `default_sp`.
- "Haftada N kez" (`times_per_week`, v8, 1–7): no fixed days and no time (`freq=weekly`, mask 0). Each sprint gets N undated occurrences with `occurrence_date = "<week start>#<n>"` (unique per rule; sorts inside its week). The user drags them from the calendar side list onto a day. Unfinished ones are marked missed when the sprint closes, like other occurrences. Cards show "n/N".

## Occurrence generation

`occurrenceDates(rule, weekStart)` returns the dates of the rule in the week (Monday..Sunday).

`generateOccurrences(sprintId)` runs:
- when grooming starts for a planned sprint,
- when a rule is created or changed while a sprint is active or planned (only for dates today or later; existing occurrences stay).

For a "N times a week" rule it inserts N undated tasks (no part) while the sprint week is not over. For each date of a fixed rule it inserts a task with `recurring_rule_id` and `occurrence_date` and one calendar part (rule time), unless one already exists (unique index). SP = latest SP used by this rule in an earlier sprint, else `default_sp`.

Deactivating a rule deletes its future `todo` occurrences in the active and planned sprint. Done occurrences stay.

## Compliance

Marking: an occurrence is done or missed through its part (calendar or task dialog). See [calendar.md](calendar.md).

Compliance of a rule = done occurrences / counted occurrences. Counted = past days (marked or not) plus today when it is already marked. Streak = number of consecutive done occurrences, newest first, today excluded when not done yet. See [metrics.md](metrics.md).
