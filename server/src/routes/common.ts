import type { Context } from "hono";
import type { ServerEventType, Task } from "../../../shared/types.ts";
import type { AppEnv } from "../auth/auth.ts";
import type { DB } from "../db/db.ts";
import { mapActivity } from "../db/repo.ts";
import { broadcast } from "../realtime/hub.ts";

export type C = Context<AppEnv>;

export class HttpError extends Error {
  status: 400 | 403 | 404 | 409;
  constructor(status: 400 | 403 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}

export function emit<T>(c: C, type: ServerEventType, data: T): void {
  broadcast(type, data, c.get("user").id, c.get("clientId"));
}

export function logActivity(
  db: DB,
  c: C,
  action: string,
  entity: string,
  entityId: number | null,
  summary: string,
): void {
  const res = db
    .prepare("INSERT INTO activity (user_id, action, entity, entity_id, summary) VALUES (?, ?, ?, ?, ?)")
    .run(c.get("user").id, action, entity, entityId, summary);
  db.prepare("DELETE FROM activity WHERE id <= ?").run(Number(res.lastInsertRowid) - 1000);
  const row = db.prepare("SELECT * FROM activity WHERE id = ?").get(res.lastInsertRowid);
  broadcast("activity", mapActivity(row as any), c.get("user").id, null);
}

export async function body(c: C): Promise<Record<string, any>> {
  try {
    const b = await c.req.json();
    if (b && typeof b === "object") return b;
  } catch {}
  throw new HttpError(400, "invalid json");
}

export function idParam(c: C, name = "id"): number {
  const n = Number(c.req.param(name));
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `bad ${name}`);
  return n;
}

export const SP_VALUES = [0, 0.5, 1, 2, 3, 4, 5];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const v = {
  str(x: unknown, field: string, max = 2000): string {
    if (typeof x !== "string") throw new HttpError(400, `${field} must be text`);
    const s = x.trim();
    if (s.length > max) throw new HttpError(400, `${field} too long`);
    return s;
  },
  date(x: unknown, field: string): string | null {
    if (x === null || x === undefined || x === "") return null;
    if (typeof x !== "string" || !DATE.test(x)) throw new HttpError(400, `${field} must be YYYY-MM-DD`);
    return x;
  },
  time(x: unknown, field: string): string | null {
    if (x === null || x === undefined || x === "") return null;
    if (typeof x !== "string" || !TIME.test(x)) throw new HttpError(400, `${field} must be HH:MM`);
    return x;
  },
  int(x: unknown, field: string, min: number, max: number, nullable = true): number | null {
    if ((x === null || x === undefined) && nullable) return null;
    if (typeof x !== "number" || !Number.isInteger(x) || x < min || x > max)
      throw new HttpError(400, `${field} must be ${min}-${max}`);
    return x;
  },
  /** Story points: 0, 0.5, 1, 2, 3, 4, 5 or null. */
  points(x: unknown, field: string): number | null {
    if (x === null || x === undefined) return null;
    if (typeof x !== "number" || !SP_VALUES.includes(x)) throw new HttpError(400, `${field} must be one of ${SP_VALUES.join(", ")}`);
    return x;
  },
  ids(x: unknown, field: string): number[] {
    if (!Array.isArray(x) || x.some((n) => !Number.isInteger(n))) throw new HttpError(400, `${field} must be ids`);
    return [...new Set(x as number[])];
  },
};

export function shortTitle(t: Pick<Task, "title">): string {
  return t.title.length > 40 ? `${t.title.slice(0, 39)}…` : t.title;
}

/** Validates the end date of a multi-day item: after the start, at most 31 days. Null for one day. */
export function spanEnd(date: string, x: unknown): string | null {
  const end = v.date(x ?? null, "endDate");
  if (!end || end <= date) return null;
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
  if (days > 31) throw new HttpError(400, "a multi-day item can last at most 32 days");
  return end;
}
