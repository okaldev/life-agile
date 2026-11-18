// DTO types shared by the server and the web client.

export type TaskStatus = "todo" | "in_progress" | "done";
export type SprintStatus = "planned" | "active" | "closed";
export type PlanningStep = "retro" | "grooming" | "estimation" | "start";
export type RecurringFreq = "daily" | "weekdays" | "weekly";
export type RetroKind = "good" | "bad" | "try";
export type AvailabilityKind = "off" | "half";
export type MarkStatus = "planned" | "done" | "missed";
export type EventKind = "meet" | "guest" | "out" | "busy" | "other";

/** One calendar part of a task. A task can have many parts. */
export interface TaskBlock {
  id: number;
  taskId: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: MarkStatus;
}

export interface CalendarEvent {
  id: number;
  title: string;
  note: string;
  kind: EventKind;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: MarkStatus;
  ruleId: number | null;
  attendeeIds: number[];
  updatedAt: string;
}

export interface EventRule {
  id: number;
  title: string;
  note: string;
  kind: EventKind;
  freq: RecurringFreq;
  weekdaysMask: number;
  startTime: string | null;
  endTime: string | null;
  startDate: string;
  active: boolean;
  attendeeIds: number[];
}

export interface User {
  id: number;
  email: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  isAdmin: boolean;
}

export interface Invite {
  id: number;
  email: string;
  name: string;
  expiresAt: string;
  createdAt: string;
}

export interface Category {
  id: number;
  name: string;
  color: string;
  archived: boolean;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  categoryId: number | null;
  sprintId: number | null;
  status: TaskStatus;
  sp: number | null;
  priority: number;
  dueDate: string | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  backlogRank: number;
  recurringRuleId: number | null;
  occurrenceDate: string | null;
  carriedFromSprintId: number | null;
  startedAt: string | null;
  doneAt: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  assigneeIds: number[];
  checklistTotal: number;
  checklistDone: number;
  commentCount: number;
  /** Calendar parts, ordered by date and time. date/startTime/endTime above mirror the first part. */
  blocks: TaskBlock[];
  /** 0-100. Manual value if set, else computed from parts, checklist or status. */
  progress: number;
  progressManual: number | null;
  missedAt: string | null;
  /** Set when the task was added to an already running sprint (change request). */
  unplannedAt: string | null;
}

/** One change of a task. field: a Task field name, or created / part.add / part.remove / part.status / checklist.add / checklist.done / comment. */
export interface TaskHistoryEntry {
  id: number;
  taskId: number;
  userId: number | null;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}

export interface ChecklistItem {
  id: number;
  taskId: number;
  text: string;
  done: boolean;
  rank: number;
}

export interface Comment {
  id: number;
  taskId: number;
  userId: number;
  body: string;
  createdAt: string;
}

export interface TaskDetail extends Task {
  checklist: ChecklistItem[];
  comments: Comment[];
}

export interface SprintMember {
  userId: number;
  targetSp: number;
  doneSpSnapshot: number | null;
}

export interface Sprint {
  id: number;
  number: number;
  startDate: string;
  endDate: string;
  status: SprintStatus;
  goal: string;
  planningStep: PlanningStep | null;
  groomedAt: string | null;
  closedAt: string | null;
  members: SprintMember[];
}

export interface RecurringRule {
  id: number;
  title: string;
  description: string;
  categoryId: number | null;
  freq: RecurringFreq;
  weekdaysMask: number;
  startTime: string | null;
  endTime: string | null;
  defaultSp: number | null;
  active: boolean;
  assigneeIds: number[];
}

export interface RetroItem {
  id: number;
  sprintId: number;
  userId: number;
  kind: RetroKind;
  text: string;
  createdAt: string;
}

export interface Availability {
  userId: number;
  date: string;
  kind: AvailabilityKind;
  note: string;
}

export interface Presence {
  userId: number;
  page: string | null;
  taskId: number | null;
  /** What the user points at now: "task:12", "event:3" or null. Shared with a short delay. */
  hover: string | null;
  online: boolean;
  at: string;
}

export interface Activity {
  id: number;
  userId: number | null;
  action: string;
  entity: string;
  entityId: number | null;
  summary: string;
  createdAt: string;
}

export interface NotificationPrefs {
  planningReminder: boolean;
  dailySummary: boolean;
  taskReminderMin: number;
  partnerChanges: boolean;
}

export interface Bootstrap {
  me: User;
  users: User[];
  categories: Category[];
  activeSprint: Sprint | null;
  plannedSprint: Sprint | null;
  tasks: Task[];
  recurringRules: RecurringRule[];
  presence: Presence[];
  vapidPublicKey: string | null;
  today: string;
  /** IANA time zone of all day logic (APP_TIMEZONE). */
  timeZone: string;
  /** Source code link (AGPL-3.0). */
  sourceUrl: string;
}

export interface SprintStats {
  sprint: Sprint;
  totalPlannedSp: number;
  totalDoneSp: number;
  perUser: { userId: number; plannedSp: number; doneSp: number; targetSp: number }[];
  taskCount: number;
  doneCount: number;
  carriedInCount: number;
  unplannedCount: number;
  unplannedSp: number;
  unplannedDoneSp: number;
}

export interface Metrics {
  sprints: SprintStats[];
  burndown: { date: string; remaining: number | null; ideal: number }[];
  hitRate: { userId: number | null; hit: number; total: number }[];
  carryOver: { sprintId: number; number: number; rate: number }[];
  recurring: { ruleId: number; title: string; done: number; missed: number; total: number; streak: number }[];
  categories: { categoryId: number | null; recentSp: number; allSp: number }[];
  estimateAccuracy: { sp: number; medianHours: number; count: number }[];
}

export type ServerEventType =
  | "task.upsert"
  | "task.delete"
  | "sprint.changed"
  | "planning.changed"
  | "retro.upsert"
  | "retro.delete"
  | "category.changed"
  | "recurring.changed"
  | "availability.changed"
  | "presence"
  | "activity"
  | "calendarEvent.upsert"
  | "calendarEvent.delete"
  | "eventRules.changed"
  | "users.changed";

export interface ServerEvent<T = unknown> {
  type: ServerEventType;
  data: T;
  by: number | null;
  clientId: string | null;
}
