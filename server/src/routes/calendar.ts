// Calendar routes: general events, event rules, tasks by date range, busy hours, task -> recurring.
// See openwiki/calendar.md.
import { Hono } from "hono";
import type { EventKind, RecurringFreq } from "../../../shared/types.ts";
import type { AppEnv } from "../auth/auth.ts";
import type { DB } from "../db/db.ts";
import { tx } from "../db/db.ts";
import { getRule, getSprintByStatus, getTask, listRules, listTasks, listUsers } from "../db/repo.ts";
import {
  busyHours,
  createEvent,
  createEventRule,
  getEvent,
  getEventRule,
  listEventRules,
  listEvents,
  materializeEvents,
  syncFutureEvents,
  updateEvent,
} from "../domain/events.ts";
import { generateOccurrences, ruleHitsDay } from "../domain/recurrence.ts";
import { addDays, today, weekdayIndex } from "../domain/time.ts";
import { body, emit, HttpError, idParam, logActivity, shortTitle, spanEnd, v, type C } from "./common.ts";

const KINDS: EventKind[] = ["meet", "guest", "out", "busy", "other"];
const FREQS: RecurringFreq[] = ["daily", "weekdays", "weekly"];

function attendees(db: DB, x: unknown): number[] {
  const list = v.ids(x, "attendeeIds");
  const known = new Set(listUsers(db).map((u) => u.id));
  if (list.length === 0 || list.some((i) => !known.has(i))) throw new HttpError(400, "attendeeIds invalid");
  return list;
}

function range(c: C): { from: string; to: string } {
  const from = v.date(c.req.query("from"), "from");
  const to = v.date(c.req.query("to"), "to");
  if (!from || !to || to < from) throw new HttpError(400, "from and to required");
  if (addDays(from, 62) < to) throw new HttpError(400, "range too long");
  return { from, to };
}

