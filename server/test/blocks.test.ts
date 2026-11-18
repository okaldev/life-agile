import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrate, openDb } from "../src/db/db.ts";
import { MIGRATIONS } from "../src/db/migrations.ts";
import { getTask, setAssignees } from "../src/db/repo.ts";
import { addBlock, computeProgress, setBlockStatus } from "../src/domain/blocks.ts";
import { cancelPlanning, finishPlanning, setStep, startPlanning } from "../src/domain/sprint.ts";

/** A database in the v1 schema, like production before this change. */
function v1Db(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (1);");
  db.exec(MIGRATIONS[0]);
  return db;
}

test("migration 2 keeps every task and creates one part per dated task", () => {
  const db = v1Db();
  db.exec(`
    INSERT INTO users (email, name) VALUES ('f@x', 'Alice');
    INSERT INTO sprints (number, start_date, end_date, status) VALUES (1, '2026-11-16', '2026-11-22', 'active');
    INSERT INTO tasks (title, sprint_id, status, date, start_time, end_time) VALUES
      ('timed', 1, 'todo', '2026-11-16', '09:00', '18:00'),
      ('all day', 1, 'in_progress', '2026-11-17', NULL, NULL),
      ('done', 1, 'done', '2026-11-18', '10:00', NULL),
      ('undated', NULL, 'todo', NULL, NULL, NULL);
  `);
  const before = db.prepare("SELECT * FROM tasks ORDER BY id").all();
  migrate(db);
  assert.equal((db.prepare("SELECT version FROM schema_version").get() as any).version, MIGRATIONS.length);
  const after = db.prepare("SELECT id, title, sprint_id, status, date, start_time, end_time FROM tasks ORDER BY id").all();
  assert.deepEqual(
    after.map((r) => ({ ...r })),
    before.map((r: any) => ({
      id: r.id,
      title: r.title,
      sprint_id: r.sprint_id,
      status: r.status,
      date: r.date,
      start_time: r.start_time,
      end_time: r.end_time,
    })),
  );
  const blocks = db.prepare("SELECT task_id, date, start_time, end_time, status FROM task_blocks ORDER BY task_id").all() as any[];
  assert.deepEqual(
    blocks.map((b) => ({ ...b })),
    [
      { task_id: 1, date: "2026-11-16", start_time: "09:00", end_time: "18:00", status: "planned" },
      { task_id: 2, date: "2026-11-17", start_time: null, end_time: null, status: "planned" },
      { task_id: 3, date: "2026-11-18", start_time: "10:00", end_time: null, status: "done" },
    ],
  );
  // Running migrate again changes nothing.
  migrate(db);
  assert.equal((db.prepare("SELECT count(*) AS n FROM task_blocks").get() as any).n, 3);
});

test("progress rules", () => {
  const base = { status: "todo", progressManual: null, blocks: [], checklistTotal: 0, checklistDone: 0 };
  assert.equal(computeProgress(base), 0);
  assert.equal(computeProgress({ ...base, status: "done" }), 100);
  assert.equal(computeProgress({ ...base, checklistTotal: 4, checklistDone: 1 }), 25);
  const blocks = [
    { startTime: "09:00", endTime: "10:00", status: "done" as const },
    { startTime: "14:00", endTime: "17:00", status: "planned" as const },
  ];
  assert.equal(computeProgress({ ...base, blocks }), 25);
  assert.equal(computeProgress({ ...base, blocks, progressManual: 80 }), 80);
});

test("single part follows the task; split task tracks progress", () => {
  const db = openDb(":memory:");
  db.exec("INSERT INTO users (email, name) VALUES ('f@x', 'Alice')");
  const mk = (title: string) => {
    const id = Number(db.prepare("INSERT INTO tasks (title) VALUES (?)").run(title).lastInsertRowid);
    setAssignees(db, id, [1]);
    return id;
  };
  const one = mk("one");
  const b1 = addBlock(db, one, { date: "2026-11-16", startTime: "09:00", endTime: "10:00" });
  assert.equal(getTask(db, one)!.date, "2026-11-16");
  setBlockStatus(db, b1.id, "missed");
  assert.ok(getTask(db, one)!.missedAt);
  assert.equal(getTask(db, one)!.status, "todo");
  setBlockStatus(db, b1.id, "done");
  assert.equal(getTask(db, one)!.status, "done");
  assert.equal(getTask(db, one)!.missedAt, null);
  setBlockStatus(db, b1.id, "planned");
  assert.equal(getTask(db, one)!.status, "todo");

  const split = mk("homework");
  const p1 = addBlock(db, split, { date: "2026-11-18", startTime: "10:00", endTime: "11:00" });
  addBlock(db, split, { date: "2026-11-17", startTime: "20:00", endTime: "23:00" });
  const t = getTask(db, split)!;
  assert.equal(t.blocks.length, 2);
  assert.equal(t.date, "2026-11-17"); // cache = earliest part
  setBlockStatus(db, p1.id, "done");
  const t2 = getTask(db, split)!;
  assert.equal(t2.status, "in_progress");
  assert.equal(t2.progress, 25);
});

