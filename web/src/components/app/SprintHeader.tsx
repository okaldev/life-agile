// Sprint summary: dates, goal, SP done vs target per person (targets editable).
import type { Sprint, Task } from "@shared/types.ts";
import { Pencil, Zap } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import { daysBetween, shortDate } from "@/lib/dates";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { UserAvatar, sumSp, fmtSp } from "./common";

export function TargetEditor({ sprint, userId, value }: { sprint: Sprint; userId: number; value: number }) {
  const [v, setV] = useState(String(value));
  const [open, setOpen] = useState(false);
  const save = async () => {
    const n = Math.max(0, Math.round(Number(v) || 0));
    await api.put(`/api/sprints/${sprint.id}/members/${userId}`, { targetSp: n });
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), setV(String(value)))}>
      <PopoverTrigger
        className="inline-flex items-center gap-1 rounded border border-transparent px-1.5 py-0.5 hover:border-border hover:bg-accent"
        aria-label="Hedefi düzenle"
      >
        {value} <Pencil className="size-3 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-44 p-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-2"
        >
          <p className="text-xs text-muted-foreground">Hedef SP</p>
          <Input type="number" min={0} value={v} onChange={(e) => setV(e.target.value)} autoFocus className="h-8" />
        </form>
      </PopoverContent>
    </Popover>
  );
}

export function SpProgress({
  sprint,
  tasks,
  mode = "done",
}: {
  sprint: Sprint;
  tasks: Task[];
  /** done: SP done vs target. planned: SP planned vs target (estimation). */
  mode?: "done" | "planned";
}) {
  const { state } = useStore();
  const counted = mode === "done" ? tasks.filter((t) => t.status === "done") : tasks;
  const rows = state.users.map((u) => {
    const target = sprint.members.find((m) => m.userId === u.id)?.targetSp ?? 0;
    return { user: u, value: sumSp(counted, u.id), target };
  });
  const totalTarget = rows.reduce((s, r) => s + r.target, 0);
  const total = sumSp(counted);
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {rows.map((r) => (
        <div key={r.user.id} className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm">
            <UserAvatar user={r.user} className="size-5" />
            <span className="font-medium">{r.user.name}</span>
            <span className="ml-auto text-muted-foreground tabular-nums">
              {fmtSp(r.value)} / <TargetEditor sprint={sprint} userId={r.user.id} value={r.target} /> SP
            </span>
          </div>
          <Progress
            value={r.target ? Math.min(100, (r.value / r.target) * 100) : 0}
            className={cn("h-1.5", r.target && r.value > r.target && mode === "planned" && "[&>div]:bg-amber-500")}
          />
        </div>
      ))}
      <div className="space-y-1.5">
        <div className="flex items-center text-sm">
          <span className="font-medium">Toplam</span>
          <span className="ml-auto text-muted-foreground tabular-nums">
            {fmtSp(total)} / {totalTarget} SP
          </span>
        </div>
        <Progress value={totalTarget ? Math.min(100, (total / totalTarget) * 100) : 0} className="h-1.5" />
      </div>
    </div>
  );
}

export function GoalEditor({ sprint }: { sprint: Sprint }) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <Input
        autoFocus
        defaultValue={sprint.goal}
        placeholder="Bu haftanın hedefi…"
        className="h-8"
        onBlur={async (e) => {
          if (e.target.value !== sprint.goal) await api.patch(`/api/sprints/${sprint.id}`, { goal: e.target.value });
          setEditing(false);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    );
  return (
    <button onClick={() => setEditing(true)} className="text-left text-sm text-muted-foreground hover:text-foreground">
      {sprint.goal ? <>🎯 {sprint.goal}</> : "+ Sprint hedefi ekle"}
    </button>
  );
}

