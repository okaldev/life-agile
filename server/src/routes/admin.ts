// Account routes: own password, and invites (admin only). See openwiki/api.md (Auth).
import { Hono } from "hono";
import type { Invite } from "../../../shared/types.ts";
import { EMAIL } from "../auth/auth.ts";
import type { AppEnv } from "../auth/auth.ts";
import { hashPassword, newToken, PASSWORD_MAX, PASSWORD_MIN, verifyPassword } from "../auth/password.ts";
import type { Config } from "../config.ts";
import type { DB } from "../db/db.ts";
import { body, HttpError, idParam, type C } from "./common.ts";

export const INVITE_DAYS = 7;

function requireAdmin(c: C): void {
  if (!c.get("user").isAdmin) throw new HttpError(403, "admin only");
}

function mapInvite(r: any): Invite {
  return { id: r.id, email: r.email, name: r.name, expiresAt: r.expires_at, createdAt: r.created_at };
}

export function accountRoutes(db: DB, cfg: Config): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/me/password", (c) => {
    const r = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(c.get("user").id) as { password_hash: string | null };
    return c.json({ hasPassword: !!r?.password_hash });
  });

  /** Sets or changes the own password. Changing needs the current one. */
  app.put("/me/password", async (c) => {
    const b = await body(c);
    const id = c.get("user").id;
    const r = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(id) as { password_hash: string | null };
    if (r.password_hash && !verifyPassword(String(b.current ?? ""), r.password_hash))
      throw new HttpError(400, "Mevcut şifre yanlış.");
    const pw = b.password;
    if (typeof pw !== "string" || pw.length < PASSWORD_MIN || pw.length > PASSWORD_MAX)
      throw new HttpError(400, `Şifre ${PASSWORD_MIN}-${PASSWORD_MAX} karakter olmalı.`);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(pw), id);
    return c.json({ hasPassword: true });
  });

  app.get("/admin/invites", (c) => {
    requireAdmin(c);
    const rows = db
      .prepare("SELECT * FROM invites WHERE used_at IS NULL AND expires_at > ? ORDER BY id DESC")
      .all(new Date().toISOString());
    return c.json(rows.map(mapInvite));
  });

  /** Creates an invite link. The token is shown once; only its hash is stored. */
  app.post("/admin/invites", async (c) => {
    requireAdmin(c);
    const b = await body(c);
    const email = String(b.email ?? "").trim().toLowerCase();
    const name = String(b.name ?? "").trim().slice(0, 60);
    if (!EMAIL.test(email) || !name) throw new HttpError(400, "İsim ve geçerli bir e-posta gerekli.");
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw new HttpError(409, "Bu e-posta ile bir hesap zaten var.");
    const { token, hash } = newToken();
    const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
    const res = db
      .prepare("INSERT INTO invites (token_hash, email, name, created_by, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(hash, email, name, c.get("user").id, expires);
    const row = db.prepare("SELECT * FROM invites WHERE id = ?").get(res.lastInsertRowid);
    return c.json({ invite: mapInvite(row), url: `${cfg.publicUrl}/davet?t=${token}` }, 201);
  });

  app.delete("/admin/invites/:id", (c) => {
    requireAdmin(c);
    db.prepare("DELETE FROM invites WHERE id = ? AND used_at IS NULL").run(idParam(c));
    return c.json({ ok: true });
  });

  return app;
}
