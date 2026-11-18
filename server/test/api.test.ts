import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.ts";
import { createSession, seedUsers } from "../src/auth/auth.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db/db.ts";

function setup(env: Record<string, string> = {}) {
  const cfg = loadConfig({ ALLOWED_EMAILS: "f@x.com:Alice,b@x.com:Bob", PUBLIC_URL: "https://agile.test", ...env });
  const db = openDb(":memory:");
  seedUsers(db, cfg);
  const app = createApp(db, cfg);
  const cookie = `la_session=${createSession(db, 1).id}`;
  return { app, db, cookie };
}

test("api requires a session", async () => {
  const { app } = setup();
  assert.equal((await app.request("/api/bootstrap")).status, 401);
  assert.equal((await app.request("/api/health")).status, 200);
  const page = await app.request("/takvim");
  assert.equal(page.status, 302);
  assert.equal(page.headers.get("location"), "/giris");
});

test("dev login is off in production", async () => {
  const { app } = setup({ NODE_ENV: "production", DEV_LOGIN: "1" });
  assert.equal((await app.request("/auth/dev?email=f@x.com")).status, 404);
});

test("production write calls need the right origin", async () => {
  const { app, cookie } = setup({ NODE_ENV: "production" });
  const req = (origin: string) =>
    app.request("/api/tasks", {
      method: "POST",
      headers: { cookie, origin, "content-type": "application/json" },
      body: JSON.stringify({ title: "X", assigneeIds: [1] }),
    });
  assert.equal((await req("https://evil.test")).status, 403);
  assert.equal((await req("https://agile.test")).status, 201);
});

test("task validation and shared assignees", async () => {
  const { app, cookie } = setup();
  const post = (body: unknown) =>
    app.request("/api/tasks", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post({ title: "X", sp: 7, assigneeIds: [1] })).status, 400);
  assert.equal((await post({ title: "X", assigneeIds: [9] })).status, 400);
  const res = await post({ title: "Market", sp: 3, assigneeIds: [1, 2], date: "2026-11-16", startTime: "10:00", endTime: "09:00" });
  assert.equal(res.status, 201);
  const task = await res.json();
  assert.deepEqual(task.assigneeIds, [1, 2]);
  assert.equal(task.endTime, null); // end before start is dropped
  const done = await app.request(`/api/tasks/${task.id}`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ status: "done" }),
  });
  assert.ok((await done.json()).doneAt);
});

test("profile photo: upload, serve, limits, fallback to Google photo", async () => {
  const { app, db, cookie } = setup();
  db.prepare("UPDATE users SET avatar_url = 'https://g.example/p.jpg' WHERE id = 1").run();
  const put = (dataUrl: string) =>
    app.request("/api/me/avatar", { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ dataUrl }) });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");
  assert.equal((await put("data:image/gif;base64,AAAA")).status, 400);
  assert.equal((await put(`data:image/webp;base64,${Buffer.alloc(200 * 1024 + 1).toString("base64")}`)).status, 400);
  const ok = await put(`data:image/png;base64,${png}`);
  assert.equal(ok.status, 200);
  const me = (await ok.json()) as any;
  assert.match(me.avatarUrl, /^\/api\/avatars\/1\?v=/);
  const img = await app.request("/api/avatars/1", { headers: { cookie } });
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.equal(Buffer.from(await img.arrayBuffer()).toString("base64"), png);
  assert.equal((await app.request("/api/avatars/1")).status, 401);
  const boot = (await (await app.request("/api/bootstrap", { headers: { cookie } })).json()) as any;
  assert.match(boot.me.avatarUrl, /^\/api\/avatars\/1/);
  const del = await app.request("/api/me/avatar", { method: "DELETE", headers: { cookie } });
  assert.equal(((await del.json()) as any).avatarUrl, "https://g.example/p.jpg");
});

test("task history records field changes, parts and checklist; new tasks get low priority", async () => {
  const { app, cookie } = setup();
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await app.request(path, { method, headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return (await r.json()) as any;
  };
  const t = await call("POST", "/api/tasks", { title: "Ödev", assigneeIds: [1] });
  assert.equal(t.priority, 1);
  await call("PATCH", `/api/tasks/${t.id}`, { sp: 3, status: "in_progress", assigneeIds: [1, 2], description: "uzun metin" });
  const part = await call("POST", `/api/tasks/${t.id}/blocks`, { date: "2026-11-20", startTime: "10:00", endTime: "11:00" });
  await call("PATCH", `/api/blocks/${part.id}`, { status: "done" });
  const item = await call("POST", `/api/tasks/${t.id}/checklist`, { text: "kaynak bul" });
  await call("PATCH", `/api/checklist/${item.id}`, { done: true });
  const h = await call("GET", `/api/tasks/${t.id}/history`);
  const fields = h.map((e: any) => e.field);
  for (const f of ["created", "sp", "status", "assigneeIds", "description", "part.add", "part.status", "checklist.add", "checklist.done"])
    assert.ok(fields.includes(f), `missing ${f}`);
  const sp = h.find((e: any) => e.field === "sp");
  assert.deepEqual([sp.oldValue, sp.newValue, sp.userId], [null, 3, 1]);
  assert.equal(h.find((e: any) => e.field === "description").newValue, null); // text itself is not stored
  assert.ok(h[0].id > h[h.length - 1].id); // newest first
});
