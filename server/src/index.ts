// Server entry: config, database, app, background jobs.
import { serve } from "@hono/node-server";
import { dirname } from "node:path";
import { createApp } from "./app.ts";
import { seedUsers } from "./auth/auth.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db/db.ts";
import { hooks } from "./hooks.ts";
import { initPush, loadVapidKeys, sendToUser } from "./jobs/push.ts";
import { startScheduler } from "./jobs/scheduler.ts";
import { getPrefs, listUsers } from "./db/repo.ts";

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
seedUsers(db, cfg);
loadVapidKeys(cfg, dirname(cfg.dbPath));
if ((db.prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n === 0)
  console.log(`[boot] no users yet: open ${cfg.publicUrl}/kurulum to create the admin account`);

const app = createApp(db, cfg);

initPush(cfg);
const stopScheduler = startScheduler(db, cfg.dbPath);

// Tell a user when the partner assigns a task to them.
hooks.onAssigned = (task, byUserId, userIds) => {
  const by = listUsers(db).find((u) => u.id === byUserId);
  for (const userId of userIds) {
    if (userId === byUserId || !getPrefs(db, userId).partnerChanges) continue;
    void sendToUser(db, userId, {
      title: `${by?.name ?? "Partner"} sana görev atadı`,
      body: task.title,
      url: "/board",
      tag: `assign-${task.id}`,
    });
  }
};

serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`[boot] life-agile listening on :${info.port} (production=${cfg.production}, devLogin=${cfg.devLogin}, tz=${cfg.timeZone})`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopScheduler();
    db.close();
    process.exit(0);
  });
}
