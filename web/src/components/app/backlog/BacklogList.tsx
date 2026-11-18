// Backlog list with smart or manual sort. Used on the backlog page and in grooming.
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "@shared/types.ts";
import { GripVertical } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Assignees, CategoryDot, OwnerChip, OwnerStrip, SpBadge } from "../common";
import { hoverProps, markStyle, PartnerTag, usePartnerMark } from "@/lib/hover";
import { ProgressLine, TaskMeta } from "../TaskCard";
import { useTaskDialog } from "../TaskDialog";

export type SortMode = "smart" | "manual";

export function smartCompare(a: Task, b: Task): number {
  return (
    b.priority - a.priority ||
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
    a.backlogRank - b.backlogRank ||
    a.id - b.id
  );
}

export function TaskRow({
  task,
  action,
  handle,
  className,
  showOwner = true,
}: {
  task: Task;
  action?: ReactNode;
  handle?: ReactNode;
  className?: string;
  /** Owner name chip: a person name, or "Ortak" for shared tasks. */
  showOwner?: boolean;
}) {
  const { state } = useStore();
  const { openTask } = useTaskDialog();
  const mark = usePartnerMark(`task:${task.id}`);
  const category = state.categories.find((c) => c.id === task.categoryId);
  return (
    <div
      {...hoverProps(`task:${task.id}`)}
      className={cn("relative flex items-center gap-2 rounded-lg border bg-card py-2 pr-2 pl-3", mark && "ring-2", className)}
      style={markStyle(mark)}
    >
      <OwnerStrip ids={task.assigneeIds} />
      <PartnerTag mark={mark} />
      {handle}
      <button className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left" onClick={() => openTask(task.id)}>
        <span className="flex w-full items-center gap-2">
          <CategoryDot category={category} />
          <span className="truncate text-sm">{task.title}</span>
          {showOwner && <OwnerChip ids={task.assigneeIds} className="ml-auto" />}
        </span>
        <TaskMeta task={task} />
        {task.progress > 0 && task.progress < 100 && (
          <span className="w-full max-w-48">
            <ProgressLine value={task.progress} />
          </span>
        )}
      </button>
      <Assignees ids={task.assigneeIds} />
      <SpBadge sp={task.sp} />
      {action}
    </div>
  );
}

function SortableRow({ task, action }: { task: Task; action?: (t: Task) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "z-10 opacity-70")}>
      <TaskRow
        task={task}
        action={action?.(task)}
        handle={
          <button {...attributes} {...listeners} className="cursor-grab touch-none text-muted-foreground" aria-label="Sırala">
            <GripVertical className="size-4" />
          </button>
        }
      />
    </div>
  );
}

export function BacklogList({
  tasks,
  mode,
  action,
}: {
  tasks: Task[];
  mode: SortMode;
  action?: (t: Task) => ReactNode;
}) {
  const { state, dispatch } = useStore();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
  );
  const sorted = useMemo(
    () => [...tasks].sort(mode === "smart" ? smartCompare : (a, b) => a.backlogRank - b.backlogRank || a.id - b.id),
    [tasks, mode],
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    // Reorder the full backlog (also hidden rows), so filters do not lose positions.
    const all = Object.values(state.tasks)
      .filter((t) => t.sprintId === null)
      .sort((a, b) => a.backlogRank - b.backlogRank || a.id - b.id);
    const from = all.findIndex((t) => t.id === e.active.id);
    const to = all.findIndex((t) => t.id === e.over!.id);
    const [moved] = all.splice(from, 1);
    all.splice(to, 0, moved);
    all.forEach((t, i) => dispatch({ type: "task", task: { ...t, backlogRank: i + 1 } }));
    void api.post("/api/backlog/reorder", { ids: all.map((t) => t.id) });
  };

  if (mode === "smart")
    return (
      <div className="space-y-1.5">
        {sorted.map((t) => (
          <TaskRow key={t.id} task={t} action={action?.(t)} />
        ))}
      </div>
    );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={sorted.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-1.5">
          {sorted.map((t) => (
            <SortableRow key={t.id} task={t} action={action} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
