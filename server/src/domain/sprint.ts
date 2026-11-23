// Sprint lifecycle and the planning wizard. See openwiki/sprint-flow.md.
import type { PlanningStep, Sprint, SprintStats } from "../../../shared/types.ts";
import type { DB } from "../db/db.ts";
import { nowIso, tx } from "../db/db.ts";
import { getSprint, getSprintByStatus, listUsers } from "../db/repo.ts";
import { generateOccurrences } from "./recurrence.ts";
import { addDays, nextSprintStart, today } from "./time.ts";

export const STEPS: PlanningStep[] = ["retro", "grooming", "estimation", "start"];

export class PlanningError extends Error {}

/** Starts a planning session, or returns the open one. A scheduled plan opens again for editing (start step). */
export function startPlanning(db: DB, todayDate = today()): Sprint {
  const open = getSprintByStatus(db, "planned");
  if (open && !open.planningStep) {
    db.prepare("UPDATE sprints SET planning_step = 'start', scheduled_at = NULL WHERE id = ?").run(open.id);
    return getSprint(db, open.id)!;
  }
  if (open) return open;
  const active = getSprintByStatus(db, "active");
  return tx(db, () => {
    const start = nextSprintStart(active?.endDate ?? null, todayDate);
    const max = db.prepare("SELECT coalesce(max(number), 0) AS n FROM sprints").get() as { n: number };
    const res = db
      .prepare(
        `INSERT INTO sprints (number, start_date, end_date, status, planning_step)
         VALUES (?, ?, ?, 'planned', ?)`,
      )
      .run(max.n + 1, start, addDays(start, 6), active ? "retro" : "grooming");
    const id = Number(res.lastInsertRowid);
    for (const u of listUsers(db)) {
      const prev = active?.members.find((m) => m.userId === u.id)?.targetSp ?? 0;
      db.prepare("INSERT INTO sprint_members (sprint_id, user_id, target_sp) VALUES (?, ?, ?)").run(id, u.id, prev);
    }
    if (!active) enterGrooming(db, id);
    return getSprint(db, id)!;
  });
}

/**
 * First entry into grooming: carry unfinished non-recurring tasks of the active sprint
 * and generate recurring occurrences for the new week.
 */
export function enterGrooming(db: DB, plannedId: number): void {
  const planned = getSprint(db, plannedId);
  if (!planned || planned.groomedAt) return;
  const active = getSprintByStatus(db, "active");
  tx(db, () => {
    if (active) {
      db.prepare(
        `UPDATE tasks SET sprint_id = ?, carried_from_sprint_id = ?, unplanned_at = NULL, updated_at = ?
         WHERE sprint_id = ? AND status != 'done' AND recurring_rule_id IS NULL`,
      ).run(plannedId, active.id, nowIso(), active.id);
      // Open recurring occurrences dated in the new week belong to the new sprint.
      // carried_from_sprint_id lets cancelPlanning move them back; they do not count as carry-over.
      db.prepare(
        `UPDATE tasks SET sprint_id = ?, carried_from_sprint_id = ?, unplanned_at = NULL, updated_at = ?
         WHERE sprint_id = ? AND status != 'done' AND recurring_rule_id IS NOT NULL AND occurrence_date >= ?`,
      ).run(plannedId, active.id, nowIso(), active.id, planned.startDate);
    }
    generateOccurrences(db, plannedId);
    db.prepare("UPDATE sprints SET groomed_at = ? WHERE id = ?").run(nowIso(), plannedId);
  });
}

export function setStep(db: DB, step: PlanningStep): Sprint {
  const planned = getSprintByStatus(db, "planned");
  if (!planned) throw new PlanningError("no planning session");
  if (!STEPS.includes(step)) throw new PlanningError("bad step");
  tx(db, () => {
    if (step !== "retro") enterGrooming(db, planned.id);
    db.prepare("UPDATE sprints SET planning_step = ? WHERE id = ?").run(step, planned.id);
  });
  return getSprint(db, planned.id)!;
}

