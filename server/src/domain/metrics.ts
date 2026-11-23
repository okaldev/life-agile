// Dashboard metrics. Definitions: openwiki/metrics.md.
import type { Metrics, SprintStats } from "../../../shared/types.ts";
import type { DB } from "../db/db.ts";
import { getSprintByStatus, listRules, listSprints } from "../db/repo.ts";
import { sprintStats } from "./sprint.ts";
import { addDays, daysBetween, localNow, today } from "./time.ts";

type Row = Record<string, any>;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function burndown(db: DB, todayDate = today()): Metrics["burndown"] {
  const active = getSprintByStatus(db, "active");
  if (!active) return [];
  const tasks = db
    .prepare("SELECT points AS sp, status, done_at FROM tasks WHERE sprint_id = ? AND cancelled_at IS NULL")
    .all(active.id) as { sp: number | null; status: string; done_at: string | null }[];
  const planned = tasks.reduce((s, t) => s + (t.sp ?? 0), 0);
  const doneByDate = tasks
    .filter((t) => t.status === "done" && t.done_at)
    .map((t) => ({ sp: t.sp ?? 0, date: localNow(new Date(t.done_at!)).date }));
  const days = daysBetween(active.startDate, active.endDate) + 1;
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(active.startDate, i);
    const done = doneByDate.filter((d) => d.date <= date).reduce((s, d) => s + d.sp, 0);
    return {
      date,
      remaining: date <= todayDate ? planned - done : null,
      ideal: Math.round((planned * (days - 1 - i)) / (days - 1) * 10) / 10,
    };
  });
}

export function computeMetrics(db: DB, todayDate = today()): Metrics {
  const sprints = listSprints(db).filter((s) => s.status !== "planned");
  const stats: SprintStats[] = sprints.map((s) => sprintStats(db, s));
  const closed = stats.filter((s) => s.sprint.status === "closed");
  const userIds = (db.prepare("SELECT id FROM users ORDER BY id").all() as { id: number }[]).map((r) => r.id);

  const hitRate: Metrics["hitRate"] = [
    ...userIds.map((userId) => {
      const rows = closed.map((s) => s.perUser.find((p) => p.userId === userId)).filter((p) => p && p.targetSp > 0);
      return { userId, hit: rows.filter((p) => p!.doneSp >= p!.targetSp).length, total: rows.length };
    }),
    (() => {
      const rows = closed.filter((s) => s.perUser.some((p) => p.targetSp > 0));
      const hit = rows.filter((s) => s.perUser.every((p) => p.doneSp >= p.targetSp)).length;
      return { userId: null, hit, total: rows.length };
    })(),
  ];

  const carryOver: Metrics["carryOver"] = stats.slice(1).map((s, i) => {
    const prev = stats[i];
    const base = prev.taskCount + s.carriedInCount;
    return { sprintId: s.sprint.id, number: s.sprint.number, rate: base ? s.carriedInCount / base : 0 };
  });

  const recent = stats.slice(-4).map((s) => s.sprint.id);
  const recentList = recent.length ? recent.join(",") : "NULL";

  const recurring: Metrics["recurring"] = listRules(db)
    .filter((r) => r.active)
    .map((rule) => {
      const occ = db
        .prepare(
          `SELECT status, occurrence_date, missed_at FROM tasks
           WHERE recurring_rule_id = ? AND sprint_id IN (${recentList}) AND occurrence_date <= ?
           ORDER BY occurrence_date DESC`,
        )
        .all(rule.id, todayDate) as { status: string; occurrence_date: string; missed_at: string | null }[];
      let streak = 0;
      for (const o of occ) {
        if (o.status === "done") streak++;
        else if (o.occurrence_date === todayDate && !o.missed_at) continue; // today is not over yet
        else break;
      }
      // Past days count even when nobody marked them; today counts once it is marked.
      const counted = occ.filter((o) => o.occurrence_date < todayDate || o.status === "done" || o.missed_at);
      return {
        ruleId: rule.id,
        title: rule.title,
        done: counted.filter((o) => o.status === "done").length,
        missed: counted.filter((o) => o.status !== "done").length,
        total: counted.length,
        streak,
      };
    });

  const catRows = db
    .prepare(
      `SELECT category_id, sum(coalesce(points, 0)) AS all_sp,
         sum(CASE WHEN sprint_id IN (${recentList}) THEN coalesce(points, 0) ELSE 0 END) AS recent_sp
       FROM tasks WHERE status = 'done' AND sprint_id IS NOT NULL GROUP BY category_id`,
    )
    .all() as Row[];
  const categories = catRows.map((r) => ({ categoryId: r.category_id ?? null, recentSp: r.recent_sp, allSp: r.all_sp }));

  const timed = db
    .prepare("SELECT points AS sp, started_at, done_at FROM tasks WHERE status = 'done' AND points IS NOT NULL AND started_at IS NOT NULL AND done_at IS NOT NULL")
    .all() as { sp: number; started_at: string; done_at: string }[];
  const estimateAccuracy = [0, 0.5, 1, 2, 3, 4, 5]
    .map((sp) => {
      const hours = timed
        .filter((t) => t.sp === sp)
        .map((t) => (Date.parse(t.done_at) - Date.parse(t.started_at)) / 3_600_000)
        .filter((h) => h >= 0);
      return { sp, medianHours: hours.length ? Math.round(median(hours) * 10) / 10 : 0, count: hours.length };
    })
    .filter((x) => x.count > 0);

  return { sprints: stats, burndown: burndown(db, todayDate), hitRate, carryOver, recurring, categories, estimateAccuracy };
}
