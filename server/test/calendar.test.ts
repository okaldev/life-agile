import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.ts";
import { createSession, seedUsers } from "../src/auth/auth.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db/db.ts";
import { busyHours, materializeEvents } from "../src/domain/events.ts";
import { finishPlanning, startPlanning } from "../src/domain/sprint.ts";
import { today } from "../src/domain/time.ts";

function setup() {
  const cfg = loadConfig({ ALLOWED_EMAILS: "f@x.com:Alice,b@x.com:Bob", PUBLIC_URL: "https://agile.test" });
  const db = openDb(":memory:");
  seedUsers(db, cfg);
  const app = createApp(db, cfg);
  const cookie = `la_session=${createSession(db, 1).id}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: (await res.json()) as any };
  };
  return { db, call };
}

test("repeating events materialize once, series edit and busy hours", async () => {
  const { db, call } = setup();
  const r = await call("POST", "/api/calendar-events", {
    title: "Halı saha",
    kind: "meet",
    date: "2026-11-17",
    startTime: "20:00",
    endTime: "22:00",
    attendeeIds: [1],
    repeat: { freq: "weekly", weekdaysMask: 0b10 }, // Tuesday
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.length, 3); // 17, 24 Nov, 1 Dec (21 days)
  const week = await call("GET", "/api/calendar-events?from=2026-11-16&to=2026-11-22");
  assert.equal(week.data.length, 1);
  await call("GET", "/api/calendar-events?from=2026-11-16&to=2026-11-22");
  assert.equal(materializeEvents(db, "2026-11-16", "2026-11-30").length, 0);

  const guest = await call("POST", "/api/calendar-events", { title: "Misafir", kind: "guest", date: "2026-11-21", attendeeIds: [1, 2] });
  assert.equal(guest.status, 201);
  assert.equal(busyHours(db, 1, "2026-11-16", "2026-11-22"), 2 + 8);
  assert.equal(busyHours(db, 2, "2026-11-16", "2026-11-22"), 8);

  await call("PATCH", `/api/calendar-events/${week.data[0].id}`, { status: "missed" });
  assert.equal(busyHours(db, 1, "2026-11-16", "2026-11-22"), 8);
  const busy = await call("GET", "/api/busy?from=2026-11-16&to=2026-11-22");
  assert.deepEqual(busy.data, [
    { userId: 1, hours: 8 },
    { userId: 2, hours: 8 },
  ]);
});

test("event series delete removes only future planned occurrences", async () => {
  const { db, call } = setup();
  const d = today();
  const r = await call("POST", "/api/calendar-events", { title: "Kurs", date: d, attendeeIds: [1], repeat: { freq: "daily" } });
  const ruleId = r.data[0].ruleId;
  assert.ok(ruleId);
  await call("DELETE", `/api/event-rules/${ruleId}`);
  const left = db.prepare("SELECT count(*) AS n FROM calendar_events WHERE rule_id = ?").get(ruleId) as any;
  assert.equal(left.n, 0); // all were today or later and planned
  const rules = await call("GET", "/api/event-rules");
  assert.equal(rules.data.length, 0);
});

test("convert a task to recurring links it as an occurrence without duplicates", async () => {
  const { db, call } = setup();
  const s = startPlanning(db, today());
  finishPlanning(db);
  const t = await call("POST", "/api/tasks", {
    title: "Ders çalış",
    sp: 2,
    sprintId: s.id,
    assigneeIds: [1],
    date: s.endDate,
    startTime: "19:00",
    endTime: "21:00",
  });
  assert.equal(t.status, 201);
  const r = await call("POST", `/api/tasks/${t.data.id}/to-recurring`, { freq: "daily" });
  assert.equal(r.status, 201);
  assert.equal(r.data.linked, true);
  assert.equal(r.data.rule.defaultSp, 2);
  const occ = db
    .prepare("SELECT id, occurrence_date FROM tasks WHERE recurring_rule_id = ? ORDER BY occurrence_date")
    .all(r.data.rule.id) as any[];
  const dates = occ.map((o) => o.occurrence_date);
  assert.equal(new Set(dates).size, dates.length);
  assert.ok(occ.some((o) => o.id === t.data.id));
  assert.equal((await call("POST", `/api/tasks/${t.data.id}/to-recurring`, { freq: "daily" })).status, 409);
});

test("parts API: split, move, mark, compat 409", async () => {
  const { call } = setup();
  const t = await call("POST", "/api/tasks", { title: "Ödev", assigneeIds: [1], date: "2026-11-17", startTime: "10:00", endTime: "11:00" });
  assert.equal(t.data.blocks.length, 1);
  const p2 = await call("POST", `/api/tasks/${t.data.id}/blocks`, { date: "2026-11-18", startTime: "10:00", endTime: "13:00" });
  assert.equal(p2.status, 201);
  assert.equal((await call("PATCH", `/api/tasks/${t.data.id}`, { date: "2026-11-19" })).status, 409);
  await call("PATCH", `/api/blocks/${t.data.blocks[0].id}`, { status: "done" });
  const after = await call("GET", `/api/tasks/${t.data.id}`);
  assert.equal(after.data.progress, 25);
  await call("PATCH", `/api/tasks/${t.data.id}`, { progressManual: 60 });
  assert.equal((await call("GET", `/api/tasks/${t.data.id}`)).data.progress, 60);
  await call("DELETE", `/api/blocks/${p2.data.id}`);
  const one = await call("GET", `/api/tasks/${t.data.id}`);
  assert.equal(one.data.blocks.length, 1);
  assert.equal((await call("PATCH", `/api/tasks/${t.data.id}`, { date: "2026-11-20", startTime: "08:00" })).status, 200);
  assert.equal((await call("GET", `/api/tasks/${t.data.id}`)).data.blocks[0].date, "2026-11-20");
});

test("story points accept 0 and 0.5, reject 2.5", async () => {
  const { call } = setup();
  const zero = await call("POST", "/api/tasks", { title: "Z", sp: 0, assigneeIds: [1] });
  assert.equal(zero.data.sp, 0);
  const half = await call("POST", "/api/tasks", { title: "H", sp: 0.5, assigneeIds: [1] });
  assert.equal(half.data.sp, 0.5);
  assert.equal((await call("POST", "/api/tasks", { title: "X", sp: 2.5, assigneeIds: [1] })).status, 400);
  assert.equal((await call("PATCH", `/api/tasks/${half.data.id}`, { sp: 6 })).status, 400);
});

test("tasks added to the running sprint are unplanned; planning tasks are not", async () => {
  const { db, call } = setup();
  const s1 = startPlanning(db, "2026-11-11");
  const planned = await call("POST", "/api/tasks", { title: "Plan", sp: 2, sprintId: s1.id, assigneeIds: [1] });
  assert.equal(planned.data.unplannedAt, null);
  finishPlanning(db);
  const cr = await call("POST", "/api/tasks", { title: "Acil", sp: 0.5, sprintId: s1.id, assigneeIds: [1] });
  assert.ok(cr.data.unplannedAt);
  const fromBacklog = await call("POST", "/api/tasks", { title: "B", sp: 1, assigneeIds: [1] });
  assert.equal(fromBacklog.data.unplannedAt, null);
  const moved = await call("PATCH", `/api/tasks/${fromBacklog.data.id}`, { sprintId: s1.id });
  assert.ok(moved.data.unplannedAt);
  const back = await call("PATCH", `/api/tasks/${fromBacklog.data.id}`, { sprintId: null });
  assert.equal(back.data.unplannedAt, null);
  const off = await call("PATCH", `/api/tasks/${cr.data.id}`, { unplanned: false });
  assert.equal(off.data.unplannedAt, null);
  await call("PATCH", `/api/tasks/${cr.data.id}`, { unplanned: true, status: "done" });
  const stats = (await call("GET", "/api/sprints")).data[0];
  assert.equal(stats.unplannedCount, 1);
  assert.equal(stats.unplannedSp, 0.5);
  assert.equal(stats.unplannedDoneSp, 0.5);
  assert.equal(stats.totalPlannedSp, 2.5);
});
