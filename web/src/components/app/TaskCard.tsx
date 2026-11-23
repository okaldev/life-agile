import type { Task } from "@shared/types.ts";
import { Ban, CalendarClock, CheckSquare, Flag, Layers, MessageSquare, Repeat, Undo2, XCircle, Zap } from "lucide-react";
import { shortDate } from "@/lib/dates";
import { hoverProps, markStyle, PartnerTag, usePartnerMark } from "@/lib/hover";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Assignees, CategoryDot, SpBadge } from "./common";

/** Partner ring color when the partner points at or opens this task. */
export function usePartnerFocus(taskId: number): string | null {
  return usePartnerMark(`task:${taskId}`)?.color ?? null;
}

export function TaskMeta({ task, showDate = true }: { task: Task; showDate?: boolean }) {
  const { state } = useStore();
  const overdue = task.dueDate && task.status !== "done" && task.dueDate < state.today;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      {task.recurringRuleId && <Repeat className="size-3" aria-label="Tekrarlayan" />}
      {task.carriedFromSprintId && !task.recurringRuleId && <Undo2 className="size-3 text-amber-600" aria-label="Devreden" />}
      {task.priority >= 2 && <Flag className={cn("size-3", task.priority === 3 ? "text-red-500" : "text-amber-500")} />}
      {showDate && task.date && (
        <span className="flex items-center gap-0.5">
          <CalendarClock className="size-3" />
          {shortDate(task.date)}
          {task.startTime && ` ${task.startTime}${task.endTime ? `–${task.endTime}` : ""}`}
        </span>
      )}
      {task.unplannedAt && (
        <span className="flex items-center gap-0.5 rounded bg-orange-500/15 px-1 font-medium text-orange-600 dark:text-orange-400" title="Sprint başladıktan sonra eklendi">
          <Zap className="size-3" /> Plan dışı
        </span>
      )}
      {task.occurrenceDate?.includes("#") && (
        <span className="rounded bg-muted px-1 tabular-nums" title="Haftada N kez: günü siz seçin">
          {task.occurrenceDate.split("#")[1]}/{state.rules.find((r) => r.id === task.recurringRuleId)?.timesPerWeek ?? "?"}
        </span>
      )}
      {task.cancelledAt && (
        <span className="flex items-center gap-0.5 rounded bg-muted px-1 font-medium text-muted-foreground" title="Gerek kalmadı; sayılmaz, devretmez">
          <Ban className="size-3" /> İptal
        </span>
      )}
      {task.missedAt && (
        <span className="flex items-center gap-0.5 font-medium text-red-500">
          <XCircle className="size-3" /> Yapılmadı
        </span>
      )}
      {task.blocks.length > 1 && (
        <span className="flex items-center gap-0.5" title="Takvim parçaları">
          <Layers className="size-3" />
          {task.blocks.filter((b) => b.status === "done").length}/{task.blocks.length}
        </span>
      )}
      {task.dueDate && <span className={cn(overdue && "font-medium text-red-500")}>Son: {shortDate(task.dueDate)}</span>}
      {task.checklistTotal > 0 && (
        <span className="flex items-center gap-0.5">
          <CheckSquare className="size-3" />
          {task.checklistDone}/{task.checklistTotal}
        </span>
      )}
      {task.commentCount > 0 && (
        <span className="flex items-center gap-0.5">
          <MessageSquare className="size-3" />
          {task.commentCount}
        </span>
      )}
    </div>
  );
}

export function TaskCard({
  task,
  onClick,
  className,
  dragging,
}: {
  task: Task;
  onClick?: () => void;
  className?: string;
  dragging?: boolean;
}) {
  const { state } = useStore();
  const mark = usePartnerMark(`task:${task.id}`);
  const category = state.categories.find((c) => c.id === task.categoryId);
  return (
    <div
      {...hoverProps(`task:${task.id}`)}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick?.()}
      className={cn(
        "relative cursor-pointer rounded-lg border bg-card p-2 text-left shadow-xs transition-shadow select-none hover:shadow-sm",
        (task.status === "done" || task.cancelledAt) && "opacity-60",
        dragging && "rotate-1 shadow-lg",
        mark && "ring-2",
        className,
      )}
      style={markStyle(mark)}
    >
      <PartnerTag mark={mark} />
      <div className="flex items-start gap-2">
        <CategoryDot category={category} className="mt-1.5" />
        <p className={cn("line-clamp-2 flex-1 text-sm leading-snug", (task.status === "done" || task.cancelledAt) && "line-through")} title={task.title}>
          {task.title}
        </p>
        <SpBadge sp={task.sp} />
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <TaskMeta task={task} />
        <Assignees ids={task.assigneeIds} />
      </div>
      {task.progress > 0 && task.progress < 100 && <ProgressLine value={task.progress} />}
    </div>
  );
}

export function ProgressLine({ value }: { value: number }) {
  return (
    <div className="mt-2 flex items-center gap-2" title={`İlerleme %${value}`}>
      <div className="h-1 flex-1 rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums">%{value}</span>
    </div>
  );
}

/** Stable order for task lists: date, time, priority, id. */
export function compareTasks(a: Task, b: Task): number {
  return (
    (a.date ?? "9999").localeCompare(b.date ?? "9999") ||
    (a.startTime ?? "99").localeCompare(b.startTime ?? "99") ||
    b.priority - a.priority ||
    a.id - b.id
  );
}
