// "Planlanan hafta": the week of the planned sprint, day by day (holidays, leave, events, task parts).
// Read-only overview for the planning wizard. See openwiki/sprint-flow.md.
import type { Availability, CalendarEvent, Sprint, Task } from "@shared/types.ts";
import { CalendarRange, ChevronDown, Repeat } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmt, weekDates } from "@/lib/dates";
import { useHolidays } from "@/lib/holidays";
import { useStore } from "@/lib/store";
import { WEEKDAY_SHORT } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { kindMeta } from "../calendar/eventMeta";
import { timeLabel } from "../calendar/CalendarDialogs";
import { OwnerStrip } from "../common";
import { useTaskDialog } from "../TaskDialog";
import { useAvailability } from "./EstimationStep";

type Entry = { key: string; time: string; title: string; sub: string; ids: number[]; color?: string; recurring?: boolean; taskId?: number };

export function PlanWeek({ sprint }: { sprint: Sprint }) {
  const { state } = useStore();
  const { openTask } = useTaskDialog();
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem("la.planWeek") !== "0";
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem("la.planWeek", open ? "0" : "1");
    } catch {}
  };
  const days = weekDates(sprint.startDate);
  const holidays = useHolidays(sprint.startDate, sprint.endDate);
  const avail: Availability[] = useAvailability(sprint.startDate, sprint.endDate);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const v = state.versions;
  useEffect(() => {
    void api.get<CalendarEvent[]>(`/api/calendar-events?from=${sprint.startDate}&to=${sprint.endDate}`).then(setEvents);
  }, [sprint.startDate, sprint.endDate, v["calendarEvent.upsert"], v["calendarEvent.delete"], v["eventRules.changed"]]);

  const sprintTasks = useMemo(
    () => Object.values(state.tasks).filter((t) => t.sprintId === sprint.id && !t.cancelledAt),
    [state.tasks, sprint.id],
  );
  const undated = sprintTasks.filter((t) => t.blocks.length === 0 && !t.recurringRuleId).length;

  const byDay = useMemo(() => {
    const m = new Map<string, Entry[]>(days.map((d) => [d, []]));
    for (const t of Object.values(state.tasks) as Task[]) {
      if (t.cancelledAt) continue;
      for (const b of t.blocks) {
        for (const d of days) {
          if (d < b.date || d > (b.endDate ?? b.date)) continue;
          m.get(d)!.push({
            key: `b${b.id}${d}`,
            time: b.startTime ?? "",
            title: t.title,
            sub: b.endDate ? `${fmt(b.date, "d")}–${fmt(b.endDate, "d MMM")}` : b.startTime ? timeLabel(b) : "tüm gün",
            ids: t.assigneeIds,
            color: state.categories.find((c) => c.id === t.categoryId)?.color,
            recurring: !!t.recurringRuleId,
            taskId: t.id,
          });
        }
      }
    }
    for (const e of events)
      for (const d of days) {
        if (d < e.date || d > (e.endDate ?? e.date)) continue;
        const sub = e.endDate ? `${fmt(e.date, "d")}–${fmt(e.endDate, "d MMM")}` : e.startTime ? timeLabel(e) : "tüm gün";
        m.get(d)!.push({
          key: `e${e.id}${d}`,
          time: e.startTime ?? "",
          title: e.title,
          sub,
          ids: e.attendeeIds,
          color: kindMeta(e.kind).color,
        });
      }
    for (const list of m.values()) list.sort((a, b) => a.time.localeCompare(b.time));
    return m;
  }, [state.tasks, state.categories, events, days.join()]);

  return (
    <section className="rounded-lg border">
      <button type="button" onClick={toggle} className="flex w-full items-center gap-2 px-3 py-2 text-sm" aria-expanded={open}>
        <CalendarRange className="size-4 text-muted-foreground" />
        <span className="font-medium">Planlanan hafta</span>
        <span className="text-xs text-muted-foreground">
          {fmt(sprint.startDate, "d MMM")} – {fmt(sprint.endDate, "d MMM")}
          {undated > 0 && ` · ${undated} görevin takvimde yeri yok`}
        </span>
        <ChevronDown className={cn("ml-auto size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="thin-scroll overflow-x-auto border-t">
          <div className="grid min-w-[52rem] grid-cols-7 divide-x">
            {days.map((d, i) => {
              const hol = holidays.get(d);
              const leave = avail.filter((a) => a.date === d);
              return (
                <div key={d} className={cn("min-h-32 space-y-1 p-1.5", hol?.some((h) => !h.half) && "bg-rose-500/5")}>
                  <div className={cn("flex items-baseline gap-1 text-xs", d === state.today && "font-semibold text-primary")}>
                    {WEEKDAY_SHORT[i]} <span className="text-muted-foreground">{fmt(d, "d MMM")}</span>
                  </div>
                  {hol?.map((h) => (
                    <div
                      key={h.name}
                      className="truncate rounded bg-rose-500/10 px-1 py-0.5 text-[10px] text-rose-700 dark:text-rose-300"
                      title={h.name}
                    >
                      {h.half ? "½ " : ""}
                      {h.name}
                    </div>
                  ))}
                  {leave.map((a) => (
                    <div
                      key={a.userId}
                      className="truncate rounded bg-amber-500/10 px-1 py-0.5 text-[10px] text-amber-700 dark:text-amber-300"
                    >
                      {state.users.find((u) => u.id === a.userId)?.name} · {a.kind === "off" ? "izinli" : "yarım gün"}
                    </div>
                  ))}
                  {byDay.get(d)!.map((e) => (
                    <button
                      key={e.key}
                      type="button"
                      disabled={!e.taskId}
                      onClick={() => e.taskId && openTask(e.taskId)}
                      className="relative block w-full overflow-hidden rounded border bg-card py-0.5 pr-1 pl-2 text-left text-[11px] leading-tight enabled:hover:bg-accent"
                    >
                      <OwnerStrip ids={e.ids} />
                      <span className="flex items-center gap-1 truncate font-medium">
                        {e.color && <span className="size-1.5 shrink-0 rounded-full" style={{ background: e.color }} />}
                        {e.recurring && <Repeat className="size-2.5 shrink-0 text-muted-foreground" />}
                        <span className="truncate">{e.title}</span>
                      </span>
                      <span className="text-muted-foreground">{e.sub}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