/** Cancels planning and puts tasks back where they came from. */
export function cancelPlanning(db: DB): void {
  const planned = getSprintByStatus(db, "planned");
  if (!planned) return;
  const active = getSprintByStatus(db, "active");
  tx(db, () => {
    if (active) {
      db.prepare(
        `UPDATE tasks SET sprint_id = ?, carried_from_sprint_id = NULL, updated_at = ?
         WHERE sprint_id = ? AND carried_from_sprint_id = ?`,
      ).run(active.id, nowIso(), planned.id, active.id);
    }
    db.prepare("DELETE FROM tasks WHERE sprint_id = ? AND recurring_rule_id IS NOT NULL AND status = 'todo'").run(
      planned.id,
    );
    db.prepare(
      `UPDATE tasks SET sprint_id = NULL,
         backlog_rank = (SELECT coalesce(max(backlog_rank), 0) + 1 FROM tasks WHERE sprint_id IS NULL), updated_at = ?
       WHERE sprint_id = ?`,
    ).run(nowIso(), planned.id);
    db.prepare("DELETE FROM retro_items WHERE sprint_id = ?").run(planned.id);
    db.prepare("DELETE FROM sprints WHERE id = ?").run(planned.id);
  });
}

export function doneSpByUser(db: DB, sprintId: number): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT a.user_id, sum(t.points) AS sp FROM tasks t JOIN task_assignees a ON a.task_id = t.id
       WHERE t.sprint_id = ? AND t.status = 'done' GROUP BY a.user_id`,
    )
    .all(sprintId) as { user_id: number; sp: number | null }[];
  return new Map(rows.map((r) => [r.user_id, r.sp ?? 0]));
}

/**
 * Ends the wizard without starting: the planned sprint starts by itself at 00:00 of its start date
 * (scheduler, openwiki/sprint-flow.md). Until then the active sprint keeps running.
 */
export function schedulePlanning(db: DB, todayDate = today()): Sprint {
  const planned = getSprintByStatus(db, "planned");
  if (!planned) throw new PlanningError("no planning session");
  if (planned.startDate <= todayDate) throw new PlanningError("the sprint week has started: start it now");
  tx(db, () => {
    enterGrooming(db, planned.id);
    db.prepare("UPDATE sprints SET planning_step = NULL, scheduled_at = ? WHERE id = ?").run(nowIso(), planned.id);
  });
  return getSprint(db, planned.id)!;
}

/** The scheduled sprint whose start date has come, or null. */
export function dueScheduledSprint(db: DB, todayDate = today()): Sprint | null {
  const planned = getSprintByStatus(db, "planned");
  return planned && planned.scheduledAt && !planned.planningStep && planned.startDate <= todayDate ? planned : null;
}

/** Closes the active sprint and activates the planned one. */
export function finishPlanning(db: DB): Sprint {
  const planned = getSprintByStatus(db, "planned");
  if (!planned) throw new PlanningError("no planning session");
  const active = getSprintByStatus(db, "active");
  tx(db, () => {
    enterGrooming(db, planned.id);
    if (active) {
      // Carried tasks finished before the start belong to the old sprint (planned early, done in the old week).
      db.prepare(
        `UPDATE tasks SET sprint_id = ?, carried_from_sprint_id = NULL, updated_at = ?
         WHERE sprint_id = ? AND carried_from_sprint_id = ? AND status = 'done' AND recurring_rule_id IS NULL`,
      ).run(active.id, nowIso(), planned.id, active.id);
      // A scheduled plan: open tasks added to the old sprint after grooming carry over too.
      if (planned.scheduledAt)
        db.prepare(
          `UPDATE tasks SET sprint_id = ?, carried_from_sprint_id = ?, unplanned_at = NULL, updated_at = ?
           WHERE sprint_id = ? AND status != 'done' AND recurring_rule_id IS NULL`,
        ).run(planned.id, active.id, nowIso(), active.id);
      const done = doneSpByUser(db, active.id);
      for (const m of active.members)
        db.prepare("UPDATE sprint_members SET done_sp_snapshot = ? WHERE sprint_id = ? AND user_id = ?").run(
          done.get(m.userId) ?? 0,
          active.id,
          m.userId,
        );
      // Recurring occurrences that were not done count as missed (openwiki/calendar.md).
      const now = nowIso();
      db.prepare(
        `UPDATE task_blocks SET status = 'missed', updated_at = ?
         WHERE status = 'planned' AND task_id IN (
           SELECT id FROM tasks WHERE sprint_id = ? AND recurring_rule_id IS NOT NULL AND status != 'done')`,
      ).run(now, active.id);
      db.prepare(
        `UPDATE tasks SET missed_at = ?
         WHERE sprint_id = ? AND recurring_rule_id IS NOT NULL AND status != 'done' AND missed_at IS NULL`,
      ).run(now, active.id);
      // Tasks created after grooming and still open go back to the backlog.
      db.prepare(
        `UPDATE tasks SET sprint_id = NULL,
           backlog_rank = (SELECT coalesce(max(backlog_rank), 0) + 1 FROM tasks WHERE sprint_id IS NULL), updated_at = ?
         WHERE sprint_id = ? AND status != 'done' AND recurring_rule_id IS NULL`,
      ).run(nowIso(), active.id);
      db.prepare("UPDATE sprints SET status = 'closed', closed_at = ? WHERE id = ?").run(nowIso(), active.id);
    }
    db.prepare("UPDATE sprints SET status = 'active', planning_step = NULL, scheduled_at = NULL WHERE id = ?").run(planned.id);
  });
  return getSprint(db, planned.id)!;
}

/** Sets SP for all occurrences of a rule in a sprint and stores it as the rule default. */
export function setRecurringSp(db: DB, sprintId: number, ruleId: number, sp: number | null): number[] {
  return tx(db, () => {
    const rows = db
      .prepare("SELECT id FROM tasks WHERE sprint_id = ? AND recurring_rule_id = ?")
      .all(sprintId, ruleId) as { id: number }[];
    db.prepare("UPDATE tasks SET points = ?, updated_at = ? WHERE sprint_id = ? AND recurring_rule_id = ?").run(
      sp,
      nowIso(),
      sprintId,
      ruleId,
    );
    db.prepare("UPDATE recurring_rules SET default_sp = ? WHERE id = ?").run(sp, ruleId);
    return rows.map((r) => r.id);
  });
}

export function sprintStats(db: DB, sprint: Sprint): SprintStats {
  const tasks = db
    .prepare("SELECT id, points AS sp, status, carried_from_sprint_id, recurring_rule_id, unplanned_at FROM tasks WHERE sprint_id = ?")
    .all(sprint.id) as {
    id: number;
    sp: number | null;
    status: string;
    carried_from_sprint_id: number | null;
    recurring_rule_id: number | null;
    unplanned_at: string | null;
  }[];
  const per = db
    .prepare(
      `SELECT a.user_id,
         sum(coalesce(t.points, 0)) AS planned,
         sum(CASE WHEN t.status = 'done' THEN coalesce(t.points, 0) ELSE 0 END) AS done
       FROM tasks t JOIN task_assignees a ON a.task_id = t.id
       WHERE t.sprint_id = ? GROUP BY a.user_id`,
    )
    .all(sprint.id) as { user_id: number; planned: number; done: number }[];
  const perMap = new Map(per.map((p) => [p.user_id, p]));
  const unplanned = tasks.filter((t) => t.unplanned_at !== null);
  return {
    sprint,
    totalPlannedSp: tasks.reduce((s, t) => s + (t.sp ?? 0), 0),
    totalDoneSp: tasks.filter((t) => t.status === "done").reduce((s, t) => s + (t.sp ?? 0), 0),
    perUser: sprint.members.map((m) => ({
      userId: m.userId,
      plannedSp: perMap.get(m.userId)?.planned ?? 0,
      doneSp: m.doneSpSnapshot ?? perMap.get(m.userId)?.done ?? 0,
      targetSp: m.targetSp,
    })),
    taskCount: tasks.length,
    doneCount: tasks.filter((t) => t.status === "done").length,
    carriedInCount: tasks.filter((t) => t.carried_from_sprint_id !== null && t.recurring_rule_id === null).length,
    unplannedCount: unplanned.length,
    unplannedSp: unplanned.reduce((s, t) => s + (t.sp ?? 0), 0),
    unplannedDoneSp: unplanned.filter((t) => t.status === "done").reduce((s, t) => s + (t.sp ?? 0), 0),
  };
}
