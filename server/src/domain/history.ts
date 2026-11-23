// Per-task change history (task_history). The global activity feed stays short; this keeps every field change.
import type { Task, TaskHistoryEntry } from "../../../shared/types.ts";
import type { DB } from "../db/db.ts";

type Row = Record<string, any>;

/** Task fields that are recorded when they change, with the DTO key used for the value. */
const FIELDS: (keyof Task)[] = [
  "title",
  "description",
  "status",
  "sp",
  "priority",
  "categoryId",
  "sprintId",
  "dueDate",
  "assigneeIds",
  "progressManual",
  "unplannedAt",
  "missedAt",
  "cancelledAt",
];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface Change {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

/** Field changes between two versions of a task. unplannedAt/missedAt/cancelledAt are stored as booleans. */
export function diffTask(prev: Task, next: Task): Change[] {
  const out: Change[] = [];
  for (const f of FIELDS) {
    let a: unknown = prev[f];
    let b: unknown = next[f];
    if (f === "unplannedAt" || f === "missedAt" || f === "cancelledAt") {
      a = !!a;
      b = !!b;
    }
    if (f === "assigneeIds") {
      a = [...(a as number[])].sort();
      b = [...(b as number[])].sort();
    }
    // Long text: keep only that it changed.
    if (f === "description" && !same(a, b)) {
      out.push({ field: f, oldValue: null, newValue: null });
      continue;
    }
    if (!same(a, b)) out.push({ field: f, oldValue: a ?? null, newValue: b ?? null });
  }
  return out;
}

export function recordHistory(db: DB, taskId: number, userId: number | null, changes: Change[]): void {
  const ins = db.prepare(
    "INSERT INTO task_history (task_id, user_id, field, old_value, new_value) VALUES (?, ?, ?, ?, ?)",
  );
  for (const c of changes)
    ins.run(taskId, userId, c.field, JSON.stringify(c.oldValue ?? null), JSON.stringify(c.newValue ?? null));
}

export function listHistory(db: DB, taskId: number): TaskHistoryEntry[] {
  const rows = (
    db.prepare("SELECT * FROM task_history WHERE task_id = ? ORDER BY id DESC").all(taskId) as Row[]
  ).map((r) => ({
    id: r.id,
    taskId: r.task_id,
    userId: r.user_id ?? null,
    field: r.field,
    oldValue: JSON.parse(r.old_value ?? "null"),
    newValue: JSON.parse(r.new_value ?? "null"),
    createdAt: r.created_at,
  }));
  // Tasks created before the history existed: add the creation as the first entry.
  if (!rows.some((r) => r.field === "created")) {
    const t = db.prepare("SELECT created_by, created_at FROM tasks WHERE id = ?").get(taskId) as Row | undefined;
    if (t) rows.push({ id: 0, taskId, userId: t.created_by ?? null, field: "created", oldValue: null, newValue: null, createdAt: t.created_at });
  }
  return rows;
}
