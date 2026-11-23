import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { test } from "node:test";
import { openDb, type DB } from "../src/db/db.ts";
import { getSprintByStatus, getTask, listTasks, setAssignees } from "../src/db/repo.ts";
import { generateOccurrences, occurrenceDates } from "../src/domain/recurrence.ts";
import {
  cancelPlanning,
  finishPlanning,
  setRecurringSp,
  setStep,
  sprintStats,
  startPlanning,
} from "../src/domain/sprint.ts";
import { addDays, localNow, nextSprintStart, weekdayIndex, weekStart } from "../src/domain/time.ts";

function setup(): { db: DB; alice: number; bob: number } {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (email, name) VALUES ('f@x', 'Alice'), ('b@x', 'Bob')").run();
  return { db, alice: 1, bob: 2 };
}

function addTask(db: DB, title: string, sprintId: number | null, assignees: number[], sp: number | null = null): number {
  const res = db.prepare("INSERT INTO tasks (title, sprint_id, points) VALUES (?, ?, ?)").run(title, sprintId, sp);
  const id = Number(res.lastInsertRowid);
  setAssignees(db, id, assignees);
  return id;
}

test("time helpers use Monday-based weeks", () => {
  assert.equal(weekdayIndex("2026-11-16"), 0); // Monday
  assert.equal(weekdayIndex("2026-11-15"), 6); // Sunday
  assert.equal(weekStart("2026-11-15"), "2026-11-09");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  // 21:30 UTC is 00:30 next day in Istanbul.
  assert.equal(localNow(new Date("2026-11-15T21:30:00Z")).date, "2026-11-16");
});

test("next sprint start", () => {
  assert.equal(nextSprintStart(null, "2026-11-12"), "2026-11-09"); // Thursday: current week
  assert.equal(nextSprintStart(null, "2026-11-15"), "2026-11-16"); // Sunday: next week
  assert.equal(nextSprintStart(null, "2026-11-14"), "2026-11-09"); // Saturday: current week
  assert.equal(nextSprintStart("2026-11-15", "2026-11-15"), "2026-11-16");
  assert.equal(nextSprintStart("2026-11-01", "2026-11-12"), "2026-11-09"); // missed weeks
});

test("occurrence dates per frequency", () => {
  const w = "2026-11-16";
  assert.equal(occurrenceDates({ freq: "daily", weekdaysMask: 0 }, w).length, 7);
  assert.deepEqual(occurrenceDates({ freq: "weekdays", weekdaysMask: 0 }, w), [
    "2026-11-16",
    "2026-11-17",
    "2026-11-18",
    "2026-11-19",
    "2026-11-20",
  ]);
  assert.deepEqual(occurrenceDates({ freq: "weekly", weekdaysMask: 0b1000001 }, w), ["2026-11-16", "2026-11-22"]);
});

test("full planning cycle: carry-over, recurring, finish, stats", () => {
  const { db, alice, bob } = setup();
  db.prepare(
    "INSERT INTO recurring_rules (title, freq, start_time, end_time, default_sp) VALUES ('Mesai', 'weekdays', '09:00', '18:00', 2)",
  ).run();
  db.prepare("INSERT INTO recurring_rule_assignees (rule_id, user_id) VALUES (1, ?)").run(alice);

  // First sprint: no retro, grooming generates occurrences.
  const s1 = startPlanning(db, "2026-11-15");
  assert.equal(s1.planningStep, "grooming");
  assert.equal(s1.startDate, "2026-11-16");
  assert.equal(listTasks(db, "t.sprint_id = ?", s1.id).length, 5);
  const shared = addTask(db, "Market", s1.id, [alice, bob], 3);
  const open = addTask(db, "Vergi", s1.id, [bob], 5);
  finishPlanning(db);
  assert.equal(getSprintByStatus(db, "active")!.id, s1.id);

  db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(shared);
  db.prepare("UPDATE tasks SET status = 'done' WHERE recurring_rule_id = 1 AND occurrence_date = '2026-11-16'").run();
  db.prepare("UPDATE sprint_members SET target_sp = 6 WHERE user_id = ?").run(alice);

  // Second sprint: retro first, then grooming carries the open task.
  const s2 = startPlanning(db, "2026-11-22");
  assert.equal(s2.planningStep, "retro");
  assert.equal(s2.startDate, "2026-11-23");
  assert.equal(s2.members.find((m) => m.userId === alice)!.targetSp, 6);
  setStep(db, "grooming");
  assert.equal(getTask(db, open)!.sprintId, s2.id);
  assert.equal(getTask(db, open)!.carriedFromSprintId, s1.id);
  // Recurring occurrences of the old week stay in the old sprint.
  assert.equal(listTasks(db, "t.sprint_id = ? AND t.recurring_rule_id = 1", s1.id).length, 5);
  assert.equal(listTasks(db, "t.sprint_id = ? AND t.recurring_rule_id = 1", s2.id).length, 5);

  setRecurringSp(db, s2.id, 1, 1);
  assert.ok(listTasks(db, "t.sprint_id = ? AND t.recurring_rule_id = 1", s2.id).every((t) => t.sp === 1));

  finishPlanning(db);
  const closed = sprintStats(db, { ...db.prepare("SELECT * FROM sprints WHERE id = ?").get(s1.id) as any, members: [] });
  assert.equal(closed.totalDoneSp, 3 + 2);
  const s1Row = listTasks(db, "t.sprint_id = ?", s1.id);
  assert.ok(s1Row.every((t) => t.recurringRuleId !== null || t.status === "done"));
  const s1Members = db.prepare("SELECT * FROM sprint_members WHERE sprint_id = ? ORDER BY user_id").all(s1.id) as any[];
  assert.deepEqual(
    s1Members.map((m) => m.done_sp_snapshot),
    [3 + 2, 3],
  ); // shared task counts for both
  assert.equal(getSprintByStatus(db, "active")!.id, s2.id);
});

