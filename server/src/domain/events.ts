// General calendar events (outside sprints) and repeating event rules. See openwiki/calendar.md.
import type { CalendarEvent, EventKind, EventRule, MarkStatus, RecurringFreq } from "../../../shared/types.ts";
import type { DB } from "../db/db.ts";
import { nowIso, tx } from "../db/db.ts";
import { cleanTimes } from "./blocks.ts";
import { ruleHitsDay } from "./recurrence.ts";
import { addDays, daysBetween, weekdayIndex } from "./time.ts";

type Row = Record<string, any>;

const ids = (s: string | null | undefined): number[] =>
  s ? s.split(",").map(Number).sort((a, b) => a - b) : [];

const EVENT_SELECT = `
  SELECT e.*, (SELECT group_concat(user_id) FROM calendar_event_attendees a WHERE a.event_id = e.id) AS attendee_ids
  FROM calendar_events e`;

const RULE_SELECT = `
  SELECT r.*, (SELECT group_concat(user_id) FROM event_rule_attendees a WHERE a.rule_id = r.id) AS attendee_ids
  FROM event_rules r`;

export function mapEvent(r: Row): CalendarEvent {
  return {
    id: r.id,
    title: r.title,
    note: r.note,
    kind: r.kind,
    date: r.date,
    startTime: r.start_time ?? null,
    endTime: r.end_time ?? null,
    status: r.status,
    ruleId: r.rule_id ?? null,
    attendeeIds: ids(r.attendee_ids),
    updatedAt: r.updated_at,
  };
}

export function mapEventRule(r: Row): EventRule {
  return {
    id: r.id,
    title: r.title,
    note: r.note,
    kind: r.kind,
    freq: r.freq,
    weekdaysMask: r.weekdays_mask,
    startTime: r.start_time ?? null,
    endTime: r.end_time ?? null,
    startDate: r.start_date,
    active: !!r.active,
    attendeeIds: ids(r.attendee_ids),
  };
}

export function getEvent(db: DB, id: number): CalendarEvent | null {
  const r = db.prepare(`${EVENT_SELECT} WHERE e.id = ?`).get(id) as Row | undefined;
  return r ? mapEvent(r) : null;
}

export function getEventRule(db: DB, id: number): EventRule | null {
  const r = db.prepare(`${RULE_SELECT} WHERE r.id = ?`).get(id) as Row | undefined;
  return r ? mapEventRule(r) : null;
}

export function listEventRules(db: DB): EventRule[] {
  return (db.prepare(`${RULE_SELECT} WHERE r.deleted_at IS NULL ORDER BY r.id`).all() as Row[]).map(mapEventRule);
}

function setAttendees(db: DB, table: "calendar_event_attendees" | "event_rule_attendees", id: number, userIds: number[]): void {
  const col = table === "calendar_event_attendees" ? "event_id" : "rule_id";
  db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(id);
  for (const u of userIds) db.prepare(`INSERT OR IGNORE INTO ${table} (${col}, user_id) VALUES (?, ?)`).run(id, u);
}

export interface EventInput {
  title: string;
  note: string;
  kind: EventKind;
  date: string;
  startTime: string | null;
  endTime: string | null;
  attendeeIds: number[];
}

export function createEvent(db: DB, input: EventInput, userId: number, ruleId: number | null = null): CalendarEvent {
  const { start, end } = cleanTimes(input.startTime, input.endTime);
  const now = nowIso();
  return tx(db, () => {
    const res = db
      .prepare(
        `INSERT INTO calendar_events (title, note, kind, date, start_time, end_time, rule_id, occurrence_date, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.title, input.note, input.kind, input.date, start, end, ruleId, ruleId ? input.date : null, userId, now, now);
    const id = Number(res.lastInsertRowid);
    setAttendees(db, "calendar_event_attendees", id, input.attendeeIds);
    return getEvent(db, id)!;
  });
}

export function updateEvent(
  db: DB,
  id: number,
  patch: Partial<EventInput> & { status?: MarkStatus },
): CalendarEvent | null {
  const prev = getEvent(db, id);
  if (!prev) return null;
  const next = { ...prev, ...patch };
  const { start, end } = cleanTimes(next.startTime, next.endTime);
  tx(db, () => {
    db.prepare(
      `UPDATE calendar_events SET title = ?, note = ?, kind = ?, date = ?, start_time = ?, end_time = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    ).run(next.title, next.note, next.kind, next.date, start, end, next.status, nowIso(), id);
    if (patch.attendeeIds) setAttendees(db, "calendar_event_attendees", id, patch.attendeeIds);
  });
  return getEvent(db, id);
}

export interface EventRuleInput extends Omit<EventInput, "date"> {
  freq: RecurringFreq;
  weekdaysMask: number;
  startDate: string;
}