export function calendarRoutes(db: DB): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/calendar-events", (c) => {
    const { from, to } = range(c);
    materializeEvents(db, from, to);
    return c.json(listEvents(db, from, to));
  });

  app.post("/calendar-events", async (c) => {
    const b = await body(c);
    const title = v.str(b.title, "title", 200);
    if (!title) throw new HttpError(400, "title required");
    const date = v.date(b.date, "date");
    if (!date) throw new HttpError(400, "date required");
    const kind = KINDS.includes(b.kind) ? (b.kind as EventKind) : "other";
    const input = {
      title,
      note: v.str(b.note ?? "", "note", 5000),
      kind,
      date,
      endDate: spanEnd(date, b.endDate),
      startTime: v.time(b.startTime, "startTime"),
      endTime: v.time(b.endTime, "endTime"),
      attendeeIds: attendees(db, b.attendeeIds ?? [c.get("user").id]),
    };
    const userId = c.get("user").id;
    let created: number[];
    if (b.repeat) {
      if (!FREQS.includes(b.repeat.freq)) throw new HttpError(400, "bad repeat.freq");
      const mask = v.int(b.repeat.weekdaysMask ?? 0, "weekdaysMask", 0, 127, false)!;
      if (b.repeat.freq === "weekly" && mask === 0) throw new HttpError(400, "weekdaysMask required");
      const rule = createEventRule(db, { ...input, freq: b.repeat.freq, weekdaysMask: mask, startDate: date }, userId);
      created = materializeEvents(db, date, addDays(date, 20), rule.id);
      emit(c, "eventRules.changed", listEventRules(db));
    } else {
      created = [createEvent(db, input, userId).id];
    }
    for (const id of created) emit(c, "calendarEvent.upsert", getEvent(db, id));
    logActivity(db, c, "create", "event", created[0] ?? null, `"${title}" etkinliğini ekledi${b.repeat ? " (tekrarlı)" : ""}`);
    return c.json(created.map((id) => getEvent(db, id)), 201);
  });

  app.patch("/calendar-events/:id", async (c) => {
    const id = idParam(c);
    if (!getEvent(db, id)) throw new HttpError(404, "not found");
    const b = await body(c);
    const patch: Record<string, unknown> = {};
    if ("title" in b) {
      patch.title = v.str(b.title, "title", 200);
      if (!patch.title) throw new HttpError(400, "title required");
    }
    if ("note" in b) patch.note = v.str(b.note ?? "", "note", 5000);
    if ("kind" in b) {
      if (!KINDS.includes(b.kind)) throw new HttpError(400, "bad kind");
      patch.kind = b.kind;
    }
    if ("date" in b) {
      const d = v.date(b.date, "date");
      if (!d) throw new HttpError(400, "date required");
      patch.date = d;
    }
    if ("startTime" in b) patch.startTime = v.time(b.startTime, "startTime");
    if ("endTime" in b) patch.endTime = v.time(b.endTime, "endTime");
    if ("endDate" in b) patch.endDate = spanEnd((patch.date as string) ?? getEvent(db, id)!.date, b.endDate);
    if ("status" in b) {
      if (!["planned", "done", "missed"].includes(b.status)) throw new HttpError(400, "bad status");
      patch.status = b.status;
    }
    if ("attendeeIds" in b) patch.attendeeIds = attendees(db, b.attendeeIds);
    const ev = updateEvent(db, id, patch);
    emit(c, "calendarEvent.upsert", ev);
    return c.json(ev);
  });

  app.delete("/calendar-events/:id", (c) => {
    const id = idParam(c);
    const ev = getEvent(db, id);
    if (!ev) throw new HttpError(404, "not found");
    if (ev.ruleId) {
      // Keep the rule from creating it again: mark it missed instead of deleting.
      updateEvent(db, id, { status: "missed" });
      emit(c, "calendarEvent.upsert", getEvent(db, id));
    } else {
      db.prepare("DELETE FROM calendar_events WHERE id = ?").run(id);
      emit(c, "calendarEvent.delete", { id });
    }
    logActivity(db, c, "delete", "event", id, `"${ev.title}" etkinliğini sildi`);
    return c.json({ ok: true });
  });

  // Event rules (series)
  app.get("/event-rules", (c) => c.json(listEventRules(db)));

  const applyRule = (c: C, ruleId: number) => {
    const from = today();
    const { changed, removed } = syncFutureEvents(db, ruleId, from);
    const created = materializeEvents(db, from, addDays(from, 20), ruleId);
    for (const id of removed) emit(c, "calendarEvent.delete", { id });
    for (const id of [...changed, ...created]) emit(c, "calendarEvent.upsert", getEvent(db, id));
    emit(c, "eventRules.changed", listEventRules(db));
  };

  app.patch("/event-rules/:id", async (c) => {
    const id = idParam(c);
    if (!getEventRule(db, id)) throw new HttpError(404, "not found");
    const b = await body(c);
    const cols: Record<string, unknown> = {};
    if ("title" in b) {
      cols.title = v.str(b.title, "title", 200);
      if (!cols.title) throw new HttpError(400, "title required");
    }
    if ("note" in b) cols.note = v.str(b.note ?? "", "note", 5000);
    if ("kind" in b) {
      if (!KINDS.includes(b.kind)) throw new HttpError(400, "bad kind");
      cols.kind = b.kind;
    }
    if ("freq" in b) {
      if (!FREQS.includes(b.freq)) throw new HttpError(400, "bad freq");
      cols.freq = b.freq;
    }
    if ("weekdaysMask" in b) cols.weekdays_mask = v.int(b.weekdaysMask, "weekdaysMask", 0, 127, false);
    if ("startTime" in b) cols.start_time = v.time(b.startTime, "startTime");
    if ("endTime" in b) cols.end_time = v.time(b.endTime, "endTime");
    if ("active" in b) cols.active = b.active ? 1 : 0;
    tx(db, () => {
      const keys = Object.keys(cols);
      if (keys.length)
        db.prepare(`UPDATE event_rules SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...(Object.values(cols) as any[]), id);
      if ("attendeeIds" in b) {
        const list = attendees(db, b.attendeeIds);
        db.prepare("DELETE FROM event_rule_attendees WHERE rule_id = ?").run(id);
        for (const u of list) db.prepare("INSERT INTO event_rule_attendees (rule_id, user_id) VALUES (?, ?)").run(id, u);
      }
    });
    applyRule(c, id);
    return c.json(getEventRule(db, id));
  });

  app.delete("/event-rules/:id", (c) => {
    const id = idParam(c);
    const rule = getEventRule(db, id);
    if (!rule) throw new HttpError(404, "not found");
    db.prepare("UPDATE event_rules SET active = 0, deleted_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    applyRule(c, id);
    logActivity(db, c, "delete", "event", null, `"${rule.title}" etkinlik serisini sildi`);
    return c.json({ ok: true });
  });

  // Tasks that have parts in a date range (weeks outside the open sprints).
  app.get("/calendar", (c) => {
    const { from, to } = range(c);
    return c.json(
      listTasks(
        db,
        "EXISTS (SELECT 1 FROM task_blocks b WHERE b.task_id = t.id AND b.date <= ? AND coalesce(b.end_date, b.date) >= ?) ORDER BY t.id",
        to,
        from,
      ),
    );
  });

  app.get("/busy", (c) => {
    const { from, to } = range(c);
    materializeEvents(db, from, to);
    return c.json(listUsers(db).map((u) => ({ userId: u.id, hours: busyHours(db, u.id, from, to) })));
  });

  // Convert a task into a recurring rule.
  app.post("/tasks/:id/to-recurring", async (c) => {
    const taskId = idParam(c);
    const task = getTask(db, taskId);
    if (!task) throw new HttpError(404, "not found");
    if (task.recurringRuleId) throw new HttpError(409, "task is already recurring");
    const b = await body(c);
    if (!FREQS.includes(b.freq)) throw new HttpError(400, "bad freq");
    const mask = v.int(b.weekdaysMask ?? 0, "weekdaysMask", 0, 127, false)!;
    if (b.freq === "weekly" && mask === 0) throw new HttpError(400, "weekdaysMask required");
    const startTime = "startTime" in b ? v.time(b.startTime, "startTime") : task.startTime;
    const endTime = startTime ? ("endTime" in b ? v.time(b.endTime, "endTime") : task.endTime) : null;
    const assignees = "assigneeIds" in b ? v.ids(b.assigneeIds, "assigneeIds") : task.assigneeIds;
    const defaultSp = "defaultSp" in b ? v.points(b.defaultSp, "defaultSp") : task.sp;
    const ruleLike = { freq: b.freq as RecurringFreq, weekdaysMask: mask };

    const { ruleId, linked } = tx(db, () => {
      const res = db
        .prepare(
          `INSERT INTO recurring_rules (title, description, category_id, freq, weekdays_mask, start_time, end_time, default_sp, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(task.title, task.description, task.categoryId, b.freq, mask, startTime, endTime, defaultSp, c.get("user").id);
      const ruleId = Number(res.lastInsertRowid);
      for (const u of assignees) db.prepare("INSERT INTO recurring_rule_assignees (rule_id, user_id) VALUES (?, ?)").run(ruleId, u);
      // A dated task on a day the rule hits becomes that day's occurrence (one part only).
      const linked =
        !!task.date && task.sprintId !== null && task.blocks.length <= 1 && ruleHitsDay(ruleLike, weekdayIndex(task.date));
      if (linked)
        db.prepare("UPDATE tasks SET recurring_rule_id = ?, occurrence_date = ? WHERE id = ?").run(ruleId, task.date, taskId);
      const from = today();
      const active = getSprintByStatus(db, "active");
      const planned = getSprintByStatus(db, "planned");
      if (active) generateOccurrences(db, active.id, from, ruleId);
      if (planned?.groomedAt) generateOccurrences(db, planned.id, from, ruleId);
      return { ruleId, linked };
    });

    for (const t of listTasks(db, "t.recurring_rule_id = ?", ruleId)) emit(c, "task.upsert", t);
    emit(c, "recurring.changed", listRules(db));
    logActivity(db, c, "create", "recurring", ruleId, `"${shortTitle(task)}" görevini tekrarlayana çevirdi`);
    return c.json({ rule: getRule(db, ruleId), linked }, 201);
  });

  return app;
}