test("sprint close marks unfinished recurring occurrences missed", () => {
  const db = openDb(":memory:");
  db.exec("INSERT INTO users (email, name) VALUES ('f@x', 'Alice')");
  db.exec("INSERT INTO recurring_rules (title, freq, start_time, end_time) VALUES ('Spor', 'daily', '07:00', '08:00')");
  db.exec("INSERT INTO recurring_rule_assignees (rule_id, user_id) VALUES (1, 1)");
  const s1 = startPlanning(db, "2026-11-15");
  finishPlanning(db);
  const occ = db.prepare("SELECT id FROM tasks WHERE sprint_id = ? ORDER BY occurrence_date").all(s1.id) as any[];
  assert.equal(occ.length, 7);
  assert.equal(getTask(db, occ[0].id)!.blocks.length, 1);
  setBlockStatus(db, getTask(db, occ[0].id)!.blocks[0].id, "done");
  startPlanning(db, "2026-11-22");
  setStep(db, "grooming");
  finishPlanning(db);
  const states = occ.map((o) => getTask(db, o.id)!);
  assert.equal(states[0].status, "done");
  assert.ok(states.slice(1).every((t) => t.missedAt && t.blocks[0].status === "missed"));
});

test("planning moves next-week occurrences instead of duplicating; cancel moves them back", () => {
  const db = openDb(":memory:");
  db.exec("INSERT INTO users (email, name) VALUES ('f@x', 'Alice')");
  db.exec("INSERT INTO recurring_rules (title, freq, start_time, end_time) VALUES ('Mesai', 'weekdays', '09:00', '18:00')");
  db.exec("INSERT INTO recurring_rule_assignees (rule_id, user_id) VALUES (1, 1)");
  // Like production: sprint 1 was opened for 16-22 Nov, then its dates were moved to 9-15 Nov.
  const s1 = startPlanning(db, "2026-11-15");
  finishPlanning(db);
  db.exec(`UPDATE sprints SET start_date = '2026-11-09', end_date = '2026-11-15' WHERE id = ${s1.id}`);
  const occ = (sprintId: number) =>
    (db.prepare("SELECT count(*) AS n FROM tasks WHERE sprint_id = ? AND recurring_rule_id = 1").get(sprintId) as any).n;
  assert.equal(occ(s1.id), 5);

  const s2 = startPlanning(db, "2026-11-15");
  assert.equal(s2.startDate, "2026-11-16");
  setStep(db, "grooming");
  assert.equal(occ(s1.id), 0);
  assert.equal(occ(s2.id), 5);
  assert.equal((db.prepare("SELECT count(*) AS n FROM tasks").get() as any).n, 5); // no duplicates

  cancelPlanning(db);
  assert.equal(occ(s1.id), 5);
  assert.equal((db.prepare("SELECT count(*) AS n FROM tasks").get() as any).n, 5);

  startPlanning(db, "2026-11-15");
  setStep(db, "grooming");
  finishPlanning(db);
  const closed = db.prepare("SELECT count(*) AS n FROM tasks WHERE sprint_id = ? AND missed_at IS NOT NULL").get(s1.id) as any;
  assert.equal(closed.n, 0); // next-week occurrences were not marked missed
});

test("migration 3 copies story points into points and keeps sp", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (2);");
  db.exec(MIGRATIONS[0]);
  db.exec(MIGRATIONS[1]);
  db.exec("INSERT INTO tasks (title, sp) VALUES ('a', 3), ('b', NULL), ('c', 5)");
  migrate(db);
  const rows = db.prepare("SELECT sp, points, unplanned_at FROM tasks ORDER BY id").all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { sp: 3, points: 3, unplanned_at: null },
    { sp: null, points: null, unplanned_at: null },
    { sp: 5, points: 5, unplanned_at: null },
  ]);
});

test("migration 4 adds user_avatars and keeps users", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (3);");
  for (const m of MIGRATIONS.slice(0, 3)) db.exec(m);
  db.exec("INSERT INTO users (email, name, avatar_url) VALUES ('f@x', 'Alice', 'https://g/1')");
  migrate(db);
  assert.equal((db.prepare("SELECT version FROM schema_version").get() as any).version, MIGRATIONS.length);
  assert.deepEqual({ ...(db.prepare("SELECT email, avatar_url FROM users").get() as any) }, { email: "f@x", avatar_url: "https://g/1" });
  assert.equal((db.prepare("SELECT count(*) AS n FROM user_avatars").get() as any).n, 0);
});
