// Task dialog: new-task form and the read-first task view (TaskView.tsx).
import type { Task } from "@shared/types.ts";
import { CalendarDays, Layers3 } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { shortDate } from "@/lib/dates";
import { focusTask, useStore } from "@/lib/store";
import { DatePicker } from "./DatePicker";
import { Choice, Muted, PopoverValue, taskFields, TaskView } from "./TaskView";

export type TaskDraft = Partial<Task> & { assigneeIds?: number[]; unplanned?: boolean; endDate?: string | null };

interface DialogApi {
  /** Opens a task. blockId: the calendar part it was opened from (shows the part line with done/missed). */
  openTask: (id: number, ctx?: { blockId?: number }) => void;
  openNew: (defaults?: TaskDraft) => void;
}

const Ctx = createContext<DialogApi | null>(null);

export function useTaskDialog(): DialogApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTaskDialog outside provider");
  return v;
}

export function TaskDialogProvider({ page, children }: { page: string; children: ReactNode }) {
  const [state, setState] = useState<{ id: number | null; draft: TaskDraft; blockId?: number } | null>(null);
  const openTask = useCallback(
    (id: number, ctx?: { blockId?: number }) => {
      setState({ id, draft: {}, blockId: ctx?.blockId });
      focusTask(page, id);
    },
    [page],
  );
  const openNew = useCallback((draft: TaskDraft = {}) => setState({ id: null, draft }), []);
  const close = () => {
    if (state?.id) focusTask(page, null);
    setState(null);
  };
  return (
    <Ctx.Provider value={{ openTask, openNew }}>
      {children}
      <Dialog open={!!state} onOpenChange={(o) => !o && close()}>
        <DialogContent
          className="thin-scroll max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-lg"
          // Editing: focus nothing on open, so a stray key press cannot replace the selected title.
          onOpenAutoFocus={(e) => {
            if (state?.id) e.preventDefault();
          }}
        >
          {state &&
            (state.id ? (
              <TaskView key={state.id} id={state.id} blockId={state.blockId} onClose={close} />
            ) : (
              <NewTask draft={state.draft} onClose={close} />
            ))}
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}

/** New task: the same layout as the task view (title, owner · status · points, badges), filled before it exists. */
function NewTask({ draft, onClose }: { draft: TaskDraft; onClose: () => void }) {
  const { state, createTask } = useStore();
  const [task, setTask] = useState<TaskDraft>({
    status: "todo",
    priority: 1, // default "Düşük"
    sprintId: null,
    sp: null,
    categoryId: null,
    dueDate: null,
    assigneeIds: state.me ? [state.me.id] : [],
    ...draft,
  });
  const [title, setTitle] = useState(draft.title ?? "");
  const [busy, setBusy] = useState(false);
  const set = (p: TaskDraft) => setTask((t) => ({ ...t, ...p }));
  const f = taskFields(
    { assigneeIds: task.assigneeIds ?? [], status: task.status ?? "todo", sp: task.sp ?? null, categoryId: task.categoryId ?? null, priority: task.priority ?? 1, dueDate: task.dueDate ?? null },
    (p) => set(p as TaskDraft),
    state,
  );
  const sprintOptions = [
    { key: "backlog", value: null as number | null, label: <>Backlog</> },
    ...(state.activeSprint ? [{ key: "a", value: state.activeSprint.id as number | null, label: <>Sprint {state.activeSprint.number} · aktif</> }] : []),
    ...(state.plannedSprint ? [{ key: "p", value: state.plannedSprint.id as number | null, label: <>Sprint {state.plannedSprint.number} · planlanan</> }] : []),
  ];
  const sprintLabel = sprintOptions.find((o) => o.value === (task.sprintId ?? null))?.label ?? <>Backlog</>;
  const submit = async (e?: { preventDefault(): void }) => {
    e?.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await createTask({ ...task, title: title.trim(), assigneeIds: task.assigneeIds ?? [] });
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <DialogHeader className="space-y-1 border-b p-4 pr-12">
        <DialogTitle className="sr-only">Yeni görev</DialogTitle>
        <DialogDescription className="sr-only">Görev bilgilerini girin.</DialogDescription>
        <input
          autoFocus
          placeholder="Görev başlığı"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="-mx-2 w-[calc(100%+1rem)] rounded-md bg-transparent px-2 py-1 text-lg font-semibold outline-none placeholder:text-muted-foreground/60 focus:bg-accent/40"
        />
        <div className="-ml-1 flex flex-wrap items-center text-sm text-muted-foreground">
          {f.owner("inline")}
          <span className="px-0.5">·</span>
          {f.status("inline")}
          <span className="px-0.5">·</span>
          {f.sp("inline")}
        </div>
      </DialogHeader>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap gap-1.5">
          {f.category("pill")}
          {f.priority("pill")}
          {f.due("pill")}
          <ScheduleBadge task={task} onChange={set} />
          <Choice
            look="pill"
            value={task.sprintId ?? null}
            options={sprintOptions}
            onSelect={(sprintId) => set({ sprintId })}
            display={
              <>
                <Layers3 className="size-3.5 text-muted-foreground" />
                {sprintLabel}
              </>
            }
          />
        </div>
        <Textarea
          placeholder="Açıklama ekle…"
          rows={2}
          value={task.description ?? ""}
          onChange={(e) => set({ description: e.target.value })}
          className="resize-none border-dashed shadow-none"
        />
      </div>
      <DialogFooter className="border-t p-4">
        <Button type="button" variant="ghost" onClick={onClose}>
          Vazgeç
        </Button>
        <Button type="submit" disabled={!title.trim() || busy}>
          Oluştur
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Day and time of the new task (its first calendar part). */
function ScheduleBadge({ task, onChange }: { task: TaskDraft; onChange: (patch: TaskDraft) => void }) {
  const label = task.date
    ? task.endDate
      ? `${shortDate(task.date)} – ${shortDate(task.endDate)}`
      : `${shortDate(task.date)}${task.startTime ? ` ${task.startTime}${task.endTime ? `–${task.endTime}` : ""}` : ""}`
    : null;
  return (
    <PopoverValue
      look="pill"
      width="w-72"
      display={
        <>
          <CalendarDays className="size-3.5 text-muted-foreground" />
          {label ?? <Muted>Takvimde yok</Muted>}
        </>
      }
    >
      {() => (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Gün</Label>
            <DatePicker
              clearable
              placeholder="Gün yok"
              value={task.date ?? null}
              onChange={(date) => onChange({ date, ...(date ? {} : { startTime: null, endTime: null, endDate: null }) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Bitiş günü (birden çok gün)</Label>
            <DatePicker
              clearable
              placeholder="Tek gün"
              disabled={!task.date || !!task.startTime}
              value={task.endDate ?? null}
              onChange={(endDate) => onChange({ endDate: endDate && task.date && endDate > task.date ? endDate : null })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Başlangıç</Label>
              <Input type="time" disabled={!task.date || !!task.endDate} value={task.startTime ?? ""} onChange={(e) => onChange({ startTime: e.target.value || null })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Bitiş</Label>
              <Input type="time" disabled={!task.startTime} value={task.endTime ?? ""} onChange={(e) => onChange({ endTime: e.target.value || null })} />
            </div>
          </div>
        </div>
      )}
    </PopoverValue>
  );
}
