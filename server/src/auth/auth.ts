// Google OAuth, email/password login, invites, dev login, sessions and the auth middleware. See openwiki/architecture.md (Security).
import { randomBytes } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { User } from "../../../shared/types.ts";
import type { Config } from "../config.ts";
import type { DB } from "../db/db.ts";
import { mapUser, USER_COLS } from "../db/repo.ts";
import { hashPassword, hashToken, PASSWORD_MAX, PASSWORD_MIN, RateLimiter, verifyPassword } from "./password.ts";

export const SESSION_COOKIE = "la_session";
const STATE_COOKIE = "la_oauth_state";
const SESSION_DAYS = 30;
const COLORS = ["#3b82f6", "#ec4899", "#10b981", "#f59e0b"];

export type AppEnv = { Variables: { user: User; clientId: string | null } };

/** Creates or updates the users from the allowlist, so they exist before the first login. */
export function seedUsers(db: DB, cfg: Config): void {
  cfg.allowed.forEach((a, i) => {
    const row = db.prepare("SELECT id FROM users WHERE email = ?").get(a.email);
    if (row) db.prepare("UPDATE users SET name = ? WHERE email = ?").run(a.name, a.email);
    else
      db.prepare("INSERT INTO users (email, name, color) VALUES (?, ?, ?)").run(a.email, a.name, COLORS[i % COLORS.length]);
  });
  ensureAdmin(db);
}

/** If no user is admin, the oldest user becomes admin. */
export function ensureAdmin(db: DB): void {
  const has = db.prepare("SELECT 1 FROM users WHERE is_admin = 1").get();
  if (!has) db.prepare("UPDATE users SET is_admin = 1 WHERE id = (SELECT min(id) FROM users)").run();
}

