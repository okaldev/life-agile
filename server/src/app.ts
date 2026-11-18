// Builds the Hono app. Kept separate from index.ts so tests can create it with a temp DB.
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "./auth/auth.ts";
import { authRoutes, requireUser, SESSION_COOKIE, userFromSession } from "./auth/auth.ts";
import type { Config } from "./config.ts";
import type { DB } from "./db/db.ts";
import { setTimeZone } from "./domain/time.ts";
import { addClient } from "./realtime/hub.ts";
import { accountRoutes } from "./routes/admin.ts";
import { calendarRoutes } from "./routes/calendar.ts";
import { HttpError } from "./routes/common.ts";
import { miscRoutes } from "./routes/misc.ts";
import { planningRoutes } from "./routes/planning.ts";
import { profileRoutes } from "./routes/profile.ts";
import { pushRoutes } from "./routes/push.ts";
import { taskRoutes } from "./routes/tasks.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const PUBLIC_PREFIXES = ["/_astro/", "/icons/", "/giris", "/kurulum", "/davet"];
const PUBLIC_FILES = new Set(["/manifest.webmanifest", "/sw.js", "/favicon.svg", "/favicon.ico", "/robots.txt"]);

export function createApp(db: DB, cfg: Config, extra?: (api: Hono<AppEnv>) => void): Hono<AppEnv> {
  setTimeZone(cfg.timeZone);
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    console.error("[app] unhandled error", err);
    return c.json({ error: "server error" }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.route("/auth", authRoutes(db, cfg));

  const api = new Hono<AppEnv>();
  api.use("*", requireUser(db, cfg));
  api.get("/events", (c) => {
    const userId = c.get("user").id;
    c.header("Cache-Control", "no-cache, no-transform");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      const remove = addClient({
        userId,
        send: (event, data) => {
          void stream.writeSSE({ event, data });
        },
      });
      let open = true;
      stream.onAbort(() => {
        open = false;
        remove();
      });
      await stream.writeSSE({ event: "hello", data: "{}" });
      while (open) {
        await stream.sleep(25_000);
        if (open) await stream.writeSSE({ event: "ping", data: "{}" });
      }
    });
  });
  api.route("/", miscRoutes(db, cfg));
  api.route("/", taskRoutes(db));
  api.route("/", planningRoutes(db));
  api.route("/", pushRoutes(db));
  api.route("/", calendarRoutes(db));
  api.route("/", profileRoutes(db));
  api.route("/", accountRoutes(db, cfg));
  extra?.(api);
  app.route("/api", api);

  // Static UI (web/dist). Pages need a session; assets and the login page do not.
  const root = resolve(cfg.webDist);
  app.get("*", (c) => {
    const path = decodeURIComponent(new URL(c.req.url).pathname);
    const isPublic = PUBLIC_FILES.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
    if (!isPublic && !userFromSession(db, getCookie(c, SESSION_COOKIE))) return c.redirect("/giris");
    const file = resolveFile(root, path);
    if (!file) return c.text("Not found", 404);
    const ext = extname(file);
    const headers: Record<string, string> = { "content-type": MIME[ext] ?? "application/octet-stream" };
    headers["cache-control"] = path.startsWith("/_astro/") ? "public, max-age=31536000, immutable" : "no-cache";
    return c.body(readFileSync(file), 200, headers);
  });

  return app;
}

function resolveFile(root: string, path: string): string | null {
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
  const candidates = [join(root, safe), join(root, safe, "index.html"), join(root, `${safe}.html`)];
  for (const f of candidates) {
    if (!f.startsWith(root)) continue;
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}
