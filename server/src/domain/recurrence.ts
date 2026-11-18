// Recurring rules: which dates a rule hits in a week, and occurrence generation.
import type { RecurringRule } from "../../../shared/types.ts";
import type { DB } from "../db/db.ts";
import { nowIso, tx } from "../db/db.ts";
import { getRule, getSprint, listRules } from "../db/repo.ts";
import { addBlock, syncTaskSchedule } from "./blocks.ts";
import { weekDates, weekdayIndex } from "./time.ts";

export function ruleHitsDay(rule: Pick<RecurringRule, "freq" | "weekdaysMask">, weekday: number): boolean {
  if (rule.freq === "daily") return true;
  if (rule.freq === "weekdays") return weekday < 5;
  return (rule.weekdaysMask & (1 << weekday)) !== 0;
}

export function occurrenceDates(rule: Pick<RecurringRule, "freq" | "weekdaysMask">, weekStart: string): string[] {
  return weekDates(weekStart).filter((d) => ruleHitsDay(rule, weekdayIndex(d)));
}

/** SP of the latest occurrence of the rule outside the given sprint, else the rule default. */
export function previousSp(db: DB, rule: RecurringRule, sprintId: number): number | null {
  const r = db
    .prepare(
      `SELECT points AS sp FROM tasks WHERE recurring_rule_id = ? AND sprint_id IS NOT ? AND points IS NOT NULL
       ORDER BY occurrence_date DESC LIMIT 1`,
    )
    .get(rule.id, sprintId) as { sp: number } | undefined;
  return r?.sp ?? rule.defaultSp;
}

/**
 * Inserts missing occurrences of active rules for the sprint week.
 * Only dates >= fromDate are generated. Returns the new task ids.
 */
export function generateOccurrences(db: DB, sprintId: number, fromDate = "0000-00-00", onlyRuleId?: number): number[] {
  const sprint = getSprint(db, sprintId);
  if (!sprint) return [];
  const rules = (onlyRuleId ? [getRule(db, onlyRuleId)!] : listRules(db)).filter((r) => r && r.active);
  const created: number[] = [];
  tx(db, () => {
    const insert = db.prepare(
      `INSERT INTO tasks (title, description, category_id, sprint_id, points, date, start_time, end_time,
         recurring_rule_id, occurrence_date, created_by, created_at, updated_at, unplanned_at, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 1)
       ON CONFLICT DO NOTHING`,
    );
    const assign = db.prepare("INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)");
    for (const rule of rules) {
      const sp = previousSp(db, rule, sprintId);
      for (const date of occurrenceDates(rule, sprint.startDate)) {
        if (date < fromDate) continue;
        const now = nowIso();
        const res = insert.run(
          rule.title,
          rule.description,
          rule.categoryId,
          sprintId,
          sp,
          date,
          rule.startTime,
          rule.startTime ? rule.endTime : null,
          rule.id,
          date,
          now,
          now,
          sprint.status === "active" ? now : null, // a rule added mid-sprint is unplanned work
        );
        if (res.changes > 0) {
          const id = Number(res.lastInsertRowid);
          for (const u of rule.assigneeIds) assign.run(id, u);
          addBlock(db, id, { date, startTime: rule.startTime, endTime: rule.endTime });
          created.push(id);
        }
      }
    }
  });
  return created;
}

/** Applies rule field changes to its open occurrences on or after fromDate. */
export function syncFutureOccurrences(
  db: DB,
  ruleId: number,
  fromDate: string,
): { changed: number[]; removed: number[] } {
  const changed: number[] = [];
  const removed: number[] = [];
  const rule = getRule(db, ruleId);
  if (!rule) return { changed, removed };
  const rows = db
    .prepare(
      `SELECT id, occurrence_date FROM tasks
       WHERE recurring_rule_id = ? AND status = 'todo' AND missed_at IS NULL AND occurrence_date >= ?`,
    )
    .all(ruleId, fromDate) as { id: number; occurrence_date: string }[];
  tx(db, () => {
    for (const r of rows) {
      if (!rule.active || !ruleHitsDay(rule, weekdayIndex(r.occurrence_date))) {
        db.prepare("DELETE FROM tasks WHERE id = ?").run(r.id);
        removed.push(r.id);
        continue;
      }
      db.prepare(
        `UPDATE tasks SET title = ?, description = ?, category_id = ?, start_time = ?, end_time = ?, updated_at = ?
         WHERE id = ?`,
      ).run(rule.title, rule.description, rule.categoryId, rule.startTime, rule.startTime ? rule.endTime : null, nowIso(), r.id);
      db.prepare("UPDATE task_blocks SET start_time = ?, end_time = ? WHERE task_id = ? AND status = 'planned'").run(
        rule.startTime,
        rule.startTime ? rule.endTime : null,
        r.id,
      );
      syncTaskSchedule(db, r.id);
      db.prepare("DELETE FROM task_assignees WHERE task_id = ?").run(r.id);
      for (const u of rule.assigneeIds)
        db.prepare("INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)").run(r.id, u);
      changed.push(r.id);
    }
  });
  return { changed, removed };
}