/** One-row sprint summary for the board: name, dates, goal, SP per person (target editable). */
export function CompactSprintHeader({ sprint, tasks }: { sprint: Sprint; tasks: Task[] }) {
  const { state } = useStore();
  const left = daysBetween(state.today, sprint.endDate);
  const done = tasks.filter((t) => t.status === "done");
  const rows = state.users.map((u) => ({
    user: u,
    value: sumSp(done, u.id),
    target: sprint.members.find((m) => m.userId === u.id)?.targetSp ?? 0,
  }));
  const totalTarget = rows.reduce((s, r) => s + r.target, 0);
  const unplanned = tasks.filter((t) => t.unplannedAt);
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border px-3 py-2">
      <div className="min-w-0 flex-1 basis-56">
        <p className="flex items-baseline gap-2 text-sm">
          <span className="font-semibold">Sprint {sprint.number}</span>
          <span className="truncate text-xs text-muted-foreground">
            {shortDate(sprint.startDate)} – {shortDate(sprint.endDate)} ·{" "}
            {left > 0 ? `${left} gün kaldı` : left === 0 ? "son gün" : "süre doldu"}
          </span>
        </p>
        <div className="truncate text-xs [&_button]:text-xs">
          <GoalEditor sprint={sprint} />
        </div>
      </div>
      {rows.map((r) => (
        <div key={r.user.id} className="flex items-center gap-2 text-xs">
          <UserAvatar user={r.user} className="size-5" />
          <div className="w-24 space-y-1">
            <div className="flex items-center justify-between tabular-nums text-muted-foreground">
              <span className="font-medium text-foreground">{r.user.name}</span>
              <span className="flex items-center">
                {fmtSp(r.value)}/<TargetEditor sprint={sprint} userId={r.user.id} value={r.target} />
              </span>
            </div>
            <Progress value={r.target ? Math.min(100, (r.value / r.target) * 100) : 0} className="h-1" />
          </div>
        </div>
      ))}
      <div className="w-24 space-y-1 text-xs">
        <div className="flex justify-between tabular-nums text-muted-foreground">
          <span className="font-medium text-foreground">Toplam</span>
          {fmtSp(sumSp(done))}/{totalTarget}
        </div>
        <Progress value={totalTarget ? Math.min(100, (sumSp(done) / totalTarget) * 100) : 0} className="h-1" />
      </div>
      {unplanned.length > 0 && (
        <span className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400" title="Sprint içinde sonradan eklenen işler">
          <Zap className="size-3.5" /> {unplanned.length} plan dışı · {fmtSp(sumSp(unplanned))} SP
        </span>
      )}
    </div>
  );
}

export function SprintHeader({ sprint, tasks }: { sprint: Sprint; tasks: Task[] }) {
  const { state } = useStore();
  const left = daysBetween(state.today, sprint.endDate);
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-semibold">Sprint {sprint.number}</h2>
        <span className="text-sm text-muted-foreground">
          {shortDate(sprint.startDate)} – {shortDate(sprint.endDate)} ·{" "}
          {left > 0 ? `${left} gün kaldı` : left === 0 ? "son gün" : "süre doldu"}
        </span>
      </div>
      <GoalEditor sprint={sprint} />
      <SpProgress sprint={sprint} tasks={tasks} />
      <UnplannedSummary tasks={tasks} />
    </div>
  );
}

/** Work added after the sprint started (change requests). */
export function UnplannedSummary({ tasks }: { tasks: Task[] }) {
  const list = tasks.filter((t) => t.unplannedAt);
  if (list.length === 0) return null;
  const done = list.filter((t) => t.status === "done");
  return (
    <p className="flex flex-wrap items-center gap-1 text-xs text-orange-600 dark:text-orange-400">
      <Zap className="size-3.5" /> Plan dışı: {list.length} iş · {fmtSp(sumSp(list))} SP
      <span className="text-muted-foreground">
        ({done.length} tamamlandı, {fmtSp(sumSp(done))} SP)
      </span>
    </p>
  );
}
