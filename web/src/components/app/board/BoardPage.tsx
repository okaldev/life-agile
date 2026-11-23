// Sprint board: three columns with drag and drop. See openwiki/requirements.md (Views).
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { Task, TaskStatus } from "@shared/types.ts";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { isActiveWork, matchesView, useStore } from "@/lib/store";
import { STATUS_LABEL } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { EmptyState, ViewTabs, sumSp, fmtSp } from "../common";
import { shortDate } from "@/lib/dates";
import { CompactSprintHeader } from "../SprintHeader";
import { TaskCard, compareTasks } from "../TaskCard";
import { useTaskDialog } from "../TaskDialog";
import { useConfirm } from "../ConfirmDialog";

const COLUMNS: TaskStatus[] = ["todo", "in_progress", "done"];

function DraggableCard({ task }: { task: Task }) {
  const { openTask } = useTaskDialog();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn("touch-manipulation", isDragging && "opacity-30")}>
      <TaskCard task={task} onClick={() => openTask(task.id)} />
    </div>
  );
}

function Column({ status, tasks, sprintId }: { status: TaskStatus; tasks: Task[]; sprintId: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const { openNew } = useTaskDialog();
  // Cancelled tasks sit at the end of the done column; they do not count.
  const live = tasks.filter((t) => !t.cancelledAt);
  const cancelled = tasks.length - live.length;
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex w-[85vw] shrink-0 snap-center flex-col rounded-xl bg-muted/50 p-2 sm:w-auto sm:shrink md:min-h-0",
        isOver && "ring-2 ring-ring/40",
      )}
    >
      <header className="flex items-center gap-2 px-1.5 pb-2 text-sm">
        <span className="font-medium">{STATUS_LABEL[status]}</span>
        <span className="text-muted-foreground tabular-nums">
          {live.length} · {fmtSp(sumSp(live))} SP
          {cancelled > 0 && ` · ${cancelled} iptal`}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7"
          onClick={() => openNew({ sprintId, status })}
          aria-label="Görev ekle"
        >
          <Plus className="size-4" />
        </Button>
      </header>
      {/* Desktop: each column scrolls on its own, the header above stays visible. */}
      <div className="thin-scroll -mr-1 flex min-h-24 flex-1 flex-col gap-2 pr-1 md:overflow-y-auto">
        {tasks.map((t) => (
          <DraggableCard key={t.id} task={t} />
        ))}
      </div>
    </section>
  );
}

function NoSprint() {
  const { state } = useStore();
  const start = async () => {
    await api.post("/api/planning/start");
    window.location.href = "/planlama";
  };
  return (
    <EmptyState
      title={
        state.plannedSprint?.scheduledAt
          ? `Sprint ${state.plannedSprint.number} ${shortDate(state.plannedSprint.startDate)} 00:00'da başlayacak.`
          : state.plannedSprint
            ? "Planlama devam ediyor."
            : "Henüz aktif sprint yok."
      }
    >
      <p className="max-w-sm text-sm text-muted-foreground">
        Sprint planlamasında backlogdan görev seçip puanlarsınız. Sonra sprint başlar.
      </p>
      {state.plannedSprint ? (
        <Button asChild>
          <a href="/planlama">{state.plannedSprint.scheduledAt ? "Planı gör" : "Planlamaya devam et"}</a>
        </Button>
      ) : (
        <Button onClick={start}>İlk sprinti planla</Button>
      )}
    </EmptyState>
  );
}

export default function BoardPage() {
  const { state, patchTask } = useStore();
  const { openNew } = useTaskDialog();
  const ask = useConfirm();
  const sprint = state.activeSprint;
  const [showFuture, setShowFuture] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const sprintTasks = useMemo(
    () => (sprint ? Object.values(state.tasks).filter((t) => isActiveWork(t, state)) : []),
    [state.tasks, sprint, state.plannedSprint],
  );
  // Recurring: per rule, the open occurrences up to today; when none is today, the next open one.
  // "Gelecek tekrarlar" shows all of them (openwiki/requirements.md, Board).
  const nextRecurring = useMemo(() => {
    const keep = new Set<number>();
    const byRule = new Map<number, Task[]>();
    for (const t of sprintTasks)
      if (t.recurringRuleId && t.status === "todo" && !t.missedAt && !t.cancelledAt && t.date && t.date > state.today)
        byRule.set(t.recurringRuleId, [...(byRule.get(t.recurringRuleId) ?? []), t]);
    for (const [ruleId, list] of byRule) {
      const hasToday = sprintTasks.some((t) => t.recurringRuleId === ruleId && t.date === state.today && !t.missedAt);
      if (!hasToday) keep.add(list.sort((a, b) => a.date!.localeCompare(b.date!))[0].id);
    }
    return keep;
  }, [sprintTasks, state.today]);
  const visible = useMemo(
    () =>
      sprintTasks
        .filter((t) => matchesView(t, state.view))
        .filter((t) => showFuture || !t.recurringRuleId || !t.date || t.date <= state.today || t.status !== "todo" || nextRecurring.has(t.id))
        // Missed recurring occurrences are finished business; the calendar and dashboard still show them.
        .filter((t) => !(t.recurringRuleId && t.missedAt))
        .sort(compareTasks),
    [sprintTasks, state.view, state.today, showFuture, nextRecurring],
  );

  if (!sprint) return <NoSprint />;

  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    const status = e.over?.id as TaskStatus | undefined;
    const task = state.tasks[Number(e.active.id)];
    if (task && status && task.status !== status) void patchTask(task.id, { status });
  };

  const startPlanning = async () => {
    if (
      !state.plannedSprint &&
      !(await ask({
        title: "Sprint kapanış ve planlama başlasın mı?",
        description: "Sırasıyla retro, grooming ve estimation adımları açılır. İkiniz de aynı ekranı görürsünüz.",
        confirmText: "Başlat",
        destructive: false,
      }))
    )
      return;
    await api.post("/api/planning/start");
    window.location.href = "/planlama";
  };

  return (
    // Desktop: the board fits the screen; only the columns scroll.
    <div className="flex flex-col gap-3 md:h-[calc(100dvh-6rem-1px)]">
      <CompactSprintHeader sprint={sprint} tasks={sprintTasks.filter((t) => !t.cancelledAt)} />
      <div className="flex flex-wrap items-center gap-2">
        <ViewTabs />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={showFuture} onCheckedChange={setShowFuture} className="scale-90" />
          Gelecek tekrarlar
        </label>
        <div className="ml-auto flex gap-2">
          {!state.plannedSprint && (
            <Button variant="outline" size="sm" onClick={startPlanning}>
              Sprinti kapat ve planla
            </Button>
          )}
          <Button size="sm" onClick={() => openNew({ sprintId: sprint.id, date: null })}>
            <Plus className="size-4" /> Görev
          </Button>
        </div>
      </div>
      <DndContext sensors={sensors} onDragStart={(e) => setDragId(Number(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 md:min-h-0 md:flex-1 md:pb-0">
          {COLUMNS.map((s) => (
            <Column
              key={s}
              status={s}
              sprintId={sprint.id}
              tasks={visible.filter((t) => (t.cancelledAt ? "done" : t.status) === s).sort((a, b) => Number(!!a.cancelledAt) - Number(!!b.cancelledAt))}
            />
          ))}
        </div>
        <DragOverlay>{dragId && state.tasks[dragId] ? <TaskCard task={state.tasks[dragId]} dragging /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
