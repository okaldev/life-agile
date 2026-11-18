// Profile photo routes. Photos live in user_avatars (SQLite), so DB backups include them.
import { Hono } from "hono";
import type { AppEnv } from "../auth/auth.ts";
import type { DB } from "../db/db.ts";
import { nowIso } from "../db/db.ts";
import { listUsers } from "../db/repo.ts";
import { body, emit, HttpError, idParam } from "./common.ts";

export const AVATAR_MAX_BYTES = 200 * 1024;
const DATA_URL = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/;

export function profileRoutes(db: DB): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.put("/me/avatar", async (c) => {
    const m = DATA_URL.exec(String((await body(c)).dataUrl ?? ""));
    if (!m) throw new HttpError(400, "dataUrl must be a webp, jpeg or png data URL");
    const data = Buffer.from(m[2], "base64");
    if (data.length === 0 || data.length > AVATAR_MAX_BYTES) throw new HttpError(400, "image too large (max 200 KB)");
    db.prepare(
      `INSERT INTO user_avatars (user_id, mime, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
    ).run(c.get("user").id, m[1], data, nowIso());
    const users = listUsers(db);
    emit(c, "users.changed", users);
    return c.json(users.find((u) => u.id === c.get("user").id));
  });

  app.delete("/me/avatar", (c) => {
    db.prepare("DELETE FROM user_avatars WHERE user_id = ?").run(c.get("user").id);
    const users = listUsers(db);
    emit(c, "users.changed", users);
    return c.json(users.find((u) => u.id === c.get("user").id));
  });

  app.get("/avatars/:userId", (c) => {
    const r = db.prepare("SELECT mime, data FROM user_avatars WHERE user_id = ?").get(idParam(c, "userId")) as
      | { mime: string; data: Uint8Array }
      | undefined;
    if (!r) throw new HttpError(404, "no photo");
    return c.body(Buffer.from(r.data), 200, {
      "content-type": r.mime,
      "cache-control": "private, max-age=31536000, immutable",
    });
  });

  return app;
}
