// In-memory SSE hub and presence. See openwiki/realtime.md.
import type { Presence, ServerEvent, ServerEventType } from "../../../shared/types.ts";

export interface Client {
  userId: number;
  send: (event: string, data: string) => void;
}

const clients = new Set<Client>();
const presence = new Map<number, Presence>();

export function addClient(c: Client): () => void {
  clients.add(c);
  touchPresence(c.userId, {});
  return () => {
    clients.delete(c);
    if (!isOnline(c.userId)) {
      const p = presence.get(c.userId);
      if (p) {
        p.online = false;
        p.at = new Date().toISOString();
        broadcast("presence", p, c.userId, null);
      }
    }
  };
}

export function isOnline(userId: number): boolean {
  for (const c of clients) if (c.userId === userId) return true;
  return false;
}

export function broadcast<T>(type: ServerEventType, data: T, by: number | null, clientId: string | null): void {
  const payload: ServerEvent<T> = { type, data, by, clientId };
  const text = JSON.stringify(payload);
  for (const c of clients) {
    try {
      c.send("message", text);
    } catch {
      clients.delete(c);
    }
  }
}

export function touchPresence(
  userId: number,
  update: { page?: string | null; taskId?: number | null; hover?: string | null },
): Presence {
  const prev = presence.get(userId);
  const p: Presence = {
    userId,
    page: update.page !== undefined ? update.page : (prev?.page ?? null),
    taskId: update.taskId !== undefined ? update.taskId : (prev?.taskId ?? null),
    // A page change clears the hover target.
    hover: update.hover !== undefined ? update.hover : update.page !== undefined && update.page !== prev?.page ? null : (prev?.hover ?? null),
    online: isOnline(userId),
    at: new Date().toISOString(),
  };
  presence.set(userId, p);
  broadcast("presence", p, userId, null);
  return p;
}

export function listPresence(): Presence[] {
  return [...presence.values()].map((p) => ({ ...p, online: isOnline(p.userId) }));
}

export function clientCount(): number {
  return clients.size;
}
