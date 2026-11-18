// Builds a demo database with sample data (two people, one closed and one active sprint).
// Used for README screenshots and to try the app. It never touches data/agile.db.
//
//   npm run demo:seed                 # writes data/demo.db
//   npm run demo                      # starts the app on it: http://localhost:8080 (dev login: Deniz / Ece)
import { existsSync, rmSync } from "node:fs";
import { createApp } from "../server/src/app.ts";
import { createSession, seedUsers } from "../server/src/auth/auth.ts";
import { loadConfig } from "../server/src/config.ts";
import { openDb } from "../server/src/db/db.ts";
import { finishPlanning, setStep, startPlanning } from "../server/src/domain/sprint.ts";
import { addDays, today, weekStart } from "../server/src/domain/time.ts";

const path = process.argv[2] ?? "data/demo.db";
if (path.endsWith("agile.db")) throw new Error("refusing to overwrite a real database");
for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) rmSync(f);

const cfg = loadConfig({ ALLOWED_EMAILS: "deniz@demo.local:Deniz,ece@demo.local:Ece", DEV_LOGIN: "1" });
const db = openDb(path);
seedUsers(db, cfg);
const app = createApp(db, cfg);
const DENIZ = 1;
const ECE = 2;
const cookie = { [DENIZ]: `la_session=${createSession(db, DENIZ).id}`, [ECE]: `la_session=${createSession(db, ECE).id}` };