export function createEventRule(db: DB, input: EventRuleInput, userId: number): EventRule {
  const { start, end } = cleanTimes(input.startTime, input.endTime);
  return tx(db, () => {
    const res = db
      .prepare(
        `INSERT INTO event_rules (title, note, kind, freq, weekdays_mask, start_time, end_time, start_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.title, input.note, input.kind, input.freq, input.weekdaysMask, start, end, input.startDate, userId);
    const id = Number(res.lastInsertRowid);
    setAttendees(db, "event_rule_attendees", id, input.attendeeIds);
    return getEventRule(db, id)!;
  });
}

/**
 * Creates the missing occurrences of active rules for dates in [from, to].
 * Idempotent: the unique index (rule_id, occurrence_date) skips existing ones.
 * Returns the new event ids.
 */
export function materializeEvents(db: DB, from: string, to: string, onlyRuleId?: number): number[] {
  const days = daysBetween(from, to);
  if (days < 0 || days > 62) return []; // guard against huge ranges
  const rules = listEventRules(db).filter((r) => r.active && (!onlyRuleId || r.id === onlyRuleId));
  const created: number[] = [];
  const now = nowIso();
  tx(db, () => {
    const insert = db.prepare(
      `INSERT INTO calendar_events (title, note, kind, date, start_time, end_time, rule_id, occurrence_date, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?) ON CONFLICT DO NOTHING`,
    );
    for (const rule of rules) {
      for (let i = 0; i <= days; i++) {
        const date = addDays(from, i);
        if (date < rule.startDate || !ruleHitsDay(rule, weekdayIndex(date))) continue;
        const res = insert.run(rule.title, rule.note, rule.kind, date, rule.startTime, rule.endTime, rule.id, date, now, now);
        if (res.changes > 0) {
          const id = Number(res.lastInsertRowid);
          setAttendees(db, "calendar_event_attendees", id, rule.attendeeIds);
          created.push(id);
        }
      }
    }
  });
  return created;
}

export function listEvents(db: DB, from: string, to: string): CalendarEvent[] {
  return (db.prepare(`${EVENT_SELECT} WHERE e.date BETWEEN ? AND ? ORDER BY e.date, coalesce(e.start_time, ''), e.id`).all(from, to) as Row[]).map(
    mapEvent,
  );
}

/**
 * Applies a rule change to its future planned occurrences (date >= fromDate):
 * updates fields, deletes occurrences on days the rule no longer hits or when the rule is inactive.
 */
export function syncFutureEvents(db: DB, ruleId: number, fromDate: string): { changed: number[]; removed: number[] } {
  const rule = getEventRule(db, ruleId);
  const changed: number[] = [];
  const removed: number[] = [];
  if (!rule) return { changed, removed };
  const rows = db
    .prepare("SELECT id, date FROM calendar_events WHERE rule_id = ? AND status = 'planned' AND date >= ?")
    .all(ruleId, fromDate) as { id: number; date: string }[];
  tx(db, () => {
    for (const r of rows) {
      if (!rule.active || r.date < rule.startDate || !ruleHitsDay(rule, weekdayIndex(r.date))) {
        db.prepare("DELETE FROM calendar_events WHERE id = ?").run(r.id);
        removed.push(r.id);
        continue;
      }
      db.prepare(
        "UPDATE calendar_events SET title = ?, note = ?, kind = ?, start_time = ?, end_time = ?, updated_at = ? WHERE id = ?",
      ).run(rule.title, rule.note, rule.kind, rule.startTime, rule.endTime, nowIso(), r.id);
      setAttendees(db, "calendar_event_attendees", r.id, rule.attendeeIds);
      changed.push(r.id);
    }
  });
  return { changed, removed };
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const ALL_DAY_EVENT_HOURS = 8;

/** Hours of events the user attends in [from, to]. All-day events count 8 h. Missed events do not count. */
export function busyHours(db: DB, userId: number, from: string, to: string): number {
  const rows = db
    .prepare(
      `SELECT e.start_time, e.end_time FROM calendar_events e
       JOIN calendar_event_attendees a ON a.event_id = e.id AND a.user_id = ?
       WHERE e.date BETWEEN ? AND ? AND e.status != 'missed'`,
    )
    .all(userId, from, to) as { start_time: string | null; end_time: string | null }[];
  const minutes = rows.reduce((s, r) => {
    if (!r.start_time) return s + ALL_DAY_EVENT_HOURS * 60;
    if (!r.end_time) return s + 60;
    return s + Math.max(0, toMin(r.end_time) - toMin(r.start_time));
  }, 0);
  return Math.round((minutes / 60) * 10) / 10;
}
