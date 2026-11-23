// Week calendar, 24 hours. Shows task parts (blocks) and general events. See openwiki/calendar.md.
// Desktop: drag on the grid to open the slot chooser, drag an item to move it, drag its bottom edge to resize,
// drag a sprint task from the side list onto the grid to add a part.
// Mobile: one day; tap a slot to open the slot chooser, tap an item to open it.
import type { CalendarEvent, Task, TaskBlock, User } from "@shared/types.ts";
import { AlertCircle, Check, ChevronLeft, ChevronRight, PanelRight, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { addDays, fmt, longDate, minutesToTime, timeToMinutes, weekDates, weekdayIndex, weekStart } from "@/lib/dates";
import { isActiveWork, matchesView, useStore, type ViewFilter } from "@/lib/store";
import { useHolidays } from "@/lib/holidays";
import { WEEKDAY_SHORT } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { CategoryDot, SpBadge, UserAvatar, ViewTabs } from "../common";
import { hoverProps, markStyle, usePartnerMark } from "@/lib/hover";
import { compareTasks } from "../TaskCard";
import { useTaskDialog } from "../TaskDialog";
import { SlotPanel, UnmarkedPanel, type Slot, type UnmarkedItem } from "./CalendarDialogs";
import { EventForm, type EventDraft } from "./EventDialog";
import { isUnmarked, kindMeta, nowMinutes } from "./eventMeta";

const START_H = 0;
const END_H = 24;
const HOUR_PX = 44;
const SNAP = 15;
const GRID_H = (END_H - START_H) * HOUR_PX;
const DAY_END = 24 * 60 - 1;

type Item =
  | { key: string; kind: "block"; date: string; endDate: string | null; startTime: string | null; endTime: string | null; status: TaskBlock["status"]; block: TaskBlock; task: Task }
  | { key: string; kind: "event"; date: string; endDate: string | null; startTime: string | null; endTime: string | null; status: CalendarEvent["status"]; event: CalendarEvent };

type Drag =
  | { kind: "create"; day: number; from: number; to: number }
  | { kind: "move"; item: Item; day: number; start: number; dur: number; grab: number; moved: boolean }
  | { kind: "resize"; item: Item; day: number; start: number; end: number };

type Panel =
  | { type: "slot"; slot: Slot }
  | { type: "event"; draft: EventDraft }
  | { type: "unmarked" };

/** Events of 8 hours or more are drawn as a day background instead of a column item. */
const BACKGROUND_MINUTES = 8 * 60;
const isBackground = (i: Item) =>
  i.kind === "event" && !!i.startTime && !!i.endTime && itemEnd(i) - itemStart(i) >= BACKGROUND_MINUTES;

const snap = (m: number) => Math.round(m / SNAP) * SNAP;
const clampMin = (m: number) => Math.max(START_H * 60, Math.min(END_H * 60, m));
const itemStart = (i: Item) => timeToMinutes(i.startTime!);
const itemEnd = (i: Item) => (i.endTime ? timeToMinutes(i.endTime) : itemStart(i) + 60);

function useIsMobile(): boolean {
  const [m, setM] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 767px)");
    const on = () => setM(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return m;
}

function eventMatchesView(e: CalendarEvent, view: ViewFilter): boolean {
  if (view === "all") return true;
  if (view === "shared") return e.attendeeIds.length > 1;
  return e.attendeeIds.includes(view);
}

/** Side-by-side columns for overlapping timed items of one day. */
function layoutDay(items: Item[]): Map<string, { col: number; cols: number }> {
  const sorted = [...items].sort((a, b) => itemStart(a) - itemStart(b) || itemEnd(b) - itemEnd(a));
  const out = new Map<string, { col: number; cols: number }>();
  let cluster: Item[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const t of cluster) out.get(t.key)!.cols = colEnds.length;
    cluster = [];
    colEnds = [];
  };
  for (const t of sorted) {
    if (itemStart(t) >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= itemStart(t));
    if (col === -1) col = colEnds.push(0) - 1;
    colEnds[col] = itemEnd(t);
    clusterEnd = Math.max(clusterEnd, itemEnd(t));
    cluster.push(t);
    out.set(t.key, { col, cols: 1 });
  }
  flush();
  return out;
}

