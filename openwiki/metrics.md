# Dashboard metrics

Code: `server/src/domain/metrics.ts`, `GET /api/metrics`, `web/src/components/app/dashboard/`.

All metrics use closed sprints plus the active sprint (marked "devam ediyor").

| Metric | Definition |
|---|---|
| Velocity | SP done per sprint: total and per person. Line for the target. |
| Target hit rate | Share of closed sprints where SP done ≥ target, per person and total. |
| Burndown | Active sprint: remaining SP at the end of each day vs ideal line. Remaining = planned SP − SP done until that day (`done_at`). |
| Carry-over rate | Per sprint: tasks with `carried_from_sprint_id` = previous sprint / tasks in the previous sprint. |
| Recurring compliance | Per rule, last 4 sprints: done / counted occurrences, missed count. Counted = past days plus today when marked. Current streak. |
| Category distribution | SP done per category, last 4 sprints and all time. |
| Estimate accuracy | Per SP value (0, 0.5, 1–5): median hours from `started_at` to `done_at`. Only tasks with both values. |
| Completion | Tasks done / tasks planned per sprint. |
| Unplanned work | Per sprint: tasks with `unplanned_at`, their SP, done SP and the share of done SP that was unplanned. |

The past sprint list shows goal, SP per person, target, and retro items.
