// Date helpers on YYYY-MM-DD strings (local dates in the app time zone, from the bootstrap).

let appTimeZone = "Europe/Istanbul";

/** Sets the app time zone (from /api/bootstrap). */
export function setAppTimeZone(tz: string): void {
  appTimeZone = tz;
}

export function getAppTimeZone(): string {
  return appTimeZone;
}
import { format, parseISO } from "date-fns";
import { tr } from "date-fns/locale";

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function weekStart(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

export function weekDates(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function fmt(date: string, pattern: string): string {
  return format(parseISO(date), pattern, { locale: tr });
}

/** "16 Kas" */
export const shortDate = (d: string) => fmt(d, "d MMM");
/** "16 Kasım Pazartesi" */
export const longDate = (d: string) => fmt(d, "d MMMM EEEE");

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(min: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Local date of now in the app time zone. */
export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: appTimeZone }).format(new Date());
}

export function relativeTime(iso: string): string {
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 60) return "az önce";
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} sa önce`;
  return `${Math.floor(diff / 86400)} gün önce`;
}
