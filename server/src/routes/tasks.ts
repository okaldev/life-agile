// Task, checklist and comment routes. See openwiki/api.md.
import { Hono } from "hono";
import type { Task } from "../../../shared/types.ts";
import type { AppEnv } from "../auth/auth.ts";
import type { DB } from "../db/db.ts";
import { nowIso, tx } from "../db/db.ts";
import { getTask, getTaskDetail, listTasks, mapChecklist, mapComment, setAssignees } from "../db/repo.ts";
import { addBlock, deleteBlock, followTaskStatus, getBlock, setBlockStatus, updateBlockTime } from "../domain/blocks.ts";
import { diffTask, listHistory, recordHistory } from "../domain/history.ts";
import { settleDoneTask } from "../domain/sprint.ts";
import { hooks } from "../hooks.ts";
import { body, emit, HttpError, idParam, logActivity, shortTitle, spanEnd, v } from "./common.ts";

/** New tasks start with "Düşük" (low) priority. */
export const DEFAULT_PRIORITY = 1;

const STATUS_TR: Record<string, string> = { todo: "Yapılacak", in_progress: "Devam ediyor", done: "Tamamlandı" };

function validUsers(db: DB, ids: number[]): number[] {
  const known = new Set((db.prepare("SELECT id FROM users").all() as { id: number }[]).map((r) => r.id));
  if (ids.length === 0 || ids.some((i) => !known.has(i))) throw new HttpError(400, "assigneeIds invalid");
  return ids;
}

function activeSprintId(db: DB): number | null {
  const r = db.prepare("SELECT id FROM sprints WHERE status = 'active' ORDER BY id DESC LIMIT 1").get() as { id: number } | undefined;
  return r?.id ?? null;
}

function nextBacklogRank(db: DB): number {
  const r = db.prepare("SELECT coalesce(max(backlog_rank), 0) + 1 AS r FROM tasks WHERE sprint_id IS NULL").get() as {
    r: number;
  };
  return r.r;
}

/** Maps a partial request body to column updates. */
function columnsFrom(b: Record<string, any>): Record<string, unknown> {
  const cols: Record<string, unknown> = {};
  if ("title" in b) {
    const t = v.str(b.title, "title", 200);
    if (!t) throw new HttpError(400, "title required");
    cols.title = t;
  }
  if ("description" in b) cols.description = v.str(b.description ?? "", "description", 20000);
  if ("categoryId" in b) cols.category_id = v.int(b.categoryId, "categoryId", 1, 1e9);
  if ("sprintId" in b) cols.sprint_id = v.int(b.sprintId, "sprintId", 1, 1e9);
  if ("status" in b) {
    if (!["todo", "in_progress", "done"].includes(b.status)) throw new HttpError(400, "bad status");
    cols.status = b.status;
  }
  if ("sp" in b) cols.points = v.points(b.sp, "sp");
  if ("priority" in b) cols.priority = v.int(b.priority, "priority", 0, 3, false);
  if ("dueDate" in b) cols.due_date = v.date(b.dueDate, "dueDate");
  if ("date" in b) cols.date = v.date(b.date, "date");
  if ("startTime" in b) cols.start_time = v.time(b.startTime, "startTime");
  if ("endTime" in b) cols.end_time = v.time(b.endTime, "endTime");
  if ("unplanned" in b) cols.unplanned_at = b.unplanned ? nowIso() : null;
  if ("cancelled" in b) cols.cancelled_at = b.cancelled ? nowIso() : null;
  if ("progressManual" in b) cols.progress_manual = v.int(b.progressManual, "progressManual", 0, 100);
  if ("backlogRank" in b) {
    if (typeof b.backlogRank !== "number") throw new HttpError(400, "bad backlogRank");
    cols.backlog_rank = b.backlogRank;
  }
  return cols;
}

type Schedule = { date?: string | null; endDate?: string | null; startTime?: string | null; endTime?: string | null };

