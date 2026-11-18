import type { Availability, Sprint, SprintStats, Task } from "@shared/types.ts";
import { ArrowRight, Repeat, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { weekDates } from "@/lib/dates";
import { focusTask, useStore } from "@/lib/store";
import { WEEKDAY_SHORT } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { CategoryDot, SpPicker, UserAvatar, fmtSp, OwnerChip, OwnerStrip } from "../common";
import { GoalEditor, SpProgress } from "../SprintHeader";
import { hoverProps, markStyle, PartnerTag, usePartnerMark } from "@/lib/hover";
import { TaskMeta } from "../TaskCard";
import { useTaskDialog } from "../TaskDialog";
import { goStep } from "./PlanningPage";
import { useSprintStats } from "./RetroStep";

export function useAvailability(from: string, to: string): Availability[] {
  const { state } = useStore();
  const [list, setList] = useState<Availability[]>([]);
  const ver = state.versions["availability.changed"];
  useEffect(() => {
    void api.get<Availability[]>(`/api/availability?from=${from}&to=${to}`).then(setList);
  }, [from, to, ver]);
  return list;
}

/** Available days in the week: off = 0, half = 0.5, else 1. */
export function availableDays(list: Availability[], userId: number): number {
  return 7 - list.filter((a) => a.userId === userId).reduce((s, a) => s + (a.kind === "off" ? 1 : 0.5), 0);
}

/** Event hours per user in a date range (openwiki/calendar.md, busy hours). */
export function useBusyHours(from: string, to: string): Record<number, number> {
  const { state } = useStore();
  const [busy, setBusy] = useState<Record<number, number>>({});
  const v = state.versions;
  useEffect(() => {
    void api
      .get<{ userId: number; hours: number }[]>(`/api/busy?from=${from}&to=${to}`)
      .then((list) => setBusy(Object.fromEntries(list.map((x) => [x.userId, x.hours]))));
  }, [from, to, v["calendarEvent.upsert"], v["calendarEvent.delete"], v["eventRules.changed"]]);
  return busy;
}

/** 8 event hours count as one day. */
export const BUSY_HOURS_PER_DAY = 8;

/**
 * Target suggestion: average done SP of the last 3 closed sprints,
 * scaled by available days minus event hours (8 h = 1 day).
 */
export function suggestTarget(stats: SprintStats[], userId: number, days: number, busyHours = 0): number | null {
  const closed = stats.filter((s) => s.sprint.status === "closed").slice(-3);
  if (closed.length === 0) return null;
  const avg = closed.reduce((s, x) => s + (x.perUser.find((p) => p.userId === userId)?.doneSp ?? 0), 0) / closed.length;
  const free = Math.max(0, days - busyHours / BUSY_HOURS_PER_DAY);
  return Math.round((avg * free) / 7);
}

function EstimateRow({ task }: { task: Task }) {
  const { state, patchTask } = useStore();
  const { openTask } = useTaskDialog();
  const mark = usePartnerMark(`task:${task.id}`);
  const category = state.categories.find((c) => c.id === task.categoryId);
  return (
    <div
      {...hoverProps(`task:${task.id}`)}
      className={cn(
        "relative flex flex-col gap-2 rounded-lg border bg-card py-3 pr-3 pl-4 sm:flex-row sm:items-center",
        task.sp == null && "border-dashed",
        mark && "ring-2",
      )}
      style={markStyle(mark)}
    >
      <OwnerStrip ids={task.assigneeIds} />
      <PartnerTag mark={mark} />
      <button className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left" onClick={() => openTask(task.id)}>
        <span className="flex w-full items-center gap-2">
          <CategoryDot category={category} />
          <span className="text-sm">{task.title}</span>
          <OwnerChip ids={task.assigneeIds} className="ml-auto sm:ml-2" />
        </span>
        {task.description && <span className="line-clamp-2 text-xs text-muted-foreground">{task.description}</span>}
        <TaskMeta task={task} />
      </button>
      <SpPicker value={task.sp} onChange={(sp) => void patchTask(task.id, { sp })} />
    </div>
  );
}

function RecurringRow({ ruleId, tasks }: { ruleId: number; tasks: Task[] }) {
  const { state } = useStore();
  const rule = state.rules.find((r) => r.id === ruleId);
  const sp = tasks[0]?.sp ?? null;
  const mark = usePartnerMark(`rule:${ruleId}`);
  const set = (value: number | null) => void api.post("/api/planning/recurring-sp", { ruleId, sp: value });
  return (
    <div
      {...hoverProps(`rule:${ruleId}`)}
      className={cn("relative flex flex-col gap-2 rounded-lg border border-dashed bg-card py-3 pr-3 pl-4 sm:flex-row sm:items-center", mark && "ring-2")}
      style={markStyle(mark)}
    >
      <OwnerStrip ids={tasks[0]?.assigneeIds ?? []} />
      <PartnerTag mark={mark} />
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        <Repeat className="size-3.5 text-muted-foreground" />
        <span>{rule?.title ?? tasks[0]?.title}</span>
        <span className="text-xs text-muted-foreground">
          {tasks.length}× · toplam {fmtSp((sp ?? 0) * tasks.length)} SP
        </span>
        <OwnerChip ids={tasks[0]?.assigneeIds ?? []} className="ml-auto sm:ml-2" />
      </div>
      <SpPicker value={sp} onChange={set} />
    </div>
  );
}

function CapacityPanel({ sprint }: { sprint: Sprint }) {
  const { state } = useStore();
  const days = weekDates(sprint.startDate);
  const avail = useAvailability(sprint.startDate, sprint.endDate);
  const stats = useSprintStats();
  const busy = useBusyHours(sprint.startDate, sprint.endDate);
  const cycle = (userId: number, date: string) => {
    const cur = avail.find((a) => a.userId === userId && a.date === date)?.kind;
    const next = cur === undefined ? "off" : cur === "off" ? "half" : null;
    void api.put("/api/availability", { userId, date, kind: next });
  };
  return (
    <section className="space-y-3 rounded-lg border p-3">
      <div>
        <h3 className="font-medium">Müsaitlik ve hedef</h3>
        <p className="text-xs text-muted-foreground">Güne dokun: izinli → yarım gün → müsait.</p>
      </div>
      {state.users.map((u) => {
        const free = availableDays(avail, u.id);
        const suggestion = suggestTarget(stats, u.id, free, busy[u.id] ?? 0);
        const target = sprint.members.find((m) => m.userId === u.id)?.targetSp ?? 0;
        return (
          <div key={u.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <UserAvatar user={u} className="size-5" />
              <span className="font-medium">{u.name}</span>
              <span className="text-xs text-muted-foreground">
                {free} gün müsait{busy[u.id] ? ` · ${busy[u.id]} sa etkinlik` : ""}
              </span>
              <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                Hedef
                <Input
                  key={target}
                  type="number"
                  min={0}
                  defaultValue={target}
                  className="h-7 w-16 text-right"
                  onBlur={(e) => {
                    const n = Math.max(0, Math.round(Number(e.target.value) || 0));
                    if (n !== target) void api.put(`/api/sprints/${sprint.id}/members/${u.id}`, { targetSp: n });
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
                SP
              </label>
              {suggestion != null && suggestion !== target && (
                <button
                  className="w-full text-left text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => void api.put(`/api/sprints/${sprint.id}/members/${u.id}`, { targetSp: suggestion })}
                >
                  Öneri: {suggestion} SP uygula
                </button>
              )}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((d, i) => {
                const kind = avail.find((a) => a.userId === u.id && a.date === d)?.kind;
                return (
                  <button
                    key={d}
                    onClick={() => cycle(u.id, d)}
                    className={cn(
                      "rounded-md border py-1.5 text-xs",
                      kind === "off" && "border-red-500/50 bg-red-500/10 text-red-600 line-through",
                      kind === "half" && "border-amber-500/50 bg-amber-500/10 text-amber-600",
                    )}
                  >
                    {WEEKDAY_SHORT[i]}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function EstimationStep() {
  const { state } = useStore();
  const planned = state.plannedSprint!;
  const sprintTasks = useMemo(
    () => Object.values(state.tasks).filter((t) => t.sprintId === planned.id),
    [state.tasks, planned.id],
  );
  const normal = sprintTasks.filter((t) => !t.recurringRuleId).sort((a, b) => a.id - b.id);
  const byRule = useMemo(() => {
    const m = new Map<number, Task[]>();
    for (const t of sprintTasks.filter((x) => x.recurringRuleId))
      m.set(t.recurringRuleId!, [...(m.get(t.recurringRuleId!) ?? []), t]);
    return [...m.entries()];
  }, [sprintTasks]);
  const missing = normal.filter((t) => t.sp == null).length;

  useEffect(() => () => focusTask("planning", null), []);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 font-medium">
            Görevler{" "}
            {missing > 0 && (
              <span className="flex items-center gap-1 text-xs font-normal text-amber-600">
                <TriangleAlert className="size-3.5" /> {missing} görev puansız
              </span>
            )}
          </h3>
          {normal.length === 0 && <p className="text-sm text-muted-foreground">Grooming'de görev seçilmedi.</p>}
          {normal.map((t) => (
            <EstimateRow key={t.id} task={t} />
          ))}
        </section>
        {byRule.length > 0 && (
          <section className="space-y-2">
            <h3 className="font-medium">Tekrarlayanlar</h3>
            <p className="text-xs text-muted-foreground">Puan geçen haftadan gelir. Değişiklik haftanın tüm tekrarlarına uygulanır.</p>
            {byRule.map(([ruleId, tasks]) => (
              <RecurringRow key={ruleId} ruleId={ruleId} tasks={tasks} />
            ))}
          </section>
        )}
      </div>
      <aside className="space-y-4 lg:sticky lg:top-16 lg:self-start">
        <section className="space-y-3 rounded-lg border p-3">
          <h3 className="font-medium">Planlanan SP / hedef</h3>
          <GoalEditor sprint={planned} />
          <div className="[&>div]:grid-cols-1">
            <SpProgress sprint={planned} tasks={sprintTasks} mode="planned" />
          </div>
        </section>
        <CapacityPanel sprint={planned} />
        <Button className="w-full" onClick={() => void goStep("start")}>
          Özete geç <ArrowRight className="size-4" />
        </Button>
      </aside>
    </div>
  );
}
