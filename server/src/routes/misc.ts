// Bootstrap, categories, recurring rules, availability, presence and activity routes.
import { Hono } from "hono";
import type { Bootstrap } from "../../../shared/types.ts";
import type { AppEnv } from "../auth/auth.ts";
import type { Config } from "../config.ts";
import type { DB } from "../db/db.ts";
import { tx } from "../db/db.ts";
import {
  getRule,
  getSprintByStatus,
  listCategories,
  listRules,
  listTasks,
  listUsers,
  mapActivity,
  mapAvailability,
} from "../db/repo.ts";
import { generateOccurrences, syncFutureOccurrences } from "../domain/recurrence.ts";
import { timeZone, today } from "../domain/time.ts";
import { listPresence, touchPresence } from "../realtime/hub.ts";
import { body, emit, HttpError, idParam, logActivity, v, type C } from "./common.ts";

export function bootstrap(db: DB, cfg: Config, c: C): Bootstrap {
  const activeSprint = getSprintByStatus(db, "active");
  const plannedSprint = getSprintByStatus(db, "planned");
  const sprintIds = [activeSprint?.id, plannedSprint?.id].filter(Boolean) as number[];
  // Open sprints plus the backlog. Closed sprints load on demand.
  const tasks = listTasks(
    db,
    `t.sprint_id IS NULL OR t.sprint_id IN (${sprintIds.map(() => "?").join(",") || "NULL"}) ORDER BY t.id`,
    ...sprintIds,
  );
  return {
    me: c.get("user"),
    users: listUsers(db),
    categories: listCategories(db),
    activeSprint,
    plannedSprint,
    tasks,
    recurringRules: listRules(db),
    presence: listPresence(),
    vapidPublicKey: cfg.vapidPublicKey || null,
    today: today(),
    timeZone: timeZone(),
    sourceUrl: cfg.sourceUrl,
  };
}

