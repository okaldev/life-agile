// Sprint, planning wizard and retro routes. See openwiki/sprint-flow.md.
import { Hono } from "hono";
import type { PlanningStep } from "../../../shared/types.ts";
import type { AppEnv } from "../auth/auth.ts";
import type { DB } from "../db/db.ts";
import { getSprint, getSprintByStatus, listSprints, listTasks, mapRetro } from "../db/repo.ts";
import { computeMetrics } from "../domain/metrics.ts";
import {
  cancelPlanning,
  finishPlanning,
  PlanningError,
  schedulePlanning,
  setRecurringSp,
  setStep,
  sprintStats,
  startPlanning,
} from "../domain/sprint.ts";
import { body, emit, HttpError, idParam, logActivity, v, type C } from "./common.ts";

const STEP_TR: Record<PlanningStep, string> = {
  retro: "Retro",
  grooming: "Grooming",
  estimation: "Estimation",
  start: "Başlat",
};

export function planningRoutes(db: DB): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** Sends the sprint state and the tasks of both open sprints and the backlog. */
  const broadcastAll = (c: C) => {
    emit(c, "sprint.changed", {
      activeSprint: getSprintByStatus(db, "active"),
      plannedSprint: getSprintByStatus(db, "planned"),
    });
  };

  const wrap = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof PlanningError) throw new HttpError(409, e.message);
      throw e;
    }
  };

  app.get("/sprints", (c) => c.json(listSprints(db).map((s) => sprintStats(db, s))));
  app.get("/metrics", (c) => c.json(computeMetrics(db)));
  app.get("/sprints/:id/tasks", (c) => c.json(listTasks(db, "t.sprint_id = ? ORDER BY t.id", idParam(c))));

  app.patch("/sprints/:id", async (c) => {
    const id = idParam(c);
    if (!getSprint(db, id)) throw new HttpError(404, "not found");
    const b = await body(c);
    if ("goal" in b) db.prepare("UPDATE sprints SET goal = ? WHERE id = ?").run(v.str(b.goal, "goal", 300), id);
    broadcastAll(c);
    return c.json(getSprint(db, id));
  });

  app.put("/sprints/:id/members/:userId", async (c) => {
    const id = idParam(c);
    const userId = idParam(c, "userId");
    const target = v.int((await body(c)).targetSp, "targetSp", 0, 500, false)!;
    const res = db
      .prepare("UPDATE sprint_members SET target_sp = ? WHERE sprint_id = ? AND user_id = ?")
      .run(target, id, userId);
    if (res.changes === 0) throw new HttpError(404, "not found");
    broadcastAll(c);
    return c.json(getSprint(db, id));
  });

  app.post("/planning/start", (c) => {
    const had = getSprintByStatus(db, "planned");
    const sprint = wrap(() => startPlanning(db));
    if (!had) logActivity(db, c, "planning", "sprint", sprint.id, `Sprint ${sprint.number} planlamasını başlattı`);
    broadcastAll(c);
    emit(c, "planning.changed", { refresh: true });
    return c.json(sprint);
  });

  app.post("/planning/step", async (c) => {
    const step = (await body(c)).step as PlanningStep;
    const sprint = wrap(() => setStep(db, step));
    broadcastAll(c);
    emit(c, "planning.changed", { refresh: true });
    logActivity(db, c, "planning", "sprint", sprint.id, `Planlama: ${STEP_TR[step]} adımına geçti`);
    return c.json(sprint);
  });

  app.post("/planning/recurring-sp", async (c) => {
    const b = await body(c);
    const planned = getSprintByStatus(db, "planned");
    if (!planned) throw new HttpError(409, "no planning session");
    const ruleId = v.int(b.ruleId, "ruleId", 1, 1e9, false)!;
    const sp = v.points(b.sp, "sp");
    const ids = setRecurringSp(db, planned.id, ruleId, sp);
    for (const t of listTasks(db, `t.id IN (${ids.map(() => "?").join(",") || "NULL"})`, ...ids))
      emit(c, "task.upsert", t);
    emit(c, "recurring.changed", { refresh: true });
    return c.json({ ok: true });
  });

  app.post("/planning/cancel", (c) => {
    cancelPlanning(db);
    broadcastAll(c);
    emit(c, "planning.changed", { refresh: true });
    logActivity(db, c, "planning", "sprint", null, "Planlamayı iptal etti");
    return c.json({ ok: true });
  });

  app.post("/planning/schedule", (c) => {
    const sprint = wrap(() => schedulePlanning(db));
    broadcastAll(c);
    emit(c, "planning.changed", { refresh: true });
    logActivity(db, c, "planning", "sprint", sprint.id, `Sprint ${sprint.number} planlandı, ${sprint.startDate} 00:00'da başlayacak`);
    return c.json(sprint);
  });

  app.post("/planning/finish", (c) => {
    const sprint = wrap(() => finishPlanning(db));
    broadcastAll(c);
    emit(c, "planning.changed", { refresh: true });
    logActivity(db, c, "planning", "sprint", sprint.id, `Sprint ${sprint.number} başladı`);
    return c.json(sprint);
  });

  app.get("/retro/:sprintId", (c) => {
    const id = idParam(c, "sprintId");
    return c.json(
      (db.prepare("SELECT * FROM retro_items WHERE sprint_id = ? ORDER BY id").all(id) as any[]).map(mapRetro),
    );
  });

  /** Links an action to the task made from it ({taskId} or null). */
  app.patch("/retro/items/:id", async (c) => {
    const id = idParam(c);
    const b = await body(c);
    const taskId = v.int(b.taskId, "taskId", 1, 1e9);
    if (taskId && !db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(taskId)) throw new HttpError(400, "unknown task");
    if (!db.prepare("UPDATE retro_items SET task_id = ? WHERE id = ?").run(taskId, id).changes) throw new HttpError(404, "not found");
    const item = mapRetro(db.prepare("SELECT * FROM retro_items WHERE id = ?").get(id) as any);
    emit(c, "retro.upsert", item);
    return c.json(item);
  });

  app.post("/retro/:sprintId", async (c) => {
    const sprintId = idParam(c, "sprintId");
    if (!getSprint(db, sprintId)) throw new HttpError(404, "not found");
    const b = await body(c);
    if (!["good", "bad", "try"].includes(b.kind)) throw new HttpError(400, "bad kind");
    const text = v.str(b.text, "text", 1000);
    if (!text) throw new HttpError(400, "text required");
    const res = db
      .prepare("INSERT INTO retro_items (sprint_id, user_id, kind, text) VALUES (?, ?, ?, ?)")
      .run(sprintId, c.get("user").id, b.kind, text);
    const item = mapRetro(db.prepare("SELECT * FROM retro_items WHERE id = ?").get(res.lastInsertRowid) as any);
    emit(c, "retro.upsert", item);
    return c.json(item, 201);
  });

  app.delete("/retro/items/:id", (c) => {
    const id = idParam(c);
    db.prepare("DELETE FROM retro_items WHERE id = ?").run(id);
    emit(c, "retro.delete", { id });
    return c.json({ ok: true });
  });

  return app;
}
