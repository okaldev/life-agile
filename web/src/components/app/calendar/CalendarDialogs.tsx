// Calendar dialogs: an empty slot (new task / existing task / event), the list of unmarked past items,
// and the shared done/missed buttons (also used by the task view).
import type { CalendarEvent, MarkStatus, Task, TaskBlock } from "@shared/types.ts";
import { CalendarHeart, Check, ListPlus, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { longDate, shortDate } from "@/lib/dates";
import { useStore } from "@/lib/store";
import { CategoryDot, SpBadge } from "../common";
import { BLOCK_STATUS_LABEL, EVENT_STATUS_LABEL, kindMeta } from "./eventMeta";

export const timeLabel = (x: { startTime: string | null; endTime: string | null }) =>
  x.startTime ? `${x.startTime}${x.endTime ? `–${x.endTime}` : ""}` : "Tüm gün";

export function MarkButtons({
  status,
  onChange,
  labels = BLOCK_STATUS_LABEL,
  size = "default",
}: {
  status: MarkStatus;
  onChange: (s: MarkStatus) => void;
  labels?: Record<MarkStatus, string>;
  size?: "sm" | "default";
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size={size} variant={status === "done" ? "default" : "outline"} onClick={() => onChange("done")}>
        <Check className="size-4" /> {labels.done}
      </Button>
      <Button
        size={size}
        variant={status === "missed" ? "destructive" : "outline"}
        onClick={() => onChange("missed")}
      >
        <X className="size-4" /> {labels.missed}
      </Button>
      {status !== "planned" && (
        <Button size={size} variant="ghost" onClick={() => onChange("planned")}>
          Geri al
        </Button>
      )}
    </div>
  );
}

export interface Slot {
  date: string;
  startTime: string | null;
  endTime: string | null;
}

/** Empty slot chooser: new task, a part for an existing task, or an event. */
export function SlotPanel({
  slot,
  onNewTask,
  onNewEvent,
  onClose,
}: {
  slot: Slot;
  onNewTask: () => void;
  onNewEvent: () => void;
  onClose: () => void;
}) {
  const { state } = useStore();
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const candidates = useMemo(() => {
    const open = new Set([state.activeSprint?.id, state.plannedSprint?.id, null]);
    return Object.values(state.tasks)
      .filter((t) => t.status !== "done" && !t.recurringRuleId && open.has(t.sprintId))
      .filter((t) => t.title.toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr")))
      .sort((a, b) => (a.sprintId === null ? 1 : 0) - (b.sprintId === null ? 1 : 0) || a.id - b.id);
  }, [state.tasks, state.activeSprint, state.plannedSprint, q]);

  const addPart = async (t: Task) => {
    await api.post(`/api/tasks/${t.id}/blocks`, slot);
    onClose();
  };

  return (
    <div>
      <DialogHeader className="border-b p-4">
        <DialogTitle>{longDate(slot.date)}</DialogTitle>
        <DialogDescription>{timeLabel(slot)}</DialogDescription>
      </DialogHeader>
      {!picking ? (
        <div className="grid gap-2 p-4">
          <Button variant="outline" className="h-auto justify-start py-3" onClick={onNewTask}>
            <Plus className="size-4" />
            <span className="text-left">
              <span className="block font-medium">Yeni görev</span>
              <span className="block text-xs text-muted-foreground">Bu saate yeni bir görev oluştur.</span>
            </span>
          </Button>
          <Button variant="outline" className="h-auto justify-start py-3" onClick={() => setPicking(true)}>
            <ListPlus className="size-4" />
            <span className="text-left">
              <span className="block font-medium">Var olan görevin parçası</span>
              <span className="block text-xs text-muted-foreground">Bir görevi bölerek bu saate de yerleştir.</span>
            </span>
          </Button>
          <Button variant="outline" className="h-auto justify-start py-3" onClick={onNewEvent}>
            <CalendarHeart className="size-4" />
            <span className="text-left">
              <span className="block font-medium">Etkinlik</span>
              <span className="block text-xs text-muted-foreground">Buluşma, misafir, dışarıda, meşgul…</span>
            </span>
          </Button>
        </div>
      ) : (
        <div className="space-y-2 p-4">
          <div className="relative">
            <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input autoFocus placeholder="Görev ara…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {candidates.length === 0 && <p className="p-2 text-sm text-muted-foreground">Görev bulunamadı.</p>}
            {candidates.map((t) => (
              <button
                key={t.id}
                onClick={() => void addPart(t)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
              >
                <CategoryDot category={state.categories.find((c) => c.id === t.categoryId)} />
                <span className="flex-1 truncate">{t.title}</span>
                <span className="text-xs text-muted-foreground">
                  {t.sprintId === null ? "backlog" : `${t.blocks.length} parça`}
                </span>
                <SpBadge sp={t.sp} />
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setPicking(false)}>
            ← Geri
          </Button>
        </div>
      )}
    </div>
  );
}

export type UnmarkedItem =
  | { kind: "block"; date: string; startTime: string | null; endTime: string | null; status: MarkStatus; block: TaskBlock; task: Task }
  | { kind: "event"; date: string; startTime: string | null; endTime: string | null; status: MarkStatus; event: CalendarEvent };

export function UnmarkedPanel({ items, onChanged }: { items: UnmarkedItem[]; onChanged: () => void }) {
  const mark = async (it: UnmarkedItem, status: MarkStatus) => {
    if (it.kind === "block") await api.patch(`/api/blocks/${it.block.id}`, { status });
    else await api.patch(`/api/calendar-events/${it.event.id}`, { status });
    onChanged();
  };
  return (
    <div>
      <DialogHeader className="border-b p-4">
        <DialogTitle>İşaretlenmemişler</DialogTitle>
        <DialogDescription>Saati geçmiş ama yapıldı / yapılmadı seçilmemiş kayıtlar.</DialogDescription>
      </DialogHeader>
      <div className="max-h-[60dvh] space-y-2 overflow-y-auto p-4">
        {items.length === 0 && <p className="text-sm text-muted-foreground">Hepsi işaretli. 👍</p>}
        {items.map((it) => {
          const title = it.kind === "block" ? it.task.title : it.event.title;
          const Icon = it.kind === "event" ? kindMeta(it.event.kind).icon : null;
          return (
            <div key={`${it.kind}-${it.kind === "block" ? it.block.id : it.event.id}`} className="space-y-2 rounded-lg border p-2.5">
              <div className="flex items-center gap-2 text-sm">
                {Icon && <Icon className="size-3.5 text-muted-foreground" />}
                <span className="flex-1 truncate font-medium">{title}</span>
                <span className="text-xs text-muted-foreground">
                  {shortDate(it.date)} · {timeLabel(it)}
                </span>
              </div>
              <MarkButtons
                size="sm"
                status={it.status}
                labels={it.kind === "event" ? EVENT_STATUS_LABEL : BLOCK_STATUS_LABEL}
                onChange={(s) => void mark(it, s)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
