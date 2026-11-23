import type { Task } from "@shared/types.ts";
import { ArrowLeft, ArrowRight, Plus, Repeat } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hoverProps, markStyle, PartnerTag, usePartnerMark } from "@/lib/hover";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { SortToggle, useSortMode } from "../backlog/BacklogPage";
import { BacklogList, TaskRow, type RowWrap } from "../backlog/BacklogList";
import { EmptyState, OwnerChip, OwnerStrip, sumSp, fmtSp } from "../common";
import { useTaskDialog } from "../TaskDialog";
import { goStep } from "./PlanningPage";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="flex items-baseline gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title} {hint && <span className="font-normal normal-case">{hint}</span>}
      </h4>
      {children}
    </div>
  );
}

/** Recurring occurrences grouped by rule, one row per rule. */
function RecurringGroupRow({ ruleId, title, tasks }: { ruleId: number; title: string; tasks: Task[] }) {
  const mark = usePartnerMark(`rule:${ruleId}`);
  return (
    <div
      {...hoverProps(`rule:${ruleId}`)}
      className={cn("relative flex items-center gap-2 rounded-lg border border-dashed py-2 pr-3 pl-4 text-sm", mark && "ring-2")}
      style={markStyle(mark)}
    >
      <OwnerStrip ids={tasks[0]?.assigneeIds ?? []} />
      <PartnerTag mark={mark} />
      <Repeat className="size-3.5 text-muted-foreground" />
      <span className="flex-1 truncate">{title}</span>
      <OwnerChip ids={tasks[0]?.assigneeIds ?? []} />
      <span className="text-xs text-muted-foreground">{tasks.length}× · otomatik</span>
    </div>
  );
}

export function RecurringGroups({ tasks }: { tasks: Task[] }) {
  const { state } = useStore();
  const groups = useMemo(() => {
    const m = new Map<number, Task[]>();
    for (const t of tasks) m.set(t.recurringRuleId!, [...(m.get(t.recurringRuleId!) ?? []), t]);
    return [...m.entries()];
  }, [tasks]);
  return (
    <div className="space-y-1.5">
      {groups.map(([ruleId, list]) => {
        const rule = state.rules.find((r) => r.id === ruleId);
        return <RecurringGroupRow key={ruleId} ruleId={ruleId} title={rule?.title ?? list[0].title} tasks={list} />;
      })}
    </div>
  );
}

/** Desktop: rows drag between the backlog and the sprint (native DnD, so the backlog sort handle still works). */
function useDragBetween(onDrop: (taskId: number, target: "backlog" | "sprint") => void) {
  const [over, setOver] = useState<"backlog" | "sprint" | null>(null);
  const fromHandle = useRef(false);
  const wrap: RowWrap = (t, row) => (
    <div
      draggable
      onPointerDownCapture={(e) => {
        fromHandle.current = !!(e.target as HTMLElement).closest("[data-sort-handle]");
      }}
      onDragStart={(e) => {
        if (fromHandle.current) return e.preventDefault();
        e.dataTransfer.setData("text/task-id", String(t.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      className="cursor-grab active:cursor-grabbing"
    >
      {row}
    </div>
  );
  const zone = (target: "backlog" | "sprint") => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("text/task-id")) return;
      e.preventDefault();
      setOver(target);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      const id = Number(e.dataTransfer.getData("text/task-id"));
      if (id) onDrop(id, target);
    },
  });
  return { wrap, zone, over };
}

