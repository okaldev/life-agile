// Web Push sender. See openwiki/notifications.md.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as webpush from "web-push";
import type { Config } from "../config.ts";
import type { DB } from "../db/db.ts";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

let enabled = false;

/**
 * Without VAPID keys in the env, uses data/vapid.json, and creates it on the first start.
 * So push works after a plain `docker compose up` too. Env keys always win.
 */
export function loadVapidKeys(cfg: Config, dataDir: string): void {
  if (cfg.vapidPublicKey && cfg.vapidPrivateKey) return;
  const file = join(dataDir, "vapid.json");
  try {
    if (!existsSync(file)) {
      writeFileSync(file, JSON.stringify(webpush.generateVAPIDKeys()), { mode: 0o600 });
      console.log(`[push] created VAPID keys in ${file}`);
    }
    const keys = JSON.parse(readFileSync(file, "utf8")) as { publicKey: string; privateKey: string };
    cfg.vapidPublicKey = keys.publicKey;
    cfg.vapidPrivateKey = keys.privateKey;
  } catch (err) {
    console.warn("[push] could not load or create VAPID keys", err);
  }
}

export function initPush(cfg: Config): boolean {
  if (!cfg.vapidPublicKey || !cfg.vapidPrivateKey) {
    console.warn("[push] VAPID keys missing: push notifications are off");
    return false;
  }
  webpush.setVapidDetails(cfg.vapidSubject, cfg.vapidPublicKey, cfg.vapidPrivateKey);
  enabled = true;
  return true;
}

export async function sendToUser(db: DB, userId: number, payload: PushPayload): Promise<number> {
  if (!enabled) return 0;
  const subs = db.prepare("SELECT * FROM push_subscriptions WHERE user_id = ?").all(userId) as {
    id: number;
    endpoint: string;
    p256dh: string;
    auth: string;
  }[];
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 3600 },
        );
        sent++;
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(s.id);
        } else console.error("[push] send failed", err?.statusCode ?? err);
      }
    }),
  );
  return sent;
}
