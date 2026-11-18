// Task dialog: new-task form and the read-first task view (TaskView.tsx).
import type { Task } from "@shared/types.ts";
import { ChevronDown } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { focusTask, useStore } from "@/lib/store";
import { PRIORITY_LABEL } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { AssigneePicker, CategoryDot, SpPicker } from "./common";
import { DatePicker } from "./DatePicker";
import { TaskView } from "./TaskView";

export type TaskDraft = Partial<Task> & { assigneeIds?: number[]; unplanned?: boolean };

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

const NONE = "none";

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function CategorySelect({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const { state } = useStore();
  return (
    <Select value={value ? String(value) : NONE} onValueChange={(v) => onChange(v === NONE ? null : Number(v))}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Yok</SelectItem>
        {state.categories
          .filter((c) => !c.archived || c.id === value)
          .map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              <CategoryDot category={c} /> {c.name}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

function PrioritySelect({ value, onChange }: { value: number; onChange: (p: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PRIORITY_LABEL.map((l, i) => (
          <SelectItem key={i} value={String(i)}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SprintSelect({ value, onChange, disabled }: { value: number | null; onChange: (id: number | null) => void; disabled?: boolean }) {
  const { state } = useStore();
  const options = [
    { value: NONE, label: "Backlog" },
    ...(state.activeSprint ? [{ value: String(state.activeSprint.id), label: `Aktif sprint (${state.activeSprint.number})` }] : []),
    ...(state.plannedSprint ? [{ value: String(state.plannedSprint.id), label: `Planlanan sprint (${state.plannedSprint.number})` }] : []),
  ];
  return (
    <Select value={value ? String(value) : NONE} disabled={disabled} onValueChange={(v) => onChange(v === NONE ? null : Number(v))}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ScheduleFields({ task, onChange }: { task: TaskDraft; onChange: (patch: TaskDraft) => void }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <Field label="Gün" className="col-span-3 sm:col-span-1">
        <DatePicker
          clearable
          placeholder="Gün yok"
          value={task.date ?? null}
          onChange={(date) => onChange({ date, ...(date ? {} : { startTime: null, endTime: null }) })}
        />
      </Field>
      <Field label="Başlangıç">
        <Input type="time" disabled={!task.date} value={task.startTime ?? ""} onChange={(e) => onChange({ startTime: e.target.value || null })} />
      </Field>
      <Field label="Bitiş">
        <Input type="time" disabled={!task.startTime} value={task.endTime ?? ""} onChange={(e) => onChange({ endTime: e.target.value || null })} />
      </Field>
    </div>
  );
}

/** Category, priority, sprint, due date: the "Detaylar" group. */
function DetailFields({ task, onChange }: { task: TaskDraft; onChange: (patch: TaskDraft) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Kategori">
        <CategorySelect value={task.categoryId ?? null} onChange={(categoryId) => onChange({ categoryId })} />
      </Field>
      <Field label="Öncelik">
        <PrioritySelect value={task.priority ?? 0} onChange={(priority) => onChange({ priority })} />
      </Field>
      <Field label="Sprint">
        <SprintSelect value={task.sprintId ?? null} disabled={!!task.recurringRuleId} onChange={(sprintId) => onChange({ sprintId })} />
      </Field>
      <Field label="Son tarih">
        <DatePicker clearable placeholder="Yok" value={task.dueDate ?? null} onChange={(dueDate) => onChange({ dueDate })} />
      </Field>
    </div>
  );
}

function NewTask({ draft, onClose }: { draft: TaskDraft; onClose: () => void }) {
  const { state, createTask } = useStore();
  const [task, setTask] = useState<TaskDraft>({
    status: "todo",
    priority: 1, // default "Düşük"
    sprintId: null,
    assigneeIds: state.me ? [state.me.id] : [],
    ...draft,
  });
  const [title, setTitle] = useState(draft.title ?? "");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (p: TaskDraft) => setTask((t) => ({ ...t, ...p }));
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
      <DialogHeader className="border-b p-4">
        <DialogTitle>Yeni görev</DialogTitle>
        <DialogDescription className="sr-only">Görev bilgilerini girin.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 p-4">
        <Input autoFocus placeholder="Görev başlığı" value={title} onChange={(e) => setTitle(e.target.value)} className="text-base" />
        <Field label="Kimin işi">
          <AssigneePicker value={task.assigneeIds ?? []} onChange={(assigneeIds) => set({ assigneeIds })} />
        </Field>
        <Field label="Story point">
          <SpPicker value={task.sp ?? null} onChange={(sp) => set({ sp })} />
        </Field>
        <Field label="Sprint">
          <SprintSelect value={task.sprintId ?? null} onChange={(sprintId) => set({ sprintId })} />
        </Field>
        <ScheduleFields task={task} onChange={set} />
        <button
          type="button"
          onClick={() => setMore(!more)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={cn("size-4 transition-transform", more && "rotate-180")} /> Daha fazla
        </button>
        {more && (
          <div className="space-y-4">
            <Field label="Açıklama">
              <Textarea
                placeholder="Detay, kabul kriteri…"
                rows={3}
                value={task.description ?? ""}
                onChange={(e) => set({ description: e.target.value })}
              />
            </Field>
            <DetailFields task={task} onChange={set} />
          </div>
        )}
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