export function GroomingStep() {
  const { state, patchTask } = useStore();
  const { openNew } = useTaskDialog();
  const planned = state.plannedSprint!;
  const [mode, setMode] = useSortMode();
  const [pane, setPane] = useState<"backlog" | "sprint">("sprint");

  const all = Object.values(state.tasks);
  const backlog = all.filter((t) => t.sprintId === null && !t.cancelledAt);
  const sprintTasks = all.filter((t) => t.sprintId === planned.id && !t.cancelledAt);
  const carried = sprintTasks.filter((t) => t.carriedFromSprintId && !t.recurringRuleId);
  const fresh = sprintTasks.filter((t) => !t.carriedFromSprintId && !t.recurringRuleId);
  const recurring = sprintTasks.filter((t) => t.recurringRuleId);

  const drag = useDragBetween((id, target) => {
    const t = state.tasks[id];
    if (!t || t.recurringRuleId) return;
    if (target === "sprint" && t.sprintId !== planned.id) void patchTask(id, { sprintId: planned.id });
    if (target === "backlog" && t.sprintId === planned.id) void patchTask(id, { sprintId: null });
  });

  const toSprint = (t: Task) => (
    <Button variant="ghost" size="icon" className="size-8 shrink-0" title="Sprinte al" onClick={() => void patchTask(t.id, { sprintId: planned.id })}>
      <ArrowRight className="size-4" />
    </Button>
  );
  const toBacklog = (t: Task) => (
    <Button variant="ghost" size="icon" className="size-8 shrink-0" title="Backloga geri at" onClick={() => void patchTask(t.id, { sprintId: null })}>
      <ArrowLeft className="size-4" />
    </Button>
  );

  return (
    <div className="space-y-4">
      <Tabs value={pane} onValueChange={(v) => setPane(v as "backlog" | "sprint")} className="lg:hidden">
        <TabsList className="w-full">
          <TabsTrigger value="backlog" className="flex-1">
            Backlog ({backlog.length})
          </TabsTrigger>
          <TabsTrigger value="sprint" className="flex-1">
            Yeni sprint ({sprintTasks.length - recurring.length})
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid gap-4 lg:grid-cols-2">
        <section
          {...drag.zone("backlog")}
          className={cn("space-y-3 rounded-lg border p-3 transition-colors", pane !== "backlog" && "hidden lg:block", drag.over === "backlog" && "border-primary bg-primary/5")}
        >
          <div className="flex items-center gap-2">
            <h3 className="font-medium">Backlog</h3>
            <span className="text-xs text-muted-foreground">
              {backlog.length} görev · {fmtSp(sumSp(backlog))} SP
            </span>
            <div className="ml-auto">
              <SortToggle mode={mode} setMode={setMode} />
            </div>
          </div>
          {backlog.length === 0 ? (
            <p className="text-sm text-muted-foreground">Backlog boş.</p>
          ) : (
            <BacklogList tasks={backlog} mode={mode} action={toSprint} wrap={drag.wrap} />
          )}
        </section>

        <section
          {...drag.zone("sprint")}
          className={cn("space-y-4 rounded-lg border p-3 transition-colors", pane !== "sprint" && "hidden lg:block", drag.over === "sprint" && "border-primary bg-primary/5")}
        >
          <div className="flex items-center gap-2">
            <h3 className="font-medium">Sprint {planned.number}</h3>
            <span className="text-xs text-muted-foreground">{fmtSp(sumSp(sprintTasks))} SP</span>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => openNew({ sprintId: planned.id })}>
              <Plus className="size-4" /> Görev
            </Button>
          </div>
          {carried.length > 0 && (
            <Section title="Devreden" hint="geçen sprintten kalanlar">
              {carried.map((t) => (
                <div key={t.id}>{drag.wrap(t, <TaskRow task={t} action={toBacklog(t)} className="border-amber-500/40" />)}</div>
              ))}
            </Section>
          )}
          <Section title="Seçilenler">
            {fresh.length === 0 ? (
              <p className="text-sm text-muted-foreground">Backlogdan görev sürükleyin, okla seçin veya yeni görev ekleyin.</p>
            ) : (
              fresh.map((t) => <div key={t.id}>{drag.wrap(t, <TaskRow task={t} action={toBacklog(t)} />)}</div>)
            )}
          </Section>
          {recurring.length > 0 && (
            <Section title="Tekrarlayan" hint="otomatik eklendi">
              <RecurringGroups tasks={recurring} />
            </Section>
          )}
          {sprintTasks.length === 0 && <EmptyState title="Sprint henüz boş." />}
        </section>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => void goStep("estimation")}>
          Onayla ve puanla <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
