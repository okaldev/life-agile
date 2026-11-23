import type { EventKind, MarkStatus } from "@shared/types.ts";
import { Ban, CalendarDays, DoorOpen, MapPin, Users, type LucideIcon } from "lucide-react";
import { getAppTimeZone } from "@/lib/dates";

export const EVENT_KINDS: { kind: EventKind; label: string; icon: LucideIcon; color: string }[] = [
  { kind: "meet", label: "Buluşma", icon: Users, color: "#8b5cf6" },
  { kind: "guest", label: "Misafir", icon: DoorOpen, color: "#f59e0b" },
  { kind: "out", label: "Dışarıda", icon: MapPin, color: "#10b981" },
  { kind: "busy", label: "Meşgul", icon: Ban, color: "#ef4444" },
  { kind: "other", label: "Diğer", icon: CalendarDays, color: "#64748b" },
];

export const kindMeta = (k: EventKind) => EVENT_KINDS.find((x) => x.kind === k) ?? EVENT_KINDS[4];

export const BLOCK_STATUS_LABEL: Record<MarkStatus, string> = {
  planned: "Planlandı",
  done: "Yapıldı",
  missed: "Yapılmadı",
};

export const EVENT_STATUS_LABEL: Record<MarkStatus, string> = {
  planned: "Planlandı",
  done: "Gerçekleşti",
  missed: "Gerçekleşmedi",
};

/** Local time in the app time zone as minutes since midnight. */
export function nowMinutes(): number {
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: getAppTimeZone(), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(),
  );
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

/** A planned item whose time is over and nobody marked it. */
export function isUnmarked(
  item: { date: string; endDate?: string | null; startTime: string | null; endTime: string | null; status: MarkStatus },
  today: string,
  nowMin: number,
): boolean {
  if (item.status !== "planned") return false;
  if (item.endDate) return item.endDate < today; // multi-day: open to marking until its last day is over
  if (item.date < today) return true;
  if (item.date > today || !item.startTime) return false;
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const end = item.endTime ? toMin(item.endTime) : toMin(item.startTime) + 60;
  return end <= nowMin;
}
