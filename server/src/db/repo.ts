// Row mappers and common queries.
import type {
  Activity,
  Availability,
  Category,
  ChecklistItem,
  Comment,
  NotificationPrefs,
  RecurringRule,
  RetroItem,
  Sprint,
  SprintMember,
  Task,
  TaskBlock,
  TaskDetail,
  User,
} from "../../../shared/types.ts";
import { computeProgress } from "../domain/blocks.ts";
import type { DB } from "./db.ts";

type Row = Record<string, any>;

const ids = (s: string | null | undefined): number[] =>
  s ? s.split(",").map(Number).sort((a, b) => a - b) : [];

/** Columns for user rows: adds the custom photo version (avatar_v) next to users.*. Use with alias "u". */
export const USER_COLS = "u.*, (SELECT a.updated_at FROM user_avatars a WHERE a.user_id = u.id) AS avatar_v";

/** A custom photo wins over the Google photo. */
export function mapUser(r: Row): User {
  const avatarUrl = r.avatar_v ? `/api/avatars/${r.id}?v=${encodeURIComponent(r.avatar_v)}` : (r.avatar_url ?? null);
  return { id: r.id, email: r.email, name: r.name, avatarUrl, color: r.color, isAdmin: !!r.is_admin };
}

export function mapCategory(r: Row): Category {
  return { id: r.id, name: r.name, color: r.color, archived: !!r.archived };
}

export const TASK_SELECT = `
  SELECT t.*,
    (SELECT group_concat(user_id) FROM task_assignees a WHERE a.task_id = t.id) AS assignee_ids,
    (SELECT count(*) FROM checklist_items c WHERE c.task_id = t.id) AS cl_total,
    (SELECT count(*) FROM checklist_items c WHERE c.task_id = t.id AND c.done = 1) AS cl_done,
    (SELECT count(*) FROM comments m WHERE m.task_id = t.id) AS comment_count,
    (SELECT json_group_array(json_object('id', b.id, 'taskId', b.task_id, 'date', b.date,
        'startTime', b.start_time, 'endTime', b.end_time, 'status', b.status))
     FROM (SELECT * FROM task_blocks WHERE task_id = t.id ORDER BY date, coalesce(start_time, ''), id) b) AS blocks_json
  FROM tasks t`;

export function mapTask(r: Row): Task {
  const blocks: TaskBlock[] = r.blocks_json ? JSON.parse(r.blocks_json) : [];
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    categoryId: r.category_id ?? null,
    sprintId: r.sprint_id ?? null,
    status: r.status,
    sp: r.points ?? null,
    unplannedAt: r.unplanned_at ?? null,
    priority: r.priority,
    dueDate: r.due_date ?? null,
    date: r.date ?? null,
    startTime: r.start_time ?? null,
    endTime: r.end_time ?? null,
    backlogRank: r.backlog_rank,
    recurringRuleId: r.recurring_rule_id ?? null,
    occurrenceDate: r.occurrence_date ?? null,
    carriedFromSprintId: r.carried_from_sprint_id ?? null,
    startedAt: r.started_at ?? null,
    doneAt: r.done_at ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    assigneeIds: ids(r.assignee_ids),
    checklistTotal: r.cl_total ?? 0,
    checklistDone: r.cl_done ?? 0,
    commentCount: r.comment_count ?? 0,
    blocks,
    progressManual: r.progress_manual ?? null,
    missedAt: r.missed_at ?? null,
    progress: computeProgress({
      status: r.status,
      progressManual: r.progress_manual ?? null,
      blocks,
      checklistTotal: r.cl_total ?? 0,
      checklistDone: r.cl_done ?? 0,
    }),
  };
}

export function getTask(db: DB, id: number): Task | null {
  const r = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id) as Row | undefined;
  return r ? mapTask(r) : null;
}

export function listTasks(db: DB, where: string, ...params: any[]): Task[] {
  return (db.prepare(`${TASK_SELECT} WHERE ${where}`).all(...params) as Row[]).map(mapTask);
}

export function getTaskDetail(db: DB, id: number): TaskDetail | null {
  const task = getTask(db, id);
  if (!task) return null;
  const checklist = (
    db.prepare("SELECT * FROM checklist_items WHERE task_id = ? ORDER BY rank, id").all(id) as Row[]
  ).map(mapChecklist);
  const comments = (
    db.prepare("SELECT * FROM comments WHERE task_id = ? ORDER BY created_at, id").all(id) as Row[]
  ).map(mapComment);
  return { ...task, checklist, comments };
}

