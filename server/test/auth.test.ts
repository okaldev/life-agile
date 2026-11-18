import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.ts";
import { createSession, seedUsers } from "../src/auth/auth.ts";
import { hashPassword, RateLimiter, verifyPassword } from "../src/auth/password.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db/db.ts";

function setup(env: Record<string, string> = {}) {
  const cfg = loadConfig({ PUBLIC_URL: "https://agile.test", ...env });
  const db = openDb(":memory:");
  seedUsers(db, cfg);
  const app = createApp(db, cfg);
  const send = (method: string, path: string, data?: unknown, cookie = "") =>
    app.request(path, {
      method,
      headers: { cookie, "content-type": "application/json", origin: "https://agile.test" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  return { app, db, cfg, send };
}
const cookieOf = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0];

test("password hash round trip", () => {
  const h = hashPassword("correct horse");
  assert.ok(verifyPassword("correct horse", h));
  assert.ok(!verifyPassword("wrong", h));
  assert.ok(!verifyPassword("x", null));
});

test("rate limiter blocks after 5 failures and resets", () => {
  const l = new RateLimiter(5, 1000);
  for (let i = 0; i < 5; i++) l.fail("k", 0);
  assert.ok(l.blocked("k", 10));
  assert.ok(!l.blocked("k", 2000));
  l.fail("k", 3000);
  l.reset("k");
  assert.ok(!l.blocked("k", 3001));
});

test("first run setup creates an admin once; password login works", async () => {
  const { send } = setup();
  const opts = await (await send("GET", "/auth/options")).json();
  assert.equal(opts.setupNeeded, true);
  assert.equal(opts.google, false);
  assert.equal((await send("POST", "/auth/setup", { name: "Ada", email: "ada@x.com", password: "short" })).status, 400);
  const ok = await send("POST", "/auth/setup", { name: "Ada", email: "Ada@X.com", password: "longenough" });
  assert.equal(ok.status, 200);
  const me = await (await send("GET", "/api/me", undefined, cookieOf(ok))).json();
  assert.deepEqual([me.email, me.isAdmin], ["ada@x.com", true]);
  assert.equal((await send("POST", "/auth/setup", { name: "Eve", email: "eve@x.com", password: "longenough" })).status, 409);
  assert.equal((await send("POST", "/auth/login", { email: "ada@x.com", password: "nope-nope" })).status, 401);
  const login = await send("POST", "/auth/login", { email: "ada@x.com", password: "longenough" });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie") ?? "", /Secure/);
});

test("login is rate limited", async () => {
  const { send } = setup();
  await send("POST", "/auth/setup", { name: "Ada", email: "ada@x.com", password: "longenough" });
  for (let i = 0; i < 5; i++) await send("POST", "/auth/login", { email: "ada@x.com", password: "wrong-pass" });
  assert.equal((await send("POST", "/auth/login", { email: "ada@x.com", password: "longenough" })).status, 429);
});

test("invites: admin only, single use, then the new user logs in", async () => {
  const { send, db } = setup({ ALLOWED_EMAILS: "a@x.com:Alice,b@x.com:Bob" });
  const admin = `la_session=${createSession(db, 1).id}`;
  const bob = `la_session=${createSession(db, 2).id}`;
  assert.equal(((await (await send("GET", "/api/me", undefined, admin)).json()) as any).isAdmin, true); // oldest user
  assert.equal((await send("POST", "/api/admin/invites", { email: "c@x.com", name: "Cem" }, bob)).status, 403);
  assert.equal((await send("POST", "/api/admin/invites", { email: "b@x.com", name: "Bob" }, admin)).status, 409);
  const created = await (await send("POST", "/api/admin/invites", { email: "c@x.com", name: "Cem" }, admin)).json();
  const token = new URL(created.url).searchParams.get("t")!;
  assert.equal(((await (await send("GET", "/api/admin/invites", undefined, admin)).json()) as any[]).length, 1);
  assert.equal((await (await send("GET", `/auth/invite/${token}`)).json()).email, "c@x.com");
  assert.equal((await send("POST", `/auth/invite/${token}`, { password: "123" })).status, 400);
  const acc = await send("POST", `/auth/invite/${token}`, { name: "Cem K", password: "longenough" });
  assert.equal(acc.status, 200);
  const me = await (await send("GET", "/api/me", undefined, cookieOf(acc))).json();
  assert.deepEqual([me.name, me.isAdmin], ["Cem K", false]);
  assert.equal((await send("POST", `/auth/invite/${token}`, { password: "longenough" })).status, 404); // used
  assert.equal((await send("GET", "/auth/invite/nope")).status, 404);
  assert.equal((await send("POST", "/auth/setup", { name: "X", email: "x@x.com", password: "longenough" })).status, 409);
});

test("own password: set without current, change needs current", async () => {
  const { send, db } = setup({ ALLOWED_EMAILS: "a@x.com:Alice" });
  const ck = `la_session=${createSession(db, 1).id}`;
  assert.equal((await (await send("GET", "/api/me/password", undefined, ck)).json()).hasPassword, false);
  assert.equal((await send("PUT", "/api/me/password", { password: "firstpass" }, ck)).status, 200);
  assert.equal((await send("PUT", "/api/me/password", { password: "secondpass" }, ck)).status, 400);
  assert.equal((await send("PUT", "/api/me/password", { current: "firstpass", password: "secondpass" }, ck)).status, 200);
  assert.equal((await send("POST", "/auth/login", { email: "a@x.com", password: "secondpass" })).status, 200);
});

test("without PUBLIC_URL, writes accept an Origin matching the Host", async () => {
  const cfg = loadConfig({ NODE_ENV: "production" });
  const db = openDb(":memory:");
  const app = createApp(db, cfg);
  const post = (origin: string) =>
    app.request("http://box.lan:8080/auth/setup", {
      method: "POST",
      headers: { origin, host: "box.lan:8080", "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada", email: "ada@x.com", password: "longenough" }),
    });
  assert.equal((await post("http://evil.test")).status, 403);
  const ok = await post("http://box.lan:8080");
  assert.equal(ok.status, 200);
  assert.doesNotMatch(ok.headers.get("set-cookie") ?? "", /Secure/); // plain http install
});
