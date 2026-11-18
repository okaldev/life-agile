// Push subscription and notification preference routes.
import { Hono } from "hono";
import type { AppEnv } from "../auth/auth.ts";
import type { DB } from "../db/db.ts";
import { getPrefs } from "../db/repo.ts";
import { sendToUser } from "../jobs/push.ts";
import { body, HttpError, v } from "./common.ts";

export function pushRoutes(db: DB): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/push/subscribe", async (c) => {
    const b = await body(c);
    const endpoint = v.str(b.endpoint, "endpoint", 2000);
    const p256dh = v.str(b.keys?.p256dh ?? "", "p256dh", 500);
    const auth = v.str(b.keys?.auth ?? "", "auth", 500);
    if (!endpoint.startsWith("https://") || !p256dh || !auth) throw new HttpError(400, "bad subscription");
    db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    ).run(c.get("user").id, endpoint, p256dh, auth);
    return c.json({ ok: true });
  });

  app.post("/push/unsubscribe", async (c) => {
    const b = await body(c);
    db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(String(b.endpoint ?? ""), c.get("user").id);
    return c.json({ ok: true });
  });

  app.post("/push/test", async (c) => {
    const sent = await sendToUser(db, c.get("user").id, {
      title: "Life Agile",
      body: "Bildirimler çalışıyor.",
      url: "/ayarlar",
    });
    return c.json({ sent });
  });

  app.get("/notification-prefs", (c) => c.json(getPrefs(db, c.get("user").id)));

  app.put("/notification-prefs", async (c) => {
    const b = await body(c);
    const cur = getPrefs(db, c.get("user").id);
    const next = {
      planningReminder: "planningReminder" in b ? !!b.planningReminder : cur.planningReminder,
      dailySummary: "dailySummary" in b ? !!b.dailySummary : cur.dailySummary,
      taskReminderMin: "taskReminderMin" in b ? v.int(b.taskReminderMin, "taskReminderMin", 0, 240, false)! : cur.taskReminderMin,
      partnerChanges: "partnerChanges" in b ? !!b.partnerChanges : cur.partnerChanges,
    };
    db.prepare(
      `INSERT INTO notification_prefs (user_id, planning_reminder, daily_summary, task_reminder_min, partner_changes)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET planning_reminder = excluded.planning_reminder,
         daily_summary = excluded.daily_summary, task_reminder_min = excluded.task_reminder_min,
         partner_changes = excluded.partner_changes`,
    ).run(c.get("user").id, +next.planningReminder, +next.dailySummary, next.taskReminderMin, +next.partnerChanges);
    return c.json(next);
  });

  return app;
}