/**
 * Takes date/start/end out of the column updates. Since schema v2 they live in task_blocks;
 * the task columns are only a cache of the first part (domain/blocks.ts syncTaskSchedule).
 */
function takeSchedule(cols: Record<string, unknown>): Schedule | null {
  const s: Schedule = {};
  let any = false;
  for (const [col, key] of [["date", "date"], ["start_time", "startTime"], ["end_time", "endTime"]] as const) {
    if (col in cols) {
      s[key] = cols[col] as string | null;
      delete cols[col];
      any = true;
    }
  }
  return any ? s : null;
}

/** Applies a single-part schedule change (old API shape). Tasks with several parts must use the part routes. */
function applySchedule(db: DB, task: Task, s: Schedule): void {
  const blocks = task.blocks;
  if (blocks.length > 1) throw new HttpError(409, "task has several calendar parts");
  const date = s.date !== undefined ? s.date : (blocks[0]?.date ?? null);
  if (!date) {
    if (blocks[0]) deleteBlock(db, blocks[0].id);
    return;
  }
  if (blocks[0]) updateBlockTime(db, blocks[0].id, { date, startTime: s.startTime, endTime: s.endTime });
  else
    addBlock(db, task.id, {
      date,
      startTime: s.startTime ?? null,
      endTime: s.endTime ?? null,
      status: task.status === "done" ? "done" : "planned",
    });
}

/** Sets started_at / done_at on status change. */
function normalize(prev: Task | null, cols: Record<string, unknown>): void {
  if ("status" in cols && cols.status !== prev?.status) {
    if (cols.status === "in_progress" && !prev?.startedAt) cols.started_at = nowIso();
    cols.done_at = cols.status === "done" ? nowIso() : null;
    // Working on a cancelled task again brings it back.
    if (prev?.cancelledAt && !("cancelled_at" in cols)) cols.cancelled_at = null;
  }
  // A done task cannot be cancelled (openwiki/requirements.md, Tasks).
  if (cols.cancelled_at && (cols.status ?? prev?.status) === "done") throw new HttpError(400, "a done task cannot be cancelled");
}