async function call<T = any>(as: number, method: string, url: string, body?: unknown): Promise<T> {
  const r = await app.request(url, {
    method,
    headers: { cookie: cookie[as], "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

const cat = (name: string) => (db.prepare("SELECT id FROM categories WHERE name = ?").get(name) as { id: number }).id;
const now = today();
const thisWeek = weekStart(now);
const lastWeek = addDays(thisWeek, -7);
const day = (base: string, i: number) => addDays(base, i);

type T = { title: string; who: number[]; sp?: number; cat?: string; priority?: number; due?: string; desc?: string };
async function task(as: number, sprintId: number | null, t: T) {
  return call(as, "POST", "/api/tasks", {
    title: t.title,
    assigneeIds: t.who,
    ...(sprintId ? { sprintId } : {}),
    ...(t.sp !== undefined ? { sp: t.sp } : {}),
    ...(t.cat ? { categoryId: cat(t.cat) } : {}),
    ...(t.priority !== undefined ? { priority: t.priority } : {}),
    ...(t.due ? { dueDate: t.due } : {}),
    ...(t.desc ? { description: t.desc } : {}),
  });
}
const part = (as: number, id: number, date: string, startTime?: string, endTime?: string) =>
  call(as, "POST", `/api/tasks/${id}/blocks`, { date, startTime, endTime });
const mark = (as: number, blockId: number, status: "done" | "missed") => call(as, "PATCH", `/api/blocks/${blockId}`, { status });
const patch = (as: number, id: number, body: unknown) => call(as, "PATCH", `/api/tasks/${id}`, body);

// Recurring rules (occurrences are created when a sprint enters grooming).
await call(DENIZ, "POST", "/api/recurring", { title: "Sabah koşusu", freq: "weekly", weekdaysMask: 0b0010101, startTime: "07:00", endTime: "07:45", assigneeIds: [DENIZ], defaultSp: 1, categoryId: cat("Sağlık") });
await call(ECE, "POST", "/api/recurring", { title: "Kitap okuma", freq: "weekdays", startTime: "22:00", endTime: "22:30", assigneeIds: [ECE], defaultSp: 0.5, categoryId: cat("Kişisel") });
await call(DENIZ, "POST", "/api/recurring", { title: "Haftalık market", freq: "weekly", weekdaysMask: 1 << 5, startTime: "11:00", endTime: "12:00", assigneeIds: [DENIZ, ECE], defaultSp: 1, categoryId: cat("Ev") });

// Backlog.
for (const t of [
  { title: "Balkon için saksı ve toprak al", who: [ECE], cat: "Ev", sp: 1 },
  { title: "Yaz tatili için otel araştır", who: [DENIZ, ECE], cat: "Sosyal", sp: 2 },
  { title: "Eski kıyafetleri bağışla", who: [DENIZ], cat: "Ev", sp: 1 },
  { title: "Kredi kartı aidatını sorgula", who: [ECE], cat: "Finans", sp: 0.5, priority: 2 },
  { title: "Fotoğraf albümü bastır", who: [DENIZ, ECE], cat: "Kişisel", sp: 3 },
] satisfies T[])
  await task(DENIZ, null, t);

// Sprint 1 (last week): planned, worked, closed.
const s1 = startPlanning(db, lastWeek);
setStep(db, "grooming");
const s1Tasks = [];
for (const t of [
  { title: "Kombi bakımını yaptır", who: [DENIZ], cat: "Ev", sp: 2 },
  { title: "Diş hekimi randevusu", who: [ECE], cat: "Sağlık", sp: 1 },
  { title: "Vergi beyannamesini hazırla", who: [ECE], cat: "Finans", sp: 3, priority: 2 },
  { title: "Annemlere akşam yemeği", who: [DENIZ, ECE], cat: "Sosyal", sp: 2 },
  { title: "Bisikleti tamire götür", who: [DENIZ], cat: "Kişisel", sp: 2 },
] satisfies T[])
  s1Tasks.push(await task(DENIZ, s1.id, t));
finishPlanning(db);
db.prepare("UPDATE sprints SET goal = ? WHERE id = ?").run("Evdeki bakım işlerini bitir", s1.id);
for (const m of [DENIZ, ECE]) db.prepare("UPDATE sprint_members SET target_sp = ? WHERE sprint_id = ? AND user_id = ?").run(8, s1.id, m);
await part(DENIZ, s1Tasks[0].id, day(lastWeek, 1), "18:00", "19:00");
await part(ECE, s1Tasks[1].id, day(lastWeek, 2), "10:00", "11:00");
await part(DENIZ, s1Tasks[3].id, day(lastWeek, 4), "19:30", "22:00");
for (const i of [0, 1, 3]) await patch(DENIZ, s1Tasks[i].id, { status: "done" });
await patch(ECE, s1Tasks[2].id, { status: "in_progress", progressManual: 60 });
for (const r of db.prepare("SELECT b.id, b.date FROM task_blocks b JOIN tasks t ON t.id = b.task_id WHERE t.sprint_id = ? AND t.recurring_rule_id IS NOT NULL").all(s1.id) as { id: number; date: string }[])
  await mark(DENIZ, r.id, r.date.endsWith("1") || r.date.endsWith("5") ? "missed" : "done");
for (const [kind, text, as] of [
  ["good", "Kombi işini erken bitirdik", DENIZ],
  ["bad", "Vergi işi son güne kaldı", ECE],
  ["try", "Büyük işleri parçalara bölelim", ECE],
] as const)
  await call(as, "POST", `/api/retro/${s1.id}`, { kind, text });

// Sprint 2 (this week): planning carries the unfinished tasks, then new work.
const s2 = startPlanning(db, now);
setStep(db, "grooming");
const s2Tasks: Record<string, any> = {};
for (const t of [
  { key: "odev", title: "İstatistik ödevini teslim et", who: [ECE], cat: "İş", sp: 3, priority: 2, due: day(thisWeek, 4), desc: "Konu: regresyon. Kaynakları kütüphaneden al, raporu PDF olarak yükle." },
  { key: "sunum", title: "Proje sunumunu hazırla", who: [DENIZ], cat: "İş", sp: 3, priority: 3, due: day(thisWeek, 3) },
  { key: "tadilat", title: "Mutfak dolabı tamiri için usta çağır", who: [DENIZ, ECE], cat: "Ev", sp: 2 },
  { key: "doktor", title: "Kan tahlili sonuçlarını al", who: [DENIZ], cat: "Sağlık", sp: 1 },
  { key: "dogum", title: "Ali'nin doğum günü hediyesi", who: [DENIZ, ECE], cat: "Sosyal", sp: 1, due: day(thisWeek, 5) },
  { key: "butce", title: "Aylık bütçe tablosunu güncelle", who: [ECE], cat: "Finans", sp: 2 },
  { key: "dil", title: "İspanyolca kursuna kaydol", who: [DENIZ], cat: "Kişisel", sp: 0.5 },
] satisfies (T & { key: string })[])
  s2Tasks[t.key] = await task(ECE, s2.id, t);
finishPlanning(db);
db.prepare("UPDATE sprints SET goal = ? WHERE id = ?").run("Ödev ve sunumu zamanında teslim et", s2.id);
db.prepare("UPDATE sprint_members SET target_sp = ? WHERE sprint_id = ?").run(10, s2.id);

const p1 = await part(ECE, s2Tasks.odev.id, day(thisWeek, 0), "19:00", "21:00");
await part(ECE, s2Tasks.odev.id, day(thisWeek, 2), "20:00", "22:00");
await part(ECE, s2Tasks.odev.id, day(thisWeek, 3), "18:30", "20:30");
await mark(ECE, p1.id, "done");
const p2 = await part(DENIZ, s2Tasks.sunum.id, day(thisWeek, 1), "14:00", "17:00");
await part(DENIZ, s2Tasks.sunum.id, day(thisWeek, 3), "09:00", "12:00");
await mark(DENIZ, p2.id, "missed");
const p3 = await part(DENIZ, s2Tasks.doktor.id, day(thisWeek, 1), "08:30", "09:00");
await mark(DENIZ, p3.id, "done");
await part(DENIZ, s2Tasks.tadilat.id, day(thisWeek, 5), "13:00", "15:00");
await part(ECE, s2Tasks.butce.id, day(thisWeek, 4), "21:00", "22:00");
await patch(ECE, s2Tasks.odev.id, { status: "in_progress" });
await patch(DENIZ, s2Tasks.sunum.id, { status: "in_progress" });
await patch(DENIZ, s2Tasks.dil.id, { status: "done" });
for (const text of ["Kaynakça ekle", "Grafikleri çiz", "Sonuç bölümünü yaz"]) await call(ECE, "POST", `/api/tasks/${s2Tasks.odev.id}/checklist`, { text });
const items = db.prepare("SELECT id FROM checklist_items WHERE task_id = ? ORDER BY id").all(s2Tasks.odev.id) as { id: number }[];
await call(ECE, "PATCH", `/api/checklist/${items[0].id}`, { done: true });
await call(DENIZ, "POST", `/api/tasks/${s2Tasks.odev.id}/comments`, { body: "Grafikler için yardım edebilirim, akşam bakalım mı?" });
await call(ECE, "POST", `/api/tasks/${s2Tasks.odev.id}/comments`, { body: "Olur, Çarşamba 20:00 uygun." });
const extra = await task(DENIZ, s2.id, { title: "Arabanın lastiklerini değiştir", who: [DENIZ], cat: "Kişisel", sp: 1 }); // added mid-sprint: unplanned
await part(DENIZ, extra.id, day(thisWeek, 5), "10:00", "11:00");

// Recurring occurrences of this week: past days marked.
for (const r of db.prepare("SELECT b.id, b.date FROM task_blocks b JOIN tasks t ON t.id = b.task_id WHERE t.sprint_id = ? AND t.recurring_rule_id IS NOT NULL AND b.date < ?").all(s2.id, now) as { id: number; date: string }[])
  await mark(DENIZ, r.id, r.date === day(thisWeek, 1) ? "missed" : "done");

// Calendar events.
await call(DENIZ, "POST", "/api/calendar-events", { title: "Dişçi", kind: "out", date: day(thisWeek, 3), startTime: "16:00", endTime: "17:00", attendeeIds: [ECE] });
await call(ECE, "POST", "/api/calendar-events", { title: "Arkadaşlar akşam yemeğinde", kind: "guest", date: day(thisWeek, 4), startTime: "19:30", endTime: "23:00", attendeeIds: [DENIZ, ECE] });
await call(DENIZ, "POST", "/api/calendar-events", { title: "Ekip toplantısı", kind: "meet", date: day(thisWeek, 0), startTime: "10:00", endTime: "11:00", attendeeIds: [DENIZ], repeat: { freq: "weekly", weekdaysMask: 1 } });

db.close();
console.log(`[demo] wrote ${path}: users Deniz and Ece, sprint ${s1.number} closed, sprint ${s2.number} active`);
process.exit(0);