/** Who an item belongs to: a person-color strip on the right edge and initial badges in the top-right corner. */
/** Who an item belongs to: a soft person-color strip on the right edge and photo badges in the top-right corner. */
function PersonMarks({ people }: { people: User[] }) {
  if (people.length === 0) return null;
  const strip =
    people.length === 1
      ? people[0].color
      : `linear-gradient(to bottom, ${people.map((u, i) => `${u.color} ${(i * 100) / people.length}% ${((i + 1) * 100) / people.length}%`).join(", ")})`;
  return (
    <>
      <span className="pointer-events-none absolute inset-y-0 right-0 w-[3px] opacity-70" style={{ background: strip }} aria-hidden />
      <span className="pointer-events-none absolute top-0.5 right-1.5 hidden -space-x-1 @[64px]:flex" aria-hidden>
        {people.map((u) => (
          <UserAvatar key={u.id} user={u} className="size-3.5 text-[7px] ring-1 ring-background" />
        ))}
      </span>
    </>
  );
}

function hatch(color: string): React.CSSProperties {
  return {
    backgroundImage: `repeating-linear-gradient(135deg, color-mix(in oklab, ${color} 22%, transparent) 0 6px, color-mix(in oklab, ${color} 10%, transparent) 6px 12px)`,
  };
}