test("cancel planning restores tasks", () => {
  const { db, alice } = setup();
  const s1 = startPlanning(db, "2026-11-15");
  const t = addTask(db, "A", s1.id, [alice], 2);
  finishPlanning(db);
  const backlog = addTask(db, "B", null, [alice]);
  const s2 = startPlanning(db, "2026-11-22");
  setStep(db, "grooming");
  db.prepare("UPDATE tasks SET sprint_id = ? WHERE id = ?").run(s2.id, backlog);
  cancelPlanning(db);
  assert.equal(getTask(db, t)!.sprintId, s1.id);
  assert.equal(getTask(db, t)!.carriedFromSprintId, null);
  assert.equal(getTask(db, backlog)!.sprintId, null);
  assert.equal(getSprintByStatus(db, "planned"), null);
});

test("generateOccurrences is idempotent", () => {
  const { db, alice } = setup();
  db.prepare("INSERT INTO recurring_rules (title, freq) VALUES ('Spor', 'daily')").run();
  db.prepare("INSERT INTO recurring_rule_assignees (rule_id, user_id) VALUES (1, ?)").run(alice);
  const s = startPlanning(db, "2026-11-15");
  assert.equal(generateOccurrences(db, s.id).length, 0);
  assert.equal(listTasks(db, "t.sprint_id = ?", s.id).length, 7);
});

test("metrics: velocity, hit rate, carry-over, recurring streak", async () => {
  const { computeMetrics } = await import("../src/domain/metrics.ts");
  const { db, alice, bob } = setup();
  db.prepare("INSERT INTO recurring_rules (title, freq) VALUES ('Spor', 'daily')").run();
  db.prepare("INSERT INTO recurring_rule_assignees (rule_id, user_id) VALUES (1, ?)").run(alice);
  const s1 = startPlanning(db, "2026-11-15");
  const a = addTask(db, "A", s1.id, [alice], 3);
  addTask(db, "B", s1.id, [bob], 2);
  finishPlanning(db);
  db.prepare("UPDATE sprint_members SET target_sp = 3").run();
  db.prepare("UPDATE tasks SET status = 'done', started_at = '2026-11-16T08:00:00Z', done_at = '2026-11-16T10:00:00Z' WHERE id = ?").run(a);
  db.prepare("UPDATE tasks SET status = 'done' WHERE recurring_rule_id = 1 AND occurrence_date <= '2026-11-18'").run();
  const m1 = computeMetrics(db, "2026-11-19");
  assert.deepEqual(
    m1.recurring.map((r) => [r.done, r.total, r.streak]),
    [[3, 3, 3]],
  );
  assert.equal(m1.burndown.length, 7);
  assert.equal(m1.burndown[3].remaining, 5 - 3);
  assert.equal(m1.burndown[4].remaining, null);
  assert.deepEqual(m1.estimateAccuracy, [{ sp: 3, medianHours: 2, count: 1 }]);

  startPlanning(db, "2026-11-22");
  setStep(db, "grooming");
  finishPlanning(db);
  const m2 = computeMetrics(db, "2026-11-23");
  assert.equal(m2.sprints.length, 2);
  assert.deepEqual(m2.hitRate.find((h) => h.userId === alice), { userId: alice, hit: 1, total: 1 });
  assert.deepEqual(m2.hitRate.find((h) => h.userId === bob), { userId: bob, hit: 0, total: 1 });
  assert.equal(m2.carryOver[0].rate, 1 / 9); // B carried; sprint 1 had A + 7 recurring + B
});