export function mapChecklist(r: Row): ChecklistItem {
  return { id: r.id, taskId: r.task_id, text: r.text, done: !!r.done, rank: r.rank };
}

export function mapComment(r: Row): Comment {
  return { id: r.id, taskId: r.task_id, userId: r.user_id, body: r.body, createdAt: r.created_at };
}

export function setAssignees(db: DB, taskId: number, userIds: number[]): void {
  db.prepare("DELETE FROM task_assignees WHERE task_id = ?").run(taskId);
  const ins = db.prepare("INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)");
  for (const u of userIds) ins.run(taskId, u);
}

function membersOf(db: DB, sprintId: number): SprintMember[] {
  return (
    db.prepare("SELECT * FROM sprint_members WHERE sprint_id = ? ORDER BY user_id").all(sprintId) as Row[]
  ).map((m) => ({ userId: m.user_id, targetSp: m.target_sp, doneSpSnapshot: m.done_sp_snapshot ?? null }));
}

export function mapSprint(db: DB, r: Row): Sprint {
  return {
    id: r.id,
    number: r.number,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
    goal: r.goal,
    planningStep: r.planning_step ?? null,
    groomedAt: r.groomed_at ?? null,
    scheduledAt: r.scheduled_at ?? null,
    closedAt: r.closed_at ?? null,
    members: membersOf(db, r.id),
  };
}

export function getSprint(db: DB, id: number): Sprint | null {
  const r = db.prepare("SELECT * FROM sprints WHERE id = ?").get(id) as Row | undefined;
  return r ? mapSprint(db, r) : null;
}

export function getSprintByStatus(db: DB, status: "active" | "planned"): Sprint | null {
  const r = db.prepare("SELECT * FROM sprints WHERE status = ? ORDER BY id DESC LIMIT 1").get(status) as
    | Row
    | undefined;
  return r ? mapSprint(db, r) : null;
}

export function listSprints(db: DB): Sprint[] {
  return (db.prepare("SELECT * FROM sprints ORDER BY number").all() as Row[]).map((r) => mapSprint(db, r));
}

export function mapRule(r: Row): RecurringRule {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    categoryId: r.category_id ?? null,
    freq: r.freq,
    weekdaysMask: r.weekdays_mask,
    startTime: r.start_time ?? null,
    endTime: r.end_time ?? null,
    defaultSp: r.default_sp ?? null,
    active: !!r.active,
    assigneeIds: ids(r.assignee_ids),
  };
}

const RULE_SELECT = `
  SELECT r.*, (SELECT group_concat(user_id) FROM recurring_rule_assignees a WHERE a.rule_id = r.id) AS assignee_ids
  FROM recurring_rules r`;

export function listRules(db: DB): RecurringRule[] {
  return (db.prepare(`${RULE_SELECT} WHERE r.deleted_at IS NULL ORDER BY r.id`).all() as Row[]).map(mapRule);
}

export function getRule(db: DB, id: number): RecurringRule | null {
  const r = db.prepare(`${RULE_SELECT} WHERE r.id = ?`).get(id) as Row | undefined;
  return r ? mapRule(r) : null;
}

export function listUsers(db: DB): User[] {
  return (db.prepare(`SELECT ${USER_COLS} FROM users u ORDER BY u.id`).all() as Row[]).map(mapUser);
}

export function listCategories(db: DB): Category[] {
  return (db.prepare("SELECT * FROM categories ORDER BY id").all() as Row[]).map(mapCategory);
}

export function mapRetro(r: Row): RetroItem {
  return { id: r.id, sprintId: r.sprint_id, userId: r.user_id, kind: r.kind, text: r.text, createdAt: r.created_at };
}

export function mapAvailability(r: Row): Availability {
  return { userId: r.user_id, date: r.date, kind: r.kind, note: r.note };
}

export function mapActivity(r: Row): Activity {
  return {
    id: r.id,
    userId: r.user_id ?? null,
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id ?? null,
    summary: r.summary,
    createdAt: r.created_at,
  };
}

export function getPrefs(db: DB, userId: number): NotificationPrefs {
  const r = db.prepare("SELECT * FROM notification_prefs WHERE user_id = ?").get(userId) as Row | undefined;
  return {
    planningReminder: r ? !!r.planning_reminder : true,
    dailySummary: r ? !!r.daily_summary : true,
    taskReminderMin: r ? r.task_reminder_min : 15,
    partnerChanges: r ? !!r.partner_changes : true,
  };
}
