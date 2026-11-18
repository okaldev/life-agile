// Task calendar parts (blocks), progress and done/missed marks. See openwiki/calendar.md.
import type { MarkStatus, TaskBlock } from "../../../shared/types.ts";
import type { DB } from "../db/db.ts";
import { nowIso, tx } from "../db/db.ts";

type Row = Record<string, any>;

export const UNTIMED_MINUTES = 60;

export function mapBlock(r: Row): TaskBlock {
  return {
    id: r.id,
    taskId: r.task_id,
    date: r.date,
    startTime: r.start_time ?? null,
    endTime: r.end_time ?? null,
    status: r.status,
  };
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Planned length of a part in minutes. A part without time, or without an end, counts as one hour. */
export function blockMinutes(b: Pick<TaskBlock, "startTime" | "endTime">): number {
  if (!b.startTime || !b.endTime) return UNTIMED_MINUTES;
  return Math.max(15, toMin(b.endTime) - toMin(b.startTime));
}

/**
 * Task progress 0-100:
 * done task = 100; else the manual value; else done part minutes / all part minutes
 * (missed parts stay in the total); else the checklist ratio; else 0.
 */
export function computeProgress(input: {
  status: string;
  progressManual: number | null;
  blocks: Pick<TaskBlock, "startTime" | "endTime" | "status">[];
  checklistTotal: number;
  checklistDone: number;
}): number {
  if (input.status === "done") return 100;
  if (input.progressManual != null) return input.progressManual;
  if (input.blocks.length > 0) {
    const total = input.blocks.reduce((s, b) => s + blockMinutes(b), 0);
    const done = input.blocks.filter((b) => b.status === "done").reduce((s, b) => s + blockMinutes(b), 0);
    return Math.round((done / total) * 100);
  }
  if (input.checklistTotal > 0) return Math.round((input.checklistDone / input.checklistTotal) * 100);
  return 0;
}

export function listBlocks(db: DB, taskId: number): TaskBlock[] {
  return (
    db
      .prepare("SELECT * FROM task_blocks WHERE task_id = ? ORDER BY date, coalesce(start_time, ''), id")
      .all(taskId) as Row[]
  ).map(mapBlock);
}

export function getBlock(db: DB, id: number): TaskBlock | null {
  const r = db.prepare("SELECT * FROM task_blocks WHERE id = ?").get(id) as Row | undefined;
  return r ? mapBlock(r) : null;
}

/** Writes the first part's date and time into the task cache columns (tasks.date/start_time/end_time). */
export function syncTaskSchedule(db: DB, taskId: number): void {
  const first = listBlocks(db, taskId)[0];
  db.prepare("UPDATE tasks SET date = ?, start_time = ?, end_time = ? WHERE id = ?").run(
    first?.date ?? null,
    first?.startTime ?? null,
    first?.endTime ?? null,
    taskId,
  );
}

/** Drops a start without an end check: end needs start, end must be after start. */
export function cleanTimes(start: string | null, end: string | null): { start: string | null; end: string | null } {
  if (!start) return { start: null, end: null };
  if (end && end <= start) return { start, end: null };
  return { start, end };
}

export function addBlock(
  db: DB,
  taskId: number,
  b: { date: string; startTime: string | null; endTime: string | null; status?: MarkStatus },
): TaskBlock {
  const { start, end } = cleanTimes(b.startTime, b.endTime);
  const now = nowIso();
  return tx(db, () => {
    const res = db
      .prepare(
        `INSERT INTO task_blocks (task_id, date, start_time, end_time, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(taskId, b.date, start, end, b.status ?? "planned", now, now);
    syncTaskSchedule(db, taskId);
    db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(now, taskId);
    return getBlock(db, Number(res.lastInsertRowid))!;
  });
}

export function updateBlockTime(
  db: DB,
  id: number,
  patch: { date?: string; startTime?: string | null; endTime?: string | null },
): TaskBlock | null {
  const prev = getBlock(db, id);
  if (!prev) return null;
  const date = patch.date ?? prev.date;
  const { start, end } = cleanTimes(
    patch.startTime !== undefined ? patch.startTime : prev.startTime,
    patch.endTime !== undefined ? patch.endTime : prev.endTime,
  );
  const now = nowIso();
  tx(db, () => {
    db.prepare("UPDATE task_blocks SET date = ?, start_time = ?, end_time = ?, updated_at = ? WHERE id = ?").run(
      date,
      start,
      end,
      now,
      id,
    );
    syncTaskSchedule(db, prev.taskId);
    db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(now, prev.taskId);
  });
  return getBlock(db, id);
}

export function deleteBlock(db: DB, id: number): number | null {
  const prev = getBlock(db, id);
  if (!prev) return null;
  tx(db, () => {
    db.prepare("DELETE FROM task_blocks WHERE id = ?").run(id);
    syncTaskSchedule(db, prev.taskId);
    db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(nowIso(), prev.taskId);
  });
  return prev.taskId;
}

/**
 * Marks a part done / missed / planned.
 * A task with exactly one part follows its part: done -> task done, missed -> task missed_at, planned -> clear.
 */
export function setBlockStatus(db: DB, id: number, status: MarkStatus): TaskBlock | null {
  const prev = getBlock(db, id);
  if (!prev) return null;
  const now = nowIso();
  tx(db, () => {
    db.prepare("UPDATE task_blocks SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
    const count = (db.prepare("SELECT count(*) AS n FROM task_blocks WHERE task_id = ?").get(prev.taskId) as { n: number }).n;
    const task = db.prepare("SELECT status, started_at FROM tasks WHERE id = ?").get(prev.taskId) as Row;
    if (count === 1) {
      if (status === "done")
        db.prepare("UPDATE tasks SET status = 'done', done_at = ?, missed_at = NULL WHERE id = ?").run(now, prev.taskId);
      else if (status === "missed")
        db.prepare(
          "UPDATE tasks SET missed_at = ?, status = CASE status WHEN 'done' THEN 'todo' ELSE status END, done_at = NULL WHERE id = ?",
        ).run(now, prev.taskId);
      else
        db.prepare(
          "UPDATE tasks SET missed_at = NULL, status = CASE status WHEN 'done' THEN 'todo' ELSE status END, done_at = NULL WHERE id = ?",
        ).run(prev.taskId);
    } else if (status === "done" && task.status === "todo" && !task.started_at) {
      // Work started on a split task: mark it in progress for the estimate accuracy metric.
      db.prepare("UPDATE tasks SET status = 'in_progress', started_at = ? WHERE id = ?").run(now, prev.taskId);
    }
    db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(now, prev.taskId);
  });
  return getBlock(db, id);
}

/** Keeps the only part in step when the task status changes on the board. */
export function followTaskStatus(db: DB, taskId: number, status: string): void {
  const blocks = listBlocks(db, taskId);
  if (blocks.length !== 1) return;
  const b = blocks[0];
  if (status === "done" && b.status !== "done")
    db.prepare("UPDATE task_blocks SET status = 'done', updated_at = ? WHERE id = ?").run(nowIso(), b.id);
  if (status !== "done" && b.status === "done")
    db.prepare("UPDATE task_blocks SET status = 'planned', updated_at = ? WHERE id = ?").run(nowIso(), b.id);
  if (status === "done") db.prepare("UPDATE tasks SET missed_at = NULL WHERE id = ?").run(taskId);
}