export function miscRoutes(db: DB, cfg: Config): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/me", (c) => c.json(c.get("user")));
  app.get("/bootstrap", (c) => c.json(bootstrap(db, cfg, c)));

  // Categories
  app.get("/categories", (c) => c.json(listCategories(db)));
  app.post("/categories", async (c) => {
    const b = await body(c);
    const name = v.str(b.name, "name", 40);
    if (!name) throw new HttpError(400, "name required");
    const color = v.str(b.color ?? "#64748b", "color", 20);
    db.prepare("INSERT INTO categories (name, color) VALUES (?, ?)").run(name, color);
    emit(c, "category.changed", listCategories(db));
    return c.json(listCategories(db), 201);
  });
  app.patch("/categories/:id", async (c) => {
    const id = idParam(c);
    const b = await body(c);
    if ("name" in b) db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(v.str(b.name, "name", 40), id);
    if ("color" in b) db.prepare("UPDATE categories SET color = ? WHERE id = ?").run(v.str(b.color, "color", 20), id);
    if ("archived" in b) db.prepare("UPDATE categories SET archived = ? WHERE id = ?").run(b.archived ? 1 : 0, id);
    emit(c, "category.changed", listCategories(db));
    return c.json(listCategories(db));
  });

  // Recurring rules
  const ruleCols = (b: Record<string, any>) => {
    const cols: Record<string, unknown> = {};
    if ("title" in b) {
      cols.title = v.str(b.title, "title", 200);
      if (!cols.title) throw new HttpError(400, "title required");
    }
    if ("description" in b) cols.description = v.str(b.description ?? "", "description", 5000);
    if ("categoryId" in b) cols.category_id = v.int(b.categoryId, "categoryId", 1, 1e9);
    if ("freq" in b) {
      if (!["daily", "weekdays", "weekly"].includes(b.freq)) throw new HttpError(400, "bad freq");
      cols.freq = b.freq;
    }
    if ("weekdaysMask" in b) cols.weekdays_mask = v.int(b.weekdaysMask, "weekdaysMask", 0, 127, false);
    if ("startTime" in b) cols.start_time = v.time(b.startTime, "startTime");
    if ("endTime" in b) cols.end_time = v.time(b.endTime, "endTime");
    if ("defaultSp" in b) cols.default_sp = v.points(b.defaultSp, "defaultSp");
    if ("active" in b) cols.active = b.active ? 1 : 0;
    return cols;
  };

  /** Applies a rule change to open sprints: regenerates missing and updates future occurrences. */
  const applyRule = (c: C, ruleId: number) => {
    const from = today();
    const { changed, removed } = syncFutureOccurrences(db, ruleId, from);
    const created: number[] = [];
    const active = getSprintByStatus(db, "active");
    const planned = getSprintByStatus(db, "planned");
    if (active) created.push(...generateOccurrences(db, active.id, from, ruleId));
    if (planned?.groomedAt) created.push(...generateOccurrences(db, planned.id, from, ruleId));
    for (const id of removed) emit(c, "task.delete", { id });
    const ids = [...changed, ...created];
    if (ids.length) for (const t of listTasks(db, `t.id IN (${ids.map(() => "?").join(",")})`, ...ids)) emit(c, "task.upsert", t);
    emit(c, "recurring.changed", listRules(db));
  };

  app.get("/recurring", (c) => c.json(listRules(db)));
  app.post("/recurring", async (c) => {
    const b = await body(c);
    if (!("title" in b) || !("freq" in b)) throw new HttpError(400, "title and freq required");
    const cols = ruleCols(b);
    cols.created_by = c.get("user").id;
    const assignees = v.ids(b.assigneeIds ?? [c.get("user").id], "assigneeIds");
    if (!assignees.length) throw new HttpError(400, "assigneeIds required");
    const id = tx(db, () => {
      const keys = Object.keys(cols);
      const res = db
        .prepare(`INSERT INTO recurring_rules (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
        .run(...(Object.values(cols) as any[]));
      const id = Number(res.lastInsertRowid);
      for (const u of assignees) db.prepare("INSERT INTO recurring_rule_assignees (rule_id, user_id) VALUES (?, ?)").run(id, u);
      return id;
    });
    applyRule(c, id);
    logActivity(db, c, "create", "recurring", id, `"${cols.title}" tekrarlayan görevini ekledi`);
    return c.json(getRule(db, id), 201);
  });
  app.patch("/recurring/:id", async (c) => {
    const id = idParam(c);
    if (!getRule(db, id)) throw new HttpError(404, "not found");
    const b = await body(c);
    const cols = ruleCols(b);
    tx(db, () => {
      const keys = Object.keys(cols);
      if (keys.length)
        db.prepare(`UPDATE recurring_rules SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(
          ...(Object.values(cols) as any[]),
          id,
        );
      if ("assigneeIds" in b) {
        const assignees = v.ids(b.assigneeIds, "assigneeIds");
        if (!assignees.length) throw new HttpError(400, "assigneeIds required");
        db.prepare("DELETE FROM recurring_rule_assignees WHERE rule_id = ?").run(id);
        for (const u of assignees) db.prepare("INSERT INTO recurring_rule_assignees (rule_id, user_id) VALUES (?, ?)").run(id, u);
      }
    });
    applyRule(c, id);
    return c.json(getRule(db, id));
  });
  app.delete("/recurring/:id", (c) => {
    const id = idParam(c);
    const rule = getRule(db, id);
    if (!rule) throw new HttpError(404, "not found");
    db.prepare("UPDATE recurring_rules SET active = 0, deleted_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    applyRule(c, id);
    logActivity(db, c, "delete", "recurring", id, `"${rule.title}" tekrarlayan görevini sildi`);
    return c.json({ ok: true });
  });

  // Availability (leave days)
  app.get("/availability", (c) => {
    const from = v.date(c.req.query("from"), "from") ?? "0000-00-00";
    const to = v.date(c.req.query("to"), "to") ?? "9999-99-99";
    return c.json(
      (db.prepare("SELECT * FROM availability WHERE date BETWEEN ? AND ? ORDER BY date").all(from, to) as any[]).map(
        mapAvailability,
      ),
    );
  });
  app.put("/availability", async (c) => {
    const b = await body(c);
    // Both users plan together, so either one may set the leave days of the other.
    const userId = b.userId === undefined ? c.get("user").id : v.int(b.userId, "userId", 1, 1e9, false)!;
    if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId)) throw new HttpError(400, "unknown user");
    const date = v.date(b.date, "date");
    if (!date) throw new HttpError(400, "date required");
    if (b.kind === null) db.prepare("DELETE FROM availability WHERE user_id = ? AND date = ?").run(userId, date);
    else {
      if (!["off", "half"].includes(b.kind)) throw new HttpError(400, "bad kind");
      db.prepare(
        `INSERT INTO availability (user_id, date, kind, note) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, date) DO UPDATE SET kind = excluded.kind, note = excluded.note`,
      ).run(userId, date, b.kind, v.str(b.note ?? "", "note", 200));
    }
    emit(c, "availability.changed", { userId, date });
    return c.json({ ok: true });
  });

  // Presence and activity
  app.post("/presence", async (c) => {
    const b = await body(c);
    const page = typeof b.page === "string" ? b.page.slice(0, 40) : null;
    const update: { page?: string | null; taskId?: number | null; hover?: string | null } = {};
    if ("page" in b) update.page = page;
    if ("taskId" in b) update.taskId = Number.isInteger(b.taskId) ? b.taskId : null;
    if ("hover" in b) update.hover = typeof b.hover === "string" && /^[a-z]+:\d+$/.test(b.hover) ? b.hover : null;
    return c.json(touchPresence(c.get("user").id, update));
  });
  app.get("/activity", (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
    return c.json((db.prepare("SELECT * FROM activity ORDER BY id DESC LIMIT ?").all(limit) as any[]).map(mapActivity));
  });

  return app;
}