function ItemBox({
  item,
  style,
  unmarked,
  ghost,
  onPointerDown,
  onResizeDown,
  onClick,
  compact,
}: {
  item: Item;
  style?: React.CSSProperties;
  unmarked: boolean;
  ghost?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onResizeDown?: (e: React.PointerEvent) => void;
  onClick?: () => void;
  compact?: boolean;
}) {
  const { state } = useStore();
  const markKey = item.kind === "block" ? `task:${item.task.id}` : `event:${item.event.id}`;
  const mark = usePartnerMark(markKey);
  const share = hoverProps(markKey);
  const isEvent = item.kind === "event";
  const meta = isEvent ? kindMeta(item.event.kind) : null;
  const category = !isEvent ? state.categories.find((c) => c.id === item.task.categoryId) : null;
  const color = meta?.color ?? category?.color ?? "#64748b";
  const title = isEvent ? item.event.title : item.task.title;
  const parts = !isEvent && item.task.blocks.length > 1 ? `${item.task.blocks.findIndex((b) => b.id === item.block.id) + 1}/${item.task.blocks.length}` : null;
  const Icon = meta?.icon;
  const people = (isEvent ? item.event.attendeeIds : item.task.assigneeIds)
    .map((id) => state.users.find((u) => u.id === id))
    .filter((u): u is User => !!u);
  const height = typeof style?.height === "number" ? style.height : 40;
  return (
    <div
      onPointerEnter={share.onPointerEnter}
      onPointerLeave={share.onPointerLeave}
      onPointerDown={(e) => {
        share.onPointerDown(e);
        onPointerDown?.(e);
      }}
      onClick={onClick}
      className={cn(
        "overflow-hidden rounded-md py-0.5 pl-1.5 text-[11px] leading-tight select-none",
        // Container query: the photo badges show (and take room) only when the item is at least 64 px wide.
        "@container pr-1.5",
        people.length > 1 ? "@[64px]:pr-9" : "@[64px]:pr-5",
        compact ? "relative" : "absolute",
        item.status === "done" && "opacity-55",
        item.status === "missed" && "opacity-60",
        unmarked && "outline-2 outline-offset-[-2px] outline-amber-500 outline-dashed",
        ghost ? "pointer-events-none opacity-70 shadow-lg" : "cursor-pointer",
        mark && "ring-2",
      )}
      style={{
        backgroundColor: isEvent ? undefined : `color-mix(in oklab, ${color} 18%, var(--background))`,
        ...(isEvent ? { ...hatch(color), backgroundColor: "var(--background)" } : {}),
        ...markStyle(mark),
        ...style,
      }}
      title={`${title} · ${people.map((u) => u.name).join(" + ")}`}
    >
      <p className={cn("flex items-center gap-1 truncate font-medium", item.status === "missed" && "text-red-600 line-through dark:text-red-400")}>
        {item.status === "done" && <Check className="size-3 shrink-0 text-emerald-600" />}
        {item.status === "missed" && <X className="size-3 shrink-0" />}
        {Icon && <Icon className="size-3 shrink-0" />}
        {!isEvent && category && <CategoryDot category={category} className="size-1.5" />}
        <span className="truncate">{title}</span>
        {parts && <span className="shrink-0 font-normal text-muted-foreground">{parts}</span>}
      </p>
      {!compact && height >= 30 && (
        <p className="truncate text-muted-foreground">
          {item.startTime}
          {item.endTime && `–${item.endTime}`}
        </p>
      )}
      <PersonMarks people={people} />
      {mark && !ghost && (
        <span
          className="pointer-events-none absolute bottom-0.5 left-1.5 rounded px-1 text-[9px] leading-tight font-medium text-white"
          style={{ backgroundColor: mark.color }}
        >
          {mark.name}
        </span>
      )}
      {onResizeDown && <div onPointerDown={onResizeDown} className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize" aria-hidden />}
    </div>
  );
}

/** A multi-day task part or event as one bar across its days. */
function SpanBar({ item, style, cutStart, cutEnd, onClick }: { item: Item; style: React.CSSProperties; cutStart: boolean; cutEnd: boolean; onClick: () => void }) {
  const { state } = useStore();
  const isEvent = item.kind === "event";
  const meta = isEvent ? kindMeta(item.event.kind) : null;
  const category = !isEvent ? state.categories.find((c) => c.id === item.task.categoryId) : null;
  const color = meta?.color ?? category?.color ?? "#64748b";
  const title = isEvent ? item.event.title : item.task.title;
  const Icon = meta?.icon;
  const ids = isEvent ? item.event.attendeeIds : item.task.assigneeIds;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${title} · ${fmt(item.date, "d MMM")} – ${fmt(item.endDate!, "d MMM")}`}
      className={cn(
        "relative flex h-5 min-w-0 items-center gap-1 overflow-hidden px-1.5 text-left text-[11px] font-medium",
        cutStart ? "rounded-l-none" : "rounded-l-md",
        cutEnd ? "rounded-r-none" : "rounded-r-md",
        item.status === "done" && "opacity-55",
        item.status === "missed" && "text-red-600 line-through opacity-60 dark:text-red-400",
      )}
      style={{ ...style, ...(isEvent ? { ...hatch(color), backgroundColor: "var(--background)" } : { backgroundColor: `color-mix(in oklab, ${color} 22%, var(--background))` }) }}
    >
      {item.status === "done" && <Check className="size-3 shrink-0 text-emerald-600" />}
      {Icon && <Icon className="size-3 shrink-0" />}
      {!isEvent && category && <CategoryDot category={category} className="size-1.5" />}
      <span className="truncate">{title}</span>
      <span className="shrink-0 font-normal text-muted-foreground">
        {fmt(item.date, "d")}–{fmt(item.endDate!, "d MMM")}
      </span>
      <span className="ml-auto flex shrink-0 -space-x-1">
        {ids.map((id) => {
          const u = state.users.find((x) => x.id === id);
          return u ? <span key={id} className="size-2 rounded-full ring-1 ring-background" style={{ background: u.color }} /> : null;
        })}
      </span>
    </button>
  );
}

export default function CalendarPage() {
  const { state, dispatch } = useStore();
  const { openTask, openNew } = useTaskDialog();
  const mobile = useIsMobile();
  // Day or week view. Default by screen width (wide: week, narrow: day); the toggle changes it for this visit.
  const [dayView, setDayView] = useState(() => window.matchMedia("(max-width: 1023px)").matches);
  const baseWeek = state.activeSprint?.startDate ?? weekStart(state.today);
  const [week, setWeek] = useState(baseWeek);
  const [day, setDay] = useState(() => Math.max(0, Math.min(6, Math.round((Date.parse(state.today) - Date.parse(baseWeek)) / 86_400_000))));
  const [drag, setDrag] = useState<Drag | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [fetchedTasks, setFetchedTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [nowMin, setNowMin] = useState(nowMinutes);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Height of the sticky day header, so the labels of background events stick just below it.
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(64);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dates = weekDates(week);
  const holidays = useHolidays(dates[0], dates[6]);
  const shownDays = dayView ? [day] : [0, 1, 2, 3, 4, 5, 6];
  // "Sprint görevleri" side panel: default open on wide screens; the choice is remembered on this device.
  const [sidePanel, setSidePanel] = useState(() => {
    try {
      const saved = localStorage.getItem("la.calendarPanel");
      if (saved) return saved === "1";
    } catch {}
    return window.matchMedia("(min-width: 1280px)").matches;
  });
  const toggleSidePanel = () =>
    setSidePanel((open) => {
      try {
        localStorage.setItem("la.calendarPanel", open ? "0" : "1");
      } catch {}
      return !open;
    });
  // Arrows move one week in week view and one day in day view.
  const step = (dir: 1 | -1) => {
    if (!dayView) return setWeek(addDays(week, 7 * dir));
    const next = day + dir;
    if (next < 0) {
      setWeek(addDays(week, -7));
      setDay(6);
    } else if (next > 6) {
      setWeek(addDays(week, 7));
      setDay(0);
    } else setDay(next);
  };
  const goNow = () => {
    if (!dayView) return setWeek(baseWeek);
    setWeek(weekStart(state.today));
    setDay(weekdayIndex(state.today));
  };
  const v = state.versions;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 7 * HOUR_PX });
    const t = setInterval(() => setNowMin(nowMinutes()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Tasks of weeks outside the open sprints (closed sprints) come from the server.
  useEffect(() => {
    void api.get<Task[]>(`/api/calendar?from=${dates[0]}&to=${dates[6]}`).then(setFetchedTasks);
  }, [week, v["task.delete"], v["sprint.changed"]]);

  const loadEvents = useCallback(() => {
    void api.get<CalendarEvent[]>(`/api/calendar-events?from=${dates[0]}&to=${dates[6]}`).then(setEvents);
  }, [week]);
  useEffect(loadEvents, [loadEvents, v["calendarEvent.upsert"], v["calendarEvent.delete"], v["eventRules.changed"]]);

  const tasksById = useMemo(() => {
    const m = new Map<number, Task>();
    for (const t of fetchedTasks) m.set(t.id, t);
    for (const t of Object.values(state.tasks)) m.set(t.id, t);
    return m;
  }, [fetchedTasks, state.tasks]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const t of tasksById.values()) {
      if (!matchesView(t, state.view) || t.cancelledAt) continue;
      for (const b of t.blocks) {
        if (b.date > dates[6] || (b.endDate ?? b.date) < dates[0]) continue;
        out.push({ key: `b${b.id}`, kind: "block", date: b.date, endDate: b.endDate, startTime: b.startTime, endTime: b.endTime, status: b.status, block: b, task: t });
      }
    }
    for (const e of events) {
      if (!eventMatchesView(e, state.view)) continue;
      out.push({ key: `e${e.id}`, kind: "event", date: e.date, endDate: e.endDate, startTime: e.startTime, endTime: e.endTime, status: e.status, event: e });
    }
    return out;
  }, [tasksById, events, state.view, week]);

  const unmarked = useMemo(() => items.filter((i) => isUnmarked(i, state.today, nowMin)), [items, state.today, nowMin]);
  const unmarkedKeys = useMemo(() => new Set(unmarked.map((i) => i.key)), [unmarked]);

  const sprintFor = (date: string): number | null => {
    for (const s of [state.activeSprint, state.plannedSprint]) if (s && date >= s.startDate && date <= s.endDate) return s.id;
    return null;
  };
  const weekSprint = sprintFor(dates[0]);
  const sideTasks = Object.values(state.tasks)
    .filter(
      (t) =>
        (weekSprint === state.activeSprint?.id ? isActiveWork(t, state) : t.sprintId !== null && t.sprintId === weekSprint) &&
        t.status !== "done" &&
        !t.cancelledAt &&
        // A missed recurring occurrence is over; a normal task with a missed part is still open work.
        !(t.recurringRuleId && t.missedAt) &&
        // Recurring occurrences have their day, except "N times a week" ones: the user picks it here.
        (!t.recurringRuleId || t.blocks.length === 0) &&
        matchesView(t, state.view),
    )
    .sort(compareTasks);

  /** Pointer position to (day index, minutes). */
  const locate = (e: { clientX: number; clientY: number }): { day: number; min: number } => {
    const r = gridRef.current!.getBoundingClientRect();
    const col = Math.floor(((e.clientX - r.left) / r.width) * shownDays.length);
    const dayIdx = shownDays[Math.max(0, Math.min(shownDays.length - 1, col))];
    const min = clampMin(snap(START_H * 60 + ((e.clientY - r.top) / HOUR_PX) * 60));
    return { day: dayIdx, min };
  };

  const openItem = (it: Item) => {
    if (it.kind === "block") openTask(it.task.id, { blockId: it.block.id });
    else setPanel({ type: "event", draft: { ...it.event } });
  };

  // Local updates so a drag result shows at once; the server answer (SSE) follows.
  const moveLocal = (it: Item, patch: { date: string; startTime: string | null; endTime: string | null }) => {
    if (it.kind === "block") {
      const t = tasksById.get(it.task.id);
      if (!t) return;
      const blocks = t.blocks.map((b) => (b.id === it.block.id ? { ...b, ...patch } : b));
      if (state.tasks[t.id]) dispatch({ type: "task", task: { ...t, blocks } });
      else setFetchedTasks((list) => list.map((x) => (x.id === t.id ? { ...x, blocks } : x)));
      void api.patch(`/api/blocks/${it.block.id}`, patch);
    } else {
      setEvents((list) => list.map((e) => (e.id === it.event.id ? { ...e, ...patch } : e)));
      void api.patch(`/api/calendar-events/${it.event.id}`, patch);
    }
  };

  const onGridDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget || e.pointerType !== "mouse") return;
    const { day: d, min } = locate(e);
    gridRef.current!.setPointerCapture(e.pointerId);
    setDrag({ kind: "create", day: d, from: min, to: min + 60 });
  };

  const onGridClick = (e: React.MouseEvent) => {
    if (!mobile || e.target !== e.currentTarget) return;
    const { day: d, min } = locate(e);
    const start = Math.floor(min / 60) * 60;
    setPanel({ type: "slot", slot: { date: dates[d], startTime: minutesToTime(start), endTime: minutesToTime(Math.min(start + 60, DAY_END)) } });
  };

  const onItemDown = (it: Item) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0 || e.pointerType !== "mouse") return;
    gridRef.current!.setPointerCapture(e.pointerId);
    const { min } = locate(e);
    setDrag({ kind: "move", item: it, day: dates.indexOf(it.date), start: itemStart(it), dur: itemEnd(it) - itemStart(it), grab: min - itemStart(it), moved: false });
  };

  const onResizeDown = (it: Item) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.pointerType !== "mouse") return;
    gridRef.current!.setPointerCapture(e.pointerId);
    setDrag({ kind: "resize", item: it, day: dates.indexOf(it.date), start: itemStart(it), end: itemEnd(it) });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const { day: d, min } = locate(e);
    if (drag.kind === "create") setDrag({ ...drag, to: Math.max(min, drag.from + SNAP) });
    else if (drag.kind === "resize") setDrag({ ...drag, end: Math.max(min, drag.start + SNAP) });
    else {
      const start = clampMin(Math.min(min - drag.grab, END_H * 60 - drag.dur));
      if (start !== drag.start || d !== drag.day) setDrag({ ...drag, start, day: d, moved: true });
    }
  };

  const onUp = () => {
    if (!drag) return;
    const d = dates[drag.day];
    if (drag.kind === "create") {
      setPanel({ type: "slot", slot: { date: d, startTime: minutesToTime(drag.from), endTime: minutesToTime(Math.min(drag.to, DAY_END)) } });
    } else if (drag.kind === "resize") {
      moveLocal(drag.item, { date: drag.item.date, startTime: drag.item.startTime, endTime: minutesToTime(Math.min(drag.end, DAY_END)) });
    } else if (!drag.moved) {
      openItem(drag.item);
    } else {
      moveLocal(drag.item, { date: d, startTime: minutesToTime(drag.start), endTime: minutesToTime(Math.min(drag.start + drag.dur, DAY_END)) });
    }
    setDrag(null);
  };

  // HTML5 drop of a sprint task from the side list: adds a new part.
  const onDrop = (e: React.DragEvent, allDayDate?: string) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("text/task-id"));
    if (!id) return;
    if (allDayDate) {
      void api.post(`/api/tasks/${id}/blocks`, { date: allDayDate });
      return;
    }
    const { day: d, min } = locate(e);
    void api.post(`/api/tasks/${id}/blocks`, { date: dates[d], startTime: minutesToTime(min), endTime: minutesToTime(Math.min(min + 60, DAY_END)) });
  };

  const colWidth = `${100 / shownDays.length}%`;
  const weekLabel = `${fmt(dates[0], "d MMM")} – ${fmt(dates[6], "d MMM yyyy")}`;
  const closePanel = () => setPanel(null);

  const holidayOf = (d: string) => holidays.get(d);
  // Multi-day items: one bar across their days (week view) or on each day (day view).
  const spans = items
    .filter((i) => i.endDate)
    .filter((i) => shownDays.some((k) => dates[k] >= i.date && dates[k] <= i.endDate!))
    .sort((a, b) => a.date.localeCompare(b.date) || b.endDate!.localeCompare(a.endDate!));
  const allDay = (d: string) =>
    items.filter((i) => i.date === d && !i.startTime && !i.endDate).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "event" ? -1 : 1));
  const timed = (d: string) => items.filter((i) => i.date === d && i.startTime && !isBackground(i));
  const backgrounds = (d: string) => items.filter((i) => i.date === d && i.startTime && isBackground(i));

  return (
    // The page fits the screen; only the calendar body scrolls (day header stays on top).
    <div className="flex h-[calc(100dvh-10rem)] flex-col gap-3 md:h-[calc(100dvh-6rem-1px)]">
      {/* Row 1: navigation and view. Row 2: person filter, new event, side panel toggle. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-8" onClick={() => step(-1)} aria-label={dayView ? "Önceki gün" : "Önceki hafta"}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={goNow}>
            {dayView ? "Bugün" : "Bu sprint"}
          </Button>
          <Button variant="outline" size="icon" className="size-8" onClick={() => step(1)} aria-label={dayView ? "Sonraki gün" : "Sonraki hafta"}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={dayView ? "day" : "week"}
          onValueChange={(v) => v && setDayView(v === "day")}
          aria-label="Görünüm"
        >
          <ToggleGroupItem value="day" className="h-8 px-2.5 text-xs">
            Gün
          </ToggleGroupItem>
          <ToggleGroupItem value="week" className="h-8 px-2.5 text-xs">
            Hafta
          </ToggleGroupItem>
        </ToggleGroup>
        <span className="text-sm font-medium">{dayView ? longDate(dates[day]) : weekLabel}</span>
        {unmarked.length > 0 && (
          <Button variant="outline" size="sm" className="h-8 border-amber-500/60 text-amber-700 dark:text-amber-400" onClick={() => setPanel({ type: "unmarked" })}>
            <AlertCircle className="size-4" /> İşaretlenmemiş ({unmarked.length})
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ViewTabs />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setPanel({ type: "event", draft: { date: dayView ? dates[day] : dates.includes(state.today) ? state.today : dates[0] } })}
          >
            <Plus className="size-4" /> Etkinlik
          </Button>
          {!mobile && (
            <Button
              variant={sidePanel ? "secondary" : "outline"}
              size="icon"
              className="hidden size-8 lg:inline-flex"
              onClick={() => toggleSidePanel()}
              aria-pressed={sidePanel}
              title={sidePanel ? "Sprint görevlerini gizle" : "Sprint görevlerini göster"}
            >
              <PanelRight className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {dayView && (
        <div className="grid grid-cols-7 gap-1">
          {dates.map((d, i) => (
            <button
              key={d}
              onClick={() => setDay(i)}
              className={cn(
                "flex flex-col items-center rounded-md py-1 text-xs",
                i === day ? "bg-primary text-primary-foreground" : d === state.today ? "text-primary underline" : "text-muted-foreground",
              )}
            >
              {WEEKDAY_SHORT[i]}
              <span className={cn("text-sm font-medium", holidayOf(d) && i !== day && "text-rose-600 dark:text-rose-400")}>{fmt(d, "d")}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3">
        <div ref={scrollRef} className="thin-scroll min-w-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border">
          {/* Day headers + all-day row. The stable gutter keeps columns aligned with the scrolling grid. */}
          <div ref={headerRef} className={cn("sticky top-0 z-30 flex border-b bg-background/95 backdrop-blur", spans.length > 0 && "mb-[var(--spans-h)]")} style={{ ["--spans-h" as string]: `${spans.length * 24 + 8}px` }}>
            <div className="w-11 shrink-0 border-r text-[10px] text-muted-foreground" />
            {shownDays.map((i) => (
              <div key={i} className="min-w-0 flex-1 border-r last:border-r-0" style={{ width: colWidth }}>
                {!dayView && (
                  <div className={cn("px-1.5 py-1 text-center text-xs", dates[i] === state.today && "font-semibold text-primary")}>
                    {WEEKDAY_SHORT[i]}{" "}
                    <span className={cn(dates[i] === state.today && "rounded-full bg-primary px-1.5 text-primary-foreground")}>{fmt(dates[i], "d")}</span>
                  </div>
                )}
                <div
                  className="thin-scroll max-h-24 min-h-10 space-y-1 overflow-y-auto p-1"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onDrop(e, dates[i])}
                  onDoubleClick={(e) => e.target === e.currentTarget && setPanel({ type: "slot", slot: { date: dates[i], startTime: null, endTime: null } })}
                >
                  {holidayOf(dates[i])?.map((h) => (
                    <div
                      key={h.name}
                      title={h.half ? `${h.name} (13:00'dan sonra tatil)` : h.name}
                      className="truncate rounded bg-rose-500/10 px-1.5 py-0.5 text-[11px] text-rose-700 dark:text-rose-300"
                    >
                      {h.half ? "½ " : ""}
                      {h.name}
                    </div>
                  ))}
                  {allDay(dates[i]).map((it) => (
                    <ItemBox key={it.key} item={it} compact unmarked={unmarkedKeys.has(it.key)} onClick={() => openItem(it)} />
                  ))}
                  {dayView && (
                    <button className="text-[11px] text-muted-foreground" onClick={() => setPanel({ type: "slot", slot: { date: dates[i], startTime: null, endTime: null } })}>
                      + Tüm gün
                    </button>
                  )}
                </div>
              </div>
            ))}
            {spans.length > 0 && (
              <div className="absolute inset-x-0 top-full flex border-b bg-background/95 backdrop-blur">
                <div className="w-11 shrink-0 border-r" />
                <div className="grid flex-1 gap-y-1 px-0.5 py-1" style={{ gridTemplateColumns: `repeat(${shownDays.length}, minmax(0, 1fr))` }}>
                  {spans.map((it) => {
                    const from = shownDays.findIndex((k) => dates[k] >= it.date);
                    const lastIdx = shownDays.reduce((acc, k, idx) => (dates[k] <= it.endDate! ? idx : acc), from);
                    return (
                      <SpanBar
                        key={it.key}
                        item={it}
                        cutStart={it.date < dates[shownDays[0]]}
                        cutEnd={it.endDate! > dates[shownDays[shownDays.length - 1]]}
                        style={{ gridColumn: `${Math.max(0, from) + 1} / ${lastIdx + 2}` }}
                        onClick={() => openItem(it)}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Hour grid */}
          <div>
            <div className="flex">
              <div className="relative w-11 shrink-0 border-r" style={{ height: GRID_H }}>
                {Array.from({ length: END_H - START_H }, (_, h) => (
                  <span key={h} className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground" style={{ top: h * HOUR_PX }}>
                    {h > 0 && `${String(START_H + h).padStart(2, "0")}:00`}
                  </span>
                ))}
              </div>
              <div
                ref={gridRef}
                className="relative flex-1 touch-pan-y"
                style={{ height: GRID_H, backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${HOUR_PX}px)` }}
                onPointerDown={onGridDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={() => setDrag(null)}
                onClick={onGridClick}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDrop(e)}
              >
                {shownDays.map((_, idx) => (
                  <div key={idx} className="pointer-events-none absolute inset-y-0 border-r last:border-r-0" style={{ left: `calc(${colWidth} * ${idx})`, width: colWidth }} />
                ))}
                {shownDays.map((i, idx) =>
                  dates[i] === state.today ? <NowLine key="now" min={nowMin} left={`calc(${colWidth} * ${idx})`} width={colWidth} /> : null,
                )}
                {/* Long events (8 h or more) are a background band, so tasks keep the full column width. */}
                {shownDays.map((i, idx) =>
                  backgrounds(dates[i]).map((it) => {
                    if (it.kind !== "event") return null;
                    const meta = kindMeta(it.event.kind);
                    const Icon = meta.icon;
                    return (
                      <div
                        key={it.key}
                        className="pointer-events-none absolute"
                        style={{
                          top: ((itemStart(it) - START_H * 60) / 60) * HOUR_PX,
                          height: ((itemEnd(it) - itemStart(it)) / 60) * HOUR_PX,
                          left: `calc(${colWidth} * ${idx})`,
                          width: colWidth,
                          ...hatch(meta.color),
                          opacity: it.status === "missed" ? 0.35 : 0.6,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => openItem(it)}
                          style={{ top: headerH + 2 }}
                          title={`${it.event.title} · ${it.startTime}–${it.endTime}`}
                          className={cn(
                            "pointer-events-auto sticky m-0.5 flex max-w-[calc(100%-4px)] items-center gap-1 rounded bg-background/90 px-1 py-0.5 text-[10px] font-medium shadow-xs",
                            unmarkedKeys.has(it.key) && "outline-1 outline-amber-500 outline-dashed",
                          )}
                        >
                          <Icon className="size-3 shrink-0" style={{ color: meta.color }} />
                          <span className="truncate">{it.event.title}</span>
                          <span className="flex shrink-0 -space-x-1">
                            {it.event.attendeeIds.map((id) => (
                              <UserAvatar key={id} user={state.users.find((u) => u.id === id)} className="size-3.5 text-[7px] ring-1 ring-background" />
                            ))}
                          </span>
                        </button>
                      </div>
                    );
                  }),
                )}
                {shownDays.map((i, idx) => {
                  const list = timed(dates[i]).filter((it) => !(drag && drag.kind !== "create" && drag.item.key === it.key));
                  const lay = layoutDay(list);
                  return list.map((it) => {
                    const l = lay.get(it.key)!;
                    const top = ((itemStart(it) - START_H * 60) / 60) * HOUR_PX;
                    const height = Math.max(((itemEnd(it) - itemStart(it)) / 60) * HOUR_PX, 18);
                    return (
                      <ItemBox
                        key={it.key}
                        item={it}
                        unmarked={unmarkedKeys.has(it.key)}
                        style={{
                          top,
                          height,
                          left: `calc(${colWidth} * ${idx} + (${colWidth} - 4px) * ${l.col / l.cols} + 2px)`,
                          width: `calc((${colWidth} - 4px) / ${l.cols} - 2px)`,
                        }}
                        onPointerDown={mobile ? undefined : onItemDown(it)}
                        onResizeDown={mobile ? undefined : onResizeDown(it)}
                        onClick={mobile ? () => openItem(it) : undefined}
                      />
                    );
                  });
                })}
                {drag &&
                  shownDays.includes(drag.day) &&
                  (() => {
                    const idx = shownDays.indexOf(drag.day);
                    const left = `calc(${colWidth} * ${idx} + 2px)`;
                    const width = `calc(${colWidth} - 4px)`;
                    if (drag.kind === "create")
                      return (
                        <div
                          className="pointer-events-none absolute rounded-md border-2 border-dashed border-primary/60 bg-primary/10 px-1.5 text-[11px]"
                          style={{ top: ((drag.from - START_H * 60) / 60) * HOUR_PX, height: ((drag.to - drag.from) / 60) * HOUR_PX, left, width }}
                        >
                          {minutesToTime(drag.from)}–{minutesToTime(Math.min(drag.to, DAY_END))}
                        </div>
                      );
                    const start = drag.start;
                    const end = drag.kind === "move" ? drag.start + drag.dur : drag.end;
                    const ghost = { ...drag.item, startTime: minutesToTime(start), endTime: minutesToTime(Math.min(end, DAY_END)) } as Item;
                    return (
                      <ItemBox
                        ghost
                        item={ghost}
                        unmarked={false}
                        style={{ top: ((start - START_H * 60) / 60) * HOUR_PX, height: ((end - start) / 60) * HOUR_PX, left, width }}
                      />
                    );
                  })()}
              </div>
            </div>
          </div>
        </div>

        {/* Sprint tasks: drag onto the grid to add a part (desktop). */}
        {!mobile && sidePanel && (
          <aside className="hidden min-h-0 w-60 shrink-0 flex-col gap-2 lg:flex">
            <h3 className="text-sm font-medium">Sprint görevleri</h3>
            <p className="text-xs text-muted-foreground">Takvime sürükleyerek bir parça ekleyin. Bir görev birden çok parçaya bölünebilir.</p>
            {sideTasks.length === 0 && <p className="text-xs text-muted-foreground">Açık görev yok.</p>}
            <div className="thin-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
              {sideTasks.map((t) => (
                <div
                  key={t.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/task-id", String(t.id))}
                  onClick={() => openTask(t.id)}
                  className="cursor-grab space-y-1 rounded-md border bg-card p-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <CategoryDot category={state.categories.find((c) => c.id === t.categoryId)} />
                    <span className="flex-1 truncate">{t.title}</span>
                    <SpBadge sp={t.sp} />
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{t.blocks.length ? `${t.blocks.length} parça` : "takvimde yok"}</span>
                    {t.progress > 0 && (
                      <>
                        <span className="h-1 flex-1 rounded-full bg-muted">
                          <span className="block h-full rounded-full bg-primary" style={{ width: `${t.progress}%` }} />
                        </span>
                        <span className="tabular-nums">%{t.progress}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>

      <Dialog open={!!panel} onOpenChange={(o) => !o && closePanel()}>
        <DialogContent
          className="thin-scroll max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-md"
          // Do not focus (and select) the first field on open; empty forms focus their title with autoFocus.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {panel?.type === "slot" && (
            <SlotPanel
              slot={panel.slot}
              onClose={closePanel}
              onNewTask={() => {
                const s = panel.slot;
                closePanel();
                openNew({ date: s.date, startTime: s.startTime, endTime: s.endTime, sprintId: sprintFor(s.date) });
              }}
              onNewEvent={() => setPanel({ type: "event", draft: { ...panel.slot } })}
            />
          )}
          {panel?.type === "event" && <EventForm draft={panel.draft} onClose={closePanel} />}
          {panel?.type === "unmarked" && (
            <UnmarkedPanel items={unmarked as UnmarkedItem[]} onChanged={() => setNowMin(nowMinutes())} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NowLine({ min, left, width }: { min: number; left: string; width: string }) {
  if (min < START_H * 60) return null;
  return (
    <div className="pointer-events-none absolute z-10 h-0.5 bg-red-500" style={{ top: ((min - START_H * 60) / 60) * HOUR_PX, left, width }}>
      <span className="absolute -top-1 -left-1 size-2.5 rounded-full bg-red-500" />
    </div>
  );
}