export function taskRoutes(db: DB): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/tasks", (c) => {
    if (c.req.query("backlog")) return c.json(listTasks(db, "t.sprint_id IS NULL ORDER BY t.backlog_rank, t.id"));
    const sprintId = Number(c.req.query("sprintId"));
    if (!sprintId) throw new HttpError(400, "sprintId or backlog required");
    return c.json(listTasks(db, "t.sprint_id = ? ORDER BY t.id", sprintId));
  });

  app.get("/tasks/:id/history", (c) => {
    const id = idParam(c);
    if (!getTask(db, id)) throw new HttpError(404, "not found");
    return c.json(listHistory(db, id));
  });

  app.get("/tasks/:id", (c) => {
    const t = getTaskDetail(db, idParam(c));
    if (!t) throw new HttpError(404, "not found");
    return c.json(t);
  });

  app.post("/tasks", async (c) => {
    const b = await body(c);
    const user = c.get("user");
    if (!("title" in b)) throw new HttpError(400, "title required");
    const cols = columnsFrom(b);
    const assignees = validUsers(db, v.ids(b.assigneeIds ?? [user.id], "assigneeIds"));
    const schedule = takeSchedule(cols);
    normalize(null, cols);
    if (!cols.sprint_id && !("backlog_rank" in cols)) cols.backlog_rank = nextBacklogRank(db);
    if (!("priority" in cols)) cols.priority = DEFAULT_PRIORITY;
    if (!("unplanned_at" in cols) && cols.sprint_id && cols.sprint_id === activeSprintId(db)) cols.unplanned_at = nowIso();
    const now = nowIso();
    Object.assign(cols, { created_by: user.id, created_at: now, updated_at: now });
    const keys = Object.keys(cols);
    const id = tx(db, () => {
      const res = db
        .prepare(`INSERT INTO tasks (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
        .run(...(Object.values(cols) as any[]));
      const id = Number(res.lastInsertRowid);
      setAssignees(db, id, assignees);
      if (schedule?.date) {
        applySchedule(db, getTask(db, id)!, schedule);
        // New task over several days: its one part spans them (no times).
        const endDate = spanEnd(schedule.date, b.endDate);
        if (endDate) {
          const part = getTask(db, id)!.blocks[0];
          if (part) updateBlockTime(db, part.id, { endDate, startTime: null, endTime: null });
        }
      }
      return id;
    });
    const task = getTask(db, id)!;
    recordHistory(db, id, user.id, [{ field: "created", oldValue: null, newValue: null }]);
    emit(c, "task.upsert", task);
    logActivity(db, c, "create", "task", id, `"${shortTitle(task)}" görevini oluşturdu`);
    hooks.onAssigned(task, user.id, task.assigneeIds);
    return c.json(task, 201);
  });

  app.patch("/tasks/:id", async (c) => {
    const id = idParam(c);
    const prev = getTask(db, id);
    if (!prev) throw new HttpError(404, "not found");
    const b = await body(c);
    const cols = columnsFrom(b);
    const schedule = takeSchedule(cols);
    if (schedule && prev.blocks.length > 1) throw new HttpError(409, "task has several calendar parts");
    normalize(prev, cols);
    if ("sprint_id" in cols && cols.sprint_id === null && prev.sprintId !== null && !("backlog_rank" in cols))
      cols.backlog_rank = nextBacklogRank(db);
    // Moving into the running sprint is unplanned work; leaving it clears the mark.
    if ("sprint_id" in cols && cols.sprint_id !== prev.sprintId && !("unplanned_at" in cols))
      cols.unplanned_at = cols.sprint_id && cols.sprint_id === activeSprintId(db) ? nowIso() : null;
    const assignees = "assigneeIds" in b ? validUsers(db, v.ids(b.assigneeIds, "assigneeIds")) : null;
    cols.updated_at = nowIso();
    tx(db, () => {
      const keys = Object.keys(cols);
      db.prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(
        ...(Object.values(cols) as any[]),
        id,
      );
      if (assignees) setAssignees(db, id, assignees);
      if (schedule) applySchedule(db, getTask(db, id)!, schedule);
      if ("status" in cols && cols.status !== prev.status) followTaskStatus(db, id, cols.status as string);
      settleDoneTask(db, id);
    });
    const task = getTask(db, id)!;
    recordHistory(db, id, c.get("user").id, diffTask(prev, task));
    emit(c, "task.upsert", task);
    if (!!prev.cancelledAt !== !!task.cancelledAt)
      logActivity(db, c, "cancel", "task", id, `"${shortTitle(task)}" ${task.cancelledAt ? "görevini iptal etti" : "görevinin iptalini geri aldı"}`);
    else if (prev.status !== task.status)
      logActivity(db, c, "status", "task", id, `"${shortTitle(task)}" → ${STATUS_TR[task.status]}`);
    else if (prev.sprintId !== task.sprintId)
      logActivity(db, c, "move", "task", id, `"${shortTitle(task)}" ${task.sprintId ? "sprinte" : "backloga"} taşıdı`);
    if (assignees) {
      const added = assignees.filter((u) => !prev.assigneeIds.includes(u));
      if (added.length) hooks.onAssigned(task, c.get("user").id, added);
    }
    return c.json(task);
  });

  app.delete("/tasks/:id", (c) => {
    const id = idParam(c);
    const prev = getTask(db, id);
    if (!prev) throw new HttpError(404, "not found");
    db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    emit(c, "task.delete", { id });
    logActivity(db, c, "delete", "task", id, `"${shortTitle(prev)}" görevini sildi`);
    return c.json({ ok: true });
  });

  app.post("/backlog/reorder", async (c) => {
    const ids = v.ids((await body(c)).ids, "ids");
    tx(db, () => {
      const upd = db.prepare("UPDATE tasks SET backlog_rank = ? WHERE id = ? AND sprint_id IS NULL");
      ids.forEach((id, i) => upd.run(i + 1, id));
    });
    const tasks = listTasks(db, "t.sprint_id IS NULL");
    for (const t of tasks) if (ids.includes(t.id)) emit(c, "task.upsert", t);
    return c.json({ ok: true });
  });

  // Calendar parts (blocks)
  app.post("/tasks/:id/blocks", async (c) => {
    const taskId = idParam(c);
    const task = getTask(db, taskId);
    if (!task) throw new HttpError(404, "not found");
    const b = await body(c);
    const date = v.date(b.date, "date");
    if (!date) throw new HttpError(400, "date required");
    const block = addBlock(db, taskId, {
      date,
      endDate: spanEnd(date, b.endDate),
      startTime: v.time(b.startTime, "startTime"),
      endTime: v.time(b.endTime, "endTime"),
    });
    recordHistory(db, taskId, c.get("user").id, [
      { field: "part.add", oldValue: null, newValue: { date: block.date, startTime: block.startTime, endTime: block.endTime } },
    ]);
    const updated = getTask(db, taskId)!;
    emit(c, "task.upsert", updated);
    if (task.blocks.length >= 1) logActivity(db, c, "split", "task", taskId, `"${shortTitle(task)}" görevine takvim parçası ekledi`);
    return c.json(block, 201);
  });

  app.patch("/blocks/:id", async (c) => {
    const id = idParam(c);
    const prev = getBlock(db, id);
    if (!prev) throw new HttpError(404, "not found");
    const taskBefore = getTask(db, prev.taskId)!;
    const b = await body(c);
    const time: Schedule = {};
    if ("date" in b) {
      const d = v.date(b.date, "date");
      if (!d) throw new HttpError(400, "date required");
      time.date = d;
    }
    if ("startTime" in b) time.startTime = v.time(b.startTime, "startTime");
    if ("endTime" in b) time.endTime = v.time(b.endTime, "endTime");
    if ("endDate" in b) time.endDate = spanEnd((time.date as string) ?? prev.date, b.endDate);
    tx(db, () => {
      if (Object.keys(time).length) updateBlockTime(db, id, time as { date?: string; endDate?: string | null; startTime?: string | null; endTime?: string | null });
      if ("status" in b) {
        if (!["planned", "done", "missed"].includes(b.status)) throw new HttpError(400, "bad status");
        setBlockStatus(db, id, b.status);
        settleDoneTask(db, prev.taskId);
      }
    });
    const task = getTask(db, prev.taskId)!;
    const after = getBlock(db, id)!;
    const partChanges = [];
    if (after.status !== prev.status)
      partChanges.push({ field: "part.status", oldValue: { date: prev.date, status: prev.status }, newValue: { date: after.date, status: after.status } });
    if (after.date !== prev.date || after.startTime !== prev.startTime || after.endTime !== prev.endTime)
      partChanges.push({
        field: "part.move",
        oldValue: { date: prev.date, startTime: prev.startTime, endTime: prev.endTime },
        newValue: { date: after.date, startTime: after.startTime, endTime: after.endTime },
      });
    recordHistory(db, task.id, c.get("user").id, [...partChanges, ...diffTask(taskBefore, task).filter((x) => x.field !== "progressManual")]);
    emit(c, "task.upsert", task);
    if ("status" in b && b.status !== prev.status && b.status !== "planned")
      logActivity(db, c, "mark", "task", task.id, `"${shortTitle(task)}" ${b.status === "done" ? "yapıldı" : "yapılmadı"} olarak işaretledi`);
    return c.json(getBlock(db, id));
  });

  app.delete("/blocks/:id", (c) => {
    const before = getBlock(db, idParam(c));
    const taskId = deleteBlock(db, idParam(c));
    if (taskId === null || !before) throw new HttpError(404, "not found");
    recordHistory(db, taskId, c.get("user").id, [
      { field: "part.remove", oldValue: { date: before.date, startTime: before.startTime, endTime: before.endTime }, newValue: null },
    ]);
    emit(c, "task.upsert", getTask(db, taskId)!);
    return c.json({ ok: true });
  });

  // Checklist
  const touch = (c: any, taskId: number) => {
    db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(nowIso(), taskId);
    const t = getTask(db, taskId);
    if (t) emit(c, "task.upsert", t);
  };

  app.post("/tasks/:id/checklist", async (c) => {
    const taskId = idParam(c);
    if (!getTask(db, taskId)) throw new HttpError(404, "not found");
    const text = v.str((await body(c)).text, "text", 500);
    if (!text) throw new HttpError(400, "text required");
    const res = db
      .prepare(
        `INSERT INTO checklist_items (task_id, text, rank)
         VALUES (?, ?, (SELECT coalesce(max(rank), 0) + 1 FROM checklist_items WHERE task_id = ?))`,
      )
      .run(taskId, text, taskId);
    recordHistory(db, taskId, c.get("user").id, [{ field: "checklist.add", oldValue: null, newValue: text }]);
    touch(c, taskId);
    return c.json(mapChecklist(db.prepare("SELECT * FROM checklist_items WHERE id = ?").get(res.lastInsertRowid) as any), 201);
  });

  app.patch("/checklist/:id", async (c) => {
    const id = idParam(c);
    const row = db.prepare("SELECT * FROM checklist_items WHERE id = ?").get(id) as any;
    if (!row) throw new HttpError(404, "not found");
    const b = await body(c);
    if ("text" in b) db.prepare("UPDATE checklist_items SET text = ? WHERE id = ?").run(v.str(b.text, "text", 500), id);
    if ("done" in b && !!b.done !== !!row.done) {
      db.prepare("UPDATE checklist_items SET done = ? WHERE id = ?").run(b.done ? 1 : 0, id);
      recordHistory(db, row.task_id, c.get("user").id, [{ field: "checklist.done", oldValue: !!row.done, newValue: { text: row.text, done: !!b.done } }]);
    }
    touch(c, row.task_id);
    return c.json(mapChecklist(db.prepare("SELECT * FROM checklist_items WHERE id = ?").get(id) as any));
  });

  app.delete("/checklist/:id", (c) => {
    const id = idParam(c);
    const row = db.prepare("SELECT * FROM checklist_items WHERE id = ?").get(id) as any;
    if (!row) throw new HttpError(404, "not found");
    db.prepare("DELETE FROM checklist_items WHERE id = ?").run(id);
    touch(c, row.task_id);
    return c.json({ ok: true });
  });

  // Comments
  app.post("/tasks/:id/comments", async (c) => {
    const taskId = idParam(c);
    const task = getTask(db, taskId);
    if (!task) throw new HttpError(404, "not found");
    const text = v.str((await body(c)).body, "body", 5000);
    if (!text) throw new HttpError(400, "body required");
    const res = db.prepare("INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)").run(taskId, c.get("user").id, text);
    recordHistory(db, taskId, c.get("user").id, [{ field: "comment", oldValue: null, newValue: null }]);
    touch(c, taskId);
    logActivity(db, c, "comment", "task", taskId, `"${shortTitle(task)}" görevine yorum yaptı`);
    return c.json(mapComment(db.prepare("SELECT * FROM comments WHERE id = ?").get(res.lastInsertRowid) as any), 201);
  });

  app.delete("/comments/:id", (c) => {
    const id = idParam(c);
    const row = db.prepare("SELECT * FROM comments WHERE id = ?").get(id) as any;
    if (!row) throw new HttpError(404, "not found");
    if (row.user_id !== c.get("user").id) throw new HttpError(403, "own comments only");
    db.prepare("DELETE FROM comments WHERE id = ?").run(id);
    touch(c, row.task_id);
    return c.json({ ok: true });
  });

  return app;
}
