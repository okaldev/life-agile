// One-minute ticker: scheduled sprint start, reminders and daily backup. See openwiki/notifications.md.
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DB } from "../db/db.ts";
import { getPrefs, getSprintByStatus, listUsers } from "../db/repo.ts";
import { dueScheduledSprint, finishPlanning } from "../domain/sprint.ts";
import { localNow, type LocalNow } from "../domain/time.ts";
import { broadcast } from "../realtime/hub.ts";
import { sendToUser, type PushPayload } from "./push.ts";

const WINDOW_MIN = 30; // a scheduled job fires only within this many minutes after its time
const BACKUP_KEEP = 30;

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** True when `now` is at or after `at` (HH:MM) but inside the window. */
export function due(now: LocalNow, at: string, window = WINDOW_MIN): boolean {
  const d = toMin(now.time) - toMin(at);
  return d >= 0 && d < window;
}

/** Records a send key. Returns false when the key was already used. */
function claim(db: DB, key: string): boolean {
  return db.prepare("INSERT OR IGNORE INTO sent_notifications (key) VALUES (?)").run(key).changes > 0;
}

async function notify(db: DB, key: string, userId: number, payload: PushPayload): Promise<void> {
  if (!claim(db, key)) return;
  await sendToUser(db, userId, payload);
}

export function backup(db: DB, dbPath: string, date: string): string | null {
  if (dbPath === ":memory:") return null;
  const dir = join(dirname(dbPath), "backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `agile-${date}.db`);
  if (!existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const files = readdirSync(dir)
    .filter((f) => /^agile-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort();
  for (const old of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) rmSync(join(dir, old));
  return file;
}

export async function tick(db: DB, dbPath: string, now: LocalNow = localNow()): Promise<void> {
  const users = listUsers(db);

  if (due(now, "03:00") && claim(db, `backup:${now.date}`)) {
    try {
      const f = backup(db, dbPath, now.date);
      if (f) console.log(`[jobs] backup written: ${f}`);
    } catch (err) {
      console.error("[jobs] backup failed", err);
    }
  }

  // A scheduled sprint starts by itself at 00:00 of its start date (openwiki/sprint-flow.md).
  if (dueScheduledSprint(db, now.date)) {
    const started = finishPlanning(db);
    console.log(`[jobs] sprint ${started.number} started on schedule`);
    db.prepare("INSERT INTO activity (user_id, action, entity, entity_id, summary) VALUES (NULL, 'planning', 'sprint', ?, ?)").run(
      started.id,
      `Sprint ${started.number} zamanında başladı`,
    );
    broadcast("sprint.changed", { activeSprint: getSprintByStatus(db, "active"), plannedSprint: null }, null, null);
    broadcast("planning.changed", { refresh: true }, null, null);
    for (const u of users)
      await notify(db, `sprint-start:${started.id}:${u.id}`, u.id, {
        title: `Sprint ${started.number} başladı`,
        body: started.goal || "Yeni hafta, yeni sprint.",
        url: "/board",
        tag: "sprint-start",
      });
  }

  const planned = getSprintByStatus(db, "planned");

  for (const u of users) {
    const prefs = getPrefs(db, u.id);

    if (prefs.planningReminder && now.weekday === 6 && due(now, "20:00") && !planned) {
      await notify(db, `planning:${now.date}:${u.id}`, u.id, {
        title: "Sprint planlama zamanı",
        body: "Retro, grooming ve estimation için hazır mısınız?",
        url: "/planlama",
        tag: "planning",
      });
    }

    // Today's planned calendar parts of the user (tasks of any sprint or the backlog) and events.
    const blocks = db
      .prepare(
        `SELECT b.id, b.start_time, t.id AS task_id, t.title, t.points AS sp FROM task_blocks b JOIN tasks t ON t.id = b.task_id
         WHERE b.date = ? AND b.status = 'planned' AND t.status != 'done'
           AND EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = ?)
         ORDER BY coalesce(b.start_time, '')`,
      )
      .all(now.date, u.id) as { id: number; start_time: string | null; task_id: number; title: string; sp: number | null }[];
    const events = db
      .prepare(
        `SELECT e.id, e.title, e.start_time FROM calendar_events e
         WHERE e.date = ? AND e.status = 'planned'
           AND EXISTS (SELECT 1 FROM calendar_event_attendees a WHERE a.event_id = e.id AND a.user_id = ?)
         ORDER BY coalesce(e.start_time, '')`,
      )
      .all(now.date, u.id) as { id: number; title: string; start_time: string | null }[];

    if (prefs.dailySummary && due(now, "08:30") && blocks.length + events.length > 0) {
      const sp = [...new Map(blocks.map((b) => [b.task_id, b.sp ?? 0])).values()].reduce((s, x) => s + x, 0);
      const items = [...blocks, ...events]
        .sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""))
        .map((x) => (x.start_time ? `${x.start_time} ${x.title}` : x.title));
      await notify(db, `daily:${now.date}:${u.id}`, u.id, {
        title: `Bugün ${blocks.length} görev${events.length ? `, ${events.length} etkinlik` : ""} · ${sp} SP`,
        body: items.slice(0, 5).join(", ") + (items.length > 5 ? "…" : ""),
        url: "/takvim",
        tag: "daily",
      });
    }

    if (prefs.taskReminderMin > 0) {
      const timed = [
        ...blocks.map((b) => ({ key: `block:${b.id}`, title: b.title, start: b.start_time, tag: `task-${b.task_id}` })),
        ...events.map((e) => ({ key: `event:${e.id}`, title: e.title, start: e.start_time, tag: `event-${e.id}` })),
      ];
      for (const t of timed) {
        if (!t.start) continue;
        const before = toMin(t.start) - toMin(now.time);
        if (before >= 0 && before <= prefs.taskReminderMin) {
          await notify(db, `${t.key}:${now.date}:${u.id}`, u.id, {
            title: t.title,
            body: before === 0 ? "Şimdi başlıyor" : `${before} dakika sonra (${t.start})`,
            url: "/takvim",
            tag: t.tag,
          });
        }
      }
    }
  }

  // Keep the dedupe table small.
  db.prepare("DELETE FROM sent_notifications WHERE sent_at < ?").run(new Date(Date.now() - 14 * 86_400_000).toISOString());
}

export function startScheduler(db: DB, dbPath: string): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick(db, dbPath);
    } catch (err) {
      console.error("[jobs] tick failed", err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, 60_000);
  void run();
  return () => clearInterval(timer);
}