test("scheduler window and backup rotation", async () => {
  const { due, backup } = await import("../src/jobs/scheduler.ts");
  const { mkdtempSync, readdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  assert.equal(due({ date: "2026-11-15", time: "20:00", weekday: 6 }, "20:00"), true);
  assert.equal(due({ date: "2026-11-15", time: "20:29", weekday: 6 }, "20:00"), true);
  assert.equal(due({ date: "2026-11-15", time: "20:30", weekday: 6 }, "20:00"), false);
  assert.equal(due({ date: "2026-11-15", time: "19:59", weekday: 6 }, "20:00"), false);

  const dir = mkdtempSync(join(tmpdir(), "la-"));
  const db = openDb(join(dir, "agile.db"));
  mkdirSync(join(dir, "backups"));
  for (let i = 1; i <= 31; i++) writeFileSync(join(dir, "backups", `agile-2026-10-${String(i).padStart(2, "0")}.db`), "");
  backup(db, join(dir, "agile.db"), "2026-11-14");
  const files = readdirSync(join(dir, "backups")).sort();
  assert.equal(files.length, 30);
  assert.equal(files.at(-1), "agile-2026-11-14.db");
});

test("time zone from config: local to UTC is DST-safe", async () => {
  const { setTimeZone, localToUtc, localNow } = await import("../src/domain/time.ts");
  try {
    setTimeZone("Europe/Berlin");
    assert.equal(localToUtc("2026-01-15", "09:00").toISOString(), "2026-01-15T08:00:00.000Z"); // CET
    assert.equal(localToUtc("2026-07-15", "09:00").toISOString(), "2026-07-15T07:00:00.000Z"); // CEST
    assert.equal(localNow(new Date("2026-07-15T22:30:00Z")).date, "2026-07-16");
  } finally {
    setTimeZone("Europe/Istanbul");
  }
  assert.equal(localToUtc("2026-11-16", "09:00").toISOString(), "2026-11-16T06:00:00.000Z");
});

test("early planning: scheduled start keeps the old sprint running, then starts by itself", async () => {
  const { schedulePlanning, dueScheduledSprint } = await import("../src/domain/sprint.ts");
  const { tick } = await import("../src/jobs/scheduler.ts");
  const { db, alice } = setup();
  const s1 = startPlanning(db, "2026-11-12"); // Thursday: sprint 1 = 9-15 Nov
  finishPlanning(db);
  const open = addTask(db, "open", s1.id, [alice], 2);
  const willFinish = addTask(db, "finished before start", s1.id, [alice], 3);

  // The plan for 16-22 Nov is made early, on Thursday 12 Nov.
  const s2 = startPlanning(db, "2026-11-12");
  assert.equal(s2.startDate, "2026-11-16");
  setStep(db, "grooming");
  assert.equal(getTask(db, open)!.sprintId, s2.id); // carried in grooming
  assert.throws(() => schedulePlanning(db, "2026-11-16")); // week already started: start now instead
  const scheduled = schedulePlanning(db, "2026-11-12");
  assert.ok(scheduled.scheduledAt);
  assert.equal(scheduled.planningStep, null);
  assert.equal(getSprintByStatus(db, "active")!.id, s1.id); // old sprint keeps running

  // Work goes on in the old week: one carried task is done, a new one is added.
  assert.equal(getTask(db, willFinish)!.carriedFromSprintId, s1.id);
  db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(willFinish);
  const late = addTask(db, "added after planning", s1.id, [alice], 1);

  // Reopen and schedule again: the plan stays.
  assert.equal(startPlanning(db, "2026-11-13").planningStep, "start");
  assert.equal(getSprintByStatus(db, "planned")!.scheduledAt, null);
  schedulePlanning(db, "2026-11-13");

  assert.equal(dueScheduledSprint(db, "2026-11-15"), null);
  await tick(db, ":memory:", { date: "2026-11-15", time: "23:59", weekday: 6 });
  assert.equal(getSprintByStatus(db, "active")!.id, s1.id);
  await tick(db, ":memory:", { date: "2026-11-16", time: "00:00", weekday: 0 });
  assert.equal(getSprintByStatus(db, "active")!.id, s2.id);
  assert.equal(getSprintByStatus(db, "planned"), null);
  assert.equal(getTask(db, willFinish)!.sprintId, s1.id); // done before the start: counts for sprint 1
  assert.equal(getTask(db, open)!.sprintId, s2.id);
  assert.equal(getTask(db, late)!.sprintId, s2.id); // open work carries over on a scheduled start
  const closed = db.prepare("SELECT status, done_sp_snapshot AS done FROM sprints s JOIN sprint_members m ON m.sprint_id = s.id WHERE s.id = ? AND m.user_id = ?").get(s1.id, alice) as any;
  assert.deepEqual([closed.status, closed.done], ["closed", 3]);
});
