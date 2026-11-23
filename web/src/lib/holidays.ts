// Public holidays by date for the calendars (shared/holidays.ts; country from the bootstrap).
import { holidaysBetween, type Holiday } from "@shared/holidays.ts";
import { useMemo } from "react";
import { useStore } from "./store";

export function useHolidays(from: string, to: string): Map<string, Holiday[]> {
  const { state } = useStore();
  return useMemo(() => {
    const m = new Map<string, Holiday[]>();
    if (!from || !to) return m;
    for (const h of holidaysBetween(from, to, state.holidays)) m.set(h.date, [...(m.get(h.date) ?? []), h]);
    return m;
  }, [from, to, state.holidays]);
}

/** Small holiday label for day headers. */
export function holidayLabel(list: Holiday[] | undefined): string | null {
  if (!list?.length) return null;
  return list.map((h) => h.name).join(" · ");
}