/** Inserts a user with the next color. Returns the id. */
export function insertUser(db: DB, email: string, name: string, passwordHash: string | null, admin = false): number {
  const n = (db.prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n;
  const res = db
    .prepare("INSERT INTO users (email, name, color, password_hash, is_admin) VALUES (?, ?, ?, ?, ?)")
    .run(email, name, COLORS[n % COLORS.length], passwordHash, admin ? 1 : 0);
  return Number(res.lastInsertRowid);
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Checks Origin on write calls in production. Without PUBLIC_URL the Origin must match the Host header. */
export function originOk(c: Context, cfg: Config): boolean {
  if (!cfg.production || c.req.method === "GET") return true;
  const origin = c.req.header("origin");
  if (!origin) return false;
  if (origin === cfg.publicUrl) return true;
  if (!cfg.publicUrlDefault) return false;
  try {
    return new URL(origin).host === c.req.header("host");
  } catch {
    return false;
  }
}

export function createSession(db: DB, userId: number): { id: string; expires: Date } {
  const id = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(id, userId, expires.toISOString());
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  return { id, expires };
}

export function userFromSession(db: DB, sessionId: string | undefined): User | null {
  if (!sessionId) return null;
  const r = db
    .prepare(
      `SELECT ${USER_COLS} FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sessionId, new Date().toISOString());
  return r ? mapUser(r as any) : null;
}

function setSessionCookie(c: Context, cfg: Config, id: string, expires: Date): void {
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    secure: cfg.publicUrl.startsWith("https://"),
    sameSite: "Lax",
    path: "/",
    expires,
  });
}

/** A user may log in when the account exists (from ALLOWED_EMAILS, setup or an invite). */
function allowedUser(db: DB, email: string): User | null {
  const r = db.prepare(`SELECT ${USER_COLS} FROM users u WHERE u.email = ?`).get(email.trim().toLowerCase());
  return r ? mapUser(r as any) : null;
}

type Json = Record<string, unknown>;
async function readJson(c: Context): Promise<Json> {
  try {
    const b = await c.req.json();
    return b && typeof b === "object" ? (b as Json) : {};
  } catch {
    return {};
  }
}

function checkPassword(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN) return `Şifre en az ${PASSWORD_MIN} karakter olmalı.`;
  if (pw.length > PASSWORD_MAX) return "Şifre çok uzun.";
  return null;
}

/** Open invite by token, or null when unknown, used or expired. */
export function findInvite(db: DB, token: string): { id: number; email: string; name: string } | null {
  const r = db
    .prepare("SELECT id, email, name FROM invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
    .get(hashToken(token), new Date().toISOString()) as { id: number; email: string; name: string } | undefined;
  return r ?? null;
}

export function authRoutes(db: DB, cfg: Config): Hono {
  const app = new Hono();
  const redirectUri = `${cfg.publicUrl}/auth/google/callback`;

  app.get("/google", (c) => {
    if (!cfg.googleClientId) return c.text("Google OAuth is not configured", 500);
    const state = randomBytes(16).toString("base64url");
    setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure: cfg.publicUrl.startsWith("https://"), sameSite: "Lax", path: "/", maxAge: 600 });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: cfg.googleClientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    }).toString();
    return c.redirect(url.toString());
  });

  app.get("/google/callback", async (c) => {
    const state = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: "/" });
    const code = c.req.query("code");
    if (!code || !state || state !== c.req.query("state")) return c.redirect("/giris?hata=state");
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: cfg.googleClientId,
        client_secret: cfg.googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!res.ok) return c.redirect("/giris?hata=token");
    const token = (await res.json()) as { id_token?: string };
    // The id_token comes straight from Google over TLS, so its claims are trusted (OIDC Core 3.1.3.7).
    const claims = JSON.parse(Buffer.from((token.id_token ?? "").split(".")[1] ?? "", "base64url").toString() || "{}");
    const issOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
    if (!issOk || claims.aud !== cfg.googleClientId || !claims.email_verified) return c.redirect("/giris?hata=token");
    const user = allowedUser(db, claims.email);
    if (!user) return c.redirect("/giris?hata=yetki");
    if (claims.picture) db.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").run(claims.picture, user.id);
    const s = createSession(db, user.id);
    setSessionCookie(c, cfg, s.id, s.expires);
    return c.redirect("/");
  });

  app.get("/dev", (c) => {
    if (!cfg.devLogin) return c.notFound();
    const user = allowedUser(db, c.req.query("email") ?? "");
    if (!user) return c.redirect("/giris?hata=yetki");
    const s = createSession(db, user.id);
    setSessionCookie(c, cfg, s.id, s.expires);
    return c.redirect("/");
  });

  const usersCount = () => (db.prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n;
  const limiter = new RateLimiter();
  const start = (c: Context, userId: number) => {
    const s = createSession(db, userId);
    setSessionCookie(c, cfg, s.id, s.expires);
    return c.json({ ok: true });
  };

  app.get("/options", (c) =>
    c.json({
      google: !!cfg.googleClientId,
      password: true,
      setupNeeded: usersCount() === 0,
      dev: cfg.devLogin ? cfg.allowed : null,
    }),
  );

  // First run: creates the first account (admin). Only while there are no users.
  app.post("/setup", async (c) => {
    if (!originOk(c, cfg)) return c.json({ error: "bad origin" }, 403);
    if (usersCount() > 0) return c.json({ error: "Kurulum zaten yapılmış." }, 409);
    const b = await readJson(c);
    const email = String(b.email ?? "").trim().toLowerCase();
    const name = String(b.name ?? "").trim().slice(0, 60);
    if (!EMAIL.test(email) || !name) return c.json({ error: "İsim ve geçerli bir e-posta gerekli." }, 400);
    const bad = checkPassword(b.password);
    if (bad) return c.json({ error: bad }, 400);
    const id = insertUser(db, email, name, hashPassword(String(b.password)), true);
    return start(c, id);
  });

  app.post("/login", async (c) => {
    if (!originOk(c, cfg)) return c.json({ error: "bad origin" }, 403);
    const b = await readJson(c);
    const email = String(b.email ?? "").trim().toLowerCase();
    const key = `${email}|${c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? ""}`;
    if (limiter.blocked(key)) return c.json({ error: "Çok fazla deneme. 15 dakika sonra tekrar deneyin." }, 429);
    const row = db.prepare("SELECT id, password_hash FROM users WHERE email = ?").get(email) as
      | { id: number; password_hash: string | null }
      | undefined;
    if (!row || !verifyPassword(String(b.password ?? ""), row.password_hash)) {
      limiter.fail(key);
      return c.json({ error: "E-posta veya şifre yanlış." }, 401);
    }
    limiter.reset(key);
    return start(c, row.id);
  });

  app.get("/invite/:token", (c) => {
    const inv = findInvite(db, c.req.param("token"));
    if (!inv) return c.json({ error: "Davet geçersiz ya da süresi dolmuş." }, 404);
    return c.json({ email: inv.email, name: inv.name, google: !!cfg.googleClientId });
  });

  app.post("/invite/:token", async (c) => {
    if (!originOk(c, cfg)) return c.json({ error: "bad origin" }, 403);
    const inv = findInvite(db, c.req.param("token"));
    if (!inv) return c.json({ error: "Davet geçersiz ya da süresi dolmuş." }, 404);
    if (allowedUser(db, inv.email)) return c.json({ error: "Bu e-posta ile bir hesap zaten var." }, 409);
    const b = await readJson(c);
    const name = String(b.name ?? inv.name).trim().slice(0, 60) || inv.name;
    const bad = checkPassword(b.password);
    if (bad) return c.json({ error: bad }, 400);
    const id = insertUser(db, inv.email, name, hashPassword(String(b.password)));
    db.prepare("UPDATE invites SET used_at = ? WHERE id = ?").run(new Date().toISOString(), inv.id);
    return start(c, id);
  });

  app.post("/logout", (c) => {
    const id = getCookie(c, SESSION_COOKIE);
    if (id) db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  return app;
}

/** Requires a session for /api/*. Checks Origin on write calls in production. */
export function requireUser(db: DB, cfg: Config): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = userFromSession(db, getCookie(c, SESSION_COOKIE));
    if (!user) return c.json({ error: "unauthorized" }, 401);
    if (!originOk(c, cfg)) return c.json({ error: "bad origin" }, 403);
    c.set("user", user);
    c.set("clientId", c.req.header("x-client-id") ?? null);
    await next();
  };
}
