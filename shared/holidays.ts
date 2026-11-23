// Public holidays shown on all calendars and used as off days in capacity. Country from HOLIDAYS (default TR).
// Turkey: fixed national days + Ramazan and Kurban Bayramı (Hijri calendar). Bayram start dates for 2025-2030
// are listed (Diyanet); other years use the Umm al-Qura calendar (Intl), which gives the same dates for 2025-2030.

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
  /** Half day (arife from 13:00). */
  half?: boolean;
}

const FIXED_TR: [string, string][] = [
  ["01-01", "Yılbaşı"],
  ["04-23", "Ulusal Egemenlik ve Çocuk Bayramı"],
  ["05-01", "Emek ve Dayanışma Günü"],
  ["05-19", "Atatürk'ü Anma, Gençlik ve Spor Bayramı"],
  ["07-15", "Demokrasi ve Millî Birlik Günü"],
  ["08-30", "Zafer Bayramı"],
  ["10-29", "Cumhuriyet Bayramı"],
];

// First day of Ramazan Bayramı and of Kurban Bayramı.
const BAYRAM_TR: Record<number, [string, string]> = {
  2025: ["2025-03-30", "2025-06-06"],
  2026: ["2026-03-20", "2026-05-27"],
  2027: ["2027-03-09", "2027-05-16"],
  2028: ["2028-02-26", "2028-05-05"],
  2029: ["2029-02-14", "2029-04-24"],
  2030: ["2030-02-04", "2030-04-13"],
};

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Bayram start dates of a year from the Umm al-Qura calendar (1 Shawwal, 10 Dhu al-Hijjah). */
function bayramFromCalendar(year: number): [string, string] {
  const f = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { month: "numeric", day: "numeric", timeZone: "UTC" });
  let ramazan = "";
  let kurban = "";
  for (let d = `${year}-01-01`; d.startsWith(String(year)); d = addDays(d, 1)) {
    const p = Object.fromEntries(f.formatToParts(new Date(`${d}T12:00:00Z`)).map((x) => [x.type, x.value]));
    if (p.month === "10" && p.day === "1") ramazan = d;
    if (p.month === "12" && p.day === "10") kurban = d;
  }
  return [ramazan, kurban];
}

function turkey(year: number): Holiday[] {
  const list: Holiday[] = FIXED_TR.map(([md, name]) => ({ date: `${year}-${md}`, name }));
  list.push({ date: `${year}-10-28`, name: "Cumhuriyet Bayramı arifesi", half: true });
  const [ramazan, kurban] = BAYRAM_TR[year] ?? bayramFromCalendar(year);
  if (ramazan) {
    list.push({ date: addDays(ramazan, -1), name: "Ramazan Bayramı arifesi", half: true });
    for (let i = 0; i < 3; i++) list.push({ date: addDays(ramazan, i), name: `Ramazan Bayramı ${i + 1}. gün` });
  }
  if (kurban) {
    list.push({ date: addDays(kurban, -1), name: "Kurban Bayramı arifesi", half: true });
    for (let i = 0; i < 4; i++) list.push({ date: addDays(kurban, i), name: `Kurban Bayramı ${i + 1}. gün` });
  }
  return list;
}

/** Holidays between two dates (inclusive), sorted. A day can have more than one entry. */
export function holidaysBetween(from: string, to: string, country: string | null = "TR"): Holiday[] {
  if (country !== "TR") return [];
  const out: Holiday[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++)
    for (const h of turkey(y)) if (h.date >= from && h.date <= to) out.push(h);
  return out.sort((a, b) => a.date.localeCompare(b.date) || Number(!!a.half) - Number(!!b.half));
}
