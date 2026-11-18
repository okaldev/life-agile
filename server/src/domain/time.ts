// Date helpers. All day logic uses local dates (YYYY-MM-DD) in the app time zone (APP_TIMEZONE, default Europe/Istanbul).

let TZ = "Europe/Istanbul";
let fmt = makeFormat(TZ);

function makeFormat(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

/** Sets the app time zone. Called once at boot from the config. */
export function setTimeZone(timeZone: string): void {
  TZ = timeZone;
  fmt = makeFormat(timeZone);
}

export function timeZone(): string {
  return TZ;
}

export interface LocalNow {
  date: string;
  time: string;
  weekday: number; // 0 = Monday ... 6 = Sunday
}

export function localNow(at: Date = new Date()): LocalNow {
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, time: `${parts.hour}:${parts.minute}`, weekday: weekdayIndex(date) };
}

export function today(at: Date = new Date()): string {
  return localNow(at).date;
}

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(date: string): number {
  return (toUtc(date).getUTCDay() + 6) % 7;
}

export function weekStart(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

export function weekDates(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** Offset of the app time zone from UTC at a moment, in minutes. */
function offsetMinutes(at: Date): number {
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** Converts a local date + HH:MM in the app time zone to a UTC Date (DST-safe). */
export function localToUtc(date: string, time: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const first = new Date(guess.getTime() - offsetMinutes(guess) * 60_000);
  // A second pass fixes times near a DST change.
  return new Date(guess.getTime() - offsetMinutes(first) * 60_000);
}

/**
 * Week of the next sprint.
 * - After an active sprint: the week after it, but never a week that is already over.
 * - Without an active sprint: the current week (Monday..Sunday). Only on Sunday the next week,
 *   because Sunday evening is the planning time for the coming week.
 */
export function nextSprintStart(activeEnd: string | null, todayDate: string): string {
  let start = weekStart(todayDate);
  if (weekdayIndex(todayDate) === 6) start = addDays(start, 7);
  if (activeEnd) {
    const afterActive = addDays(activeEnd, 1);
    if (afterActive > start) start = weekStart(afterActive);
  }
  return start;
}
