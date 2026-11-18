// Read-first task view: values are shown as text; a click on a value opens a small editor (popover or inline).
// Each value appears once. See openwiki/requirements.md (Task dialog).
import type { Comment, MarkStatus, Task, TaskDetail, TaskStatus } from "@shared/types.ts";
import { tr } from "date-fns/locale";
import { ArrowRightLeft, CalendarClock, CalendarDays, Check, CheckCheck, Flag, MoreHorizontal, Plus, Repeat, Send, Trash2, Undo2, X, Zap } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { fmt, relativeTime, shortDate } from "@/lib/dates";
import { useStore } from "@/lib/store";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { MarkButtons, timeLabel } from "./calendar/CalendarDialogs";
import { CategoryDot, fmtSp, SpPicker, UserAvatar } from "./common";
import { useConfirm } from "./ConfirmDialog";
import { RuleForm, type RuleDraft } from "./recurring/RecurringPage";
import { TaskHistory } from "./TaskHistory";
import { PartsSection, ProgressControl } from "./TaskParts";

type Patch = Partial<Task> & { assigneeIds?: number[]; unplanned?: boolean };

const STATUS_DOT: Record<TaskStatus, string> = { todo: "bg-muted-foreground/50", in_progress: "bg-blue-500", done: "bg-emerald-500" };
const PRIORITY_COLOR = ["", "text-muted-foreground", "text-amber-500", "text-red-500"];

// Calendar parts: done green, missed red, in the same soft tones as the rest of the UI.
const PART_PILL: Record<MarkStatus, string> = {
  planned: "",
  done: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  missed: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
};
const PART_DOT: Record<MarkStatus, string> = { planned: "bg-muted-foreground/40", done: "bg-emerald-500", missed: "bg-red-500" };

type Look = "pill" | "inline";
const LOOK: Record<Look, string> = {
  pill: "h-7 gap-1.5 rounded-full border px-2.5 text-xs",
  inline: "gap-1 rounded px-1 py-0.5 text-sm text-muted-foreground hover:text-foreground",
};

/** The clickable value: a badge, or plain text ("inline"); shows a hover background. */
function ValueButton({ children, className, disabled, look = "pill", ...rest }: React.ComponentProps<"button"> & { look?: Look }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "inline-flex max-w-full items-center text-left whitespace-nowrap",
        LOOK[look],
        disabled ? "cursor-default" : "hover:bg-accent",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-muted-foreground">{children}</span>;

/** A value with a list of choices in a popover. */
function Choice<T>({
  display,
  options,
  value,
  onSelect,
  disabled,
  look,
  className,
}: {
  look?: Look;
  className?: string;
  display: ReactNode;
  options: { value: T; label: ReactNode; key: string }[];
  value: T;
  onSelect: (v: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (disabled) return <ValueButton disabled look={look} className={className}>{display}</ValueButton>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ValueButton look={look} className={className}>{display}</ValueButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {options.map((o) => {
          const selected = JSON.stringify(o.value) === JSON.stringify(value);
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                if (!selected) onSelect(o.value);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">{o.label}</span>
              {selected && <Check className="size-4 text-muted-foreground" />}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

/** A value whose editor is free content inside a popover. */
function PopoverValue({
  display,
  children,
  width = "w-72",
  look,
  className,
}: {
  display: ReactNode;
  children: (close: () => void) => ReactNode;
  width?: string;
  look?: Look;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ValueButton look={look} className={className}>{display}</ValueButton>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("p-3", width)}>
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

function ProgressRow({ task, onComplete }: { task: Task; onComplete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="-mx-2 block w-[calc(100%+1rem)] space-y-1.5 rounded-md px-2 py-1.5 text-left hover:bg-accent">
          <span className="flex items-center justify-between text-xs text-muted-foreground">
            İlerleme
            <span className="tabular-nums">
              %{task.progress}
              {task.progressManual != null && " · elle"}
            </span>
          </span>
          <span className="block h-1.5 w-full rounded-full bg-muted">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${task.progress}%` }} />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="space-y-3">
          <ProgressControl key={`${task.progress}-${task.progressManual}-${task.status}`} task={task} />
          {task.blocks.length > 1 && task.status !== "done" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onComplete();
                setOpen(false);
              }}
            >
              <CheckCheck className="size-4" /> Görevi tamamla
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const toDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function toRuleDraft(t: Task): RuleDraft {
  return {
    title: t.title,
    description: t.description,
    categoryId: t.categoryId,
    freq: "weekly",
    weekdaysMask: t.date ? 1 << ((new Date(`${t.date}T00:00:00Z`).getUTCDay() + 6) % 7) : 0,
    startTime: t.startTime,
    endTime: t.endTime,
    defaultSp: t.sp,
    active: true,
    assigneeIds: t.assigneeIds,
  };
}

export function TaskView({ id, blockId, onClose }: { id: number; blockId?: number; onClose: () => void }) {
  const { state, patchTask, deleteTask } = useStore();
  const ask = useConfirm();
  const task = state.tasks[id];
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [editTitle, setEditTitle] = useState(false);
  const [editDesc, setEditDesc] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [comment, setComment] = useState("");
  const [convert, setConvert] = useState(false);

  const load = useCallback(() => {
    void api.get<TaskDetail>(`/api/tasks/${id}`).then(setDetail).catch(() => {});
  }, [id]);
  useEffect(load, [load, task?.updatedAt]);

  const t: Task | undefined = task ?? detail ?? undefined;
  if (!t) return <div className="p-6 text-sm text-muted-foreground">Yükleniyor…</div>;

  const update = (patch: Patch) => void patchTask(id, patch).then(load);
  const users = state.users;
  const owners = t.assigneeIds.map((uid) => users.find((u) => u.id === uid)).filter((u) => !!u);
  const category = state.categories.find((c) => c.id === t.categoryId);
  const rule = t.recurringRuleId ? state.rules.find((r) => r.id === t.recurringRuleId) : null;
  const inActive = t.sprintId !== null && t.sprintId === state.activeSprint?.id;
  const block = blockId ? t.blocks.find((b) => b.id === blockId) : undefined;
  const overdue = t.dueDate && t.status !== "done" && t.dueDate < state.today;
  const sprintName = (sid: number | null) =>
    sid === null
      ? "Backlog"
      : sid === state.activeSprint?.id
        ? `Sprint ${state.activeSprint.number}`
        : sid === state.plannedSprint?.id
          ? `Sprint ${state.plannedSprint.number} (planlanan)`
          : "Eski sprint";

  const mark = (status: MarkStatus) => block && void api.patch(`/api/blocks/${block.id}`, { status });
  const addItem = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!newItem.trim()) return;
    await api.post(`/api/tasks/${id}/checklist`, { text: newItem });
    setNewItem("");
    load();
  };
  const addComment = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!comment.trim()) return;
    await api.post<Comment>(`/api/tasks/${id}/comments`, { body: comment });
    setComment("");
    load();
  };
  const remove = async () => {
    if (!(await ask({ title: "Görev silinsin mi?", description: "Takvim parçaları, kontrol listesi ve yorumlar da silinir." }))) return;
    await deleteTask(id);
    onClose();
  };

  const ownerOptions = [
    ...users.map((u) => ({ key: String(u.id), value: [u.id], label: (<><UserAvatar user={u} className="size-5" /> {u.name}</>) })),
    {
      key: "both",
      value: users.map((u) => u.id),
      label: (
        <>
          <span className="flex -space-x-1.5">
            {users.map((u) => (
              <UserAvatar key={u.id} user={u} className="size-5 ring-1 ring-background" />
            ))}
          </span>
          Ortak
        </>
      ),
    },
  ];

  // Property editors. Each one renders as a badge ("pill") or as plain text ("inline").
  const f = {
    owner: (look: Look) => (
      <Choice
        look={look}
        value={[...t.assigneeIds].sort()}
        options={ownerOptions.map((o) => ({ ...o, value: [...o.value].sort() }))}
        onSelect={(assigneeIds) => update({ assigneeIds })}
        display={
          <>
            {look !== "inline" && (
              <span className="flex -space-x-1.5">
                {owners.map((u) => (
                  <UserAvatar key={u!.id} user={u!} className="size-4 ring-1 ring-background" />
                ))}
              </span>
            )}
            {owners.length > 1 ? "Ortak" : owners[0]?.name}
          </>
        }
      />
    ),
    status: (look: Look, className?: string) => (
      <Choice
        look={look}
        className={className}
        value={t.status}
        options={(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => ({
          key: s,
          value: s,
          label: (<><span className={cn("size-2 rounded-full", STATUS_DOT[s])} /> {STATUS_LABEL[s]}</>),
        }))}
        onSelect={(status) => update({ status })}
        display={<><span className={cn("size-2 rounded-full", STATUS_DOT[t.status])} /> {STATUS_LABEL[t.status]}</>}
      />
    ),
    sp: (look: Look) => (
      <PopoverValue look={look} width="w-auto" display={t.sp == null ? <Muted>Puansız</Muted> : `${fmtSp(t.sp)} SP`}>
        {(close) => (
          <SpPicker
            size="sm"
            value={t.sp}
            onChange={(sp) => {
              update({ sp });
              close();
            }}
          />
        )}
      </PopoverValue>
    ),
    category: (look: Look) => (
      <Choice
        look={look}
        value={t.categoryId}
        options={[
          { key: "none", value: null as number | null, label: <Muted>Yok</Muted> },
          ...state.categories
            .filter((c) => !c.archived || c.id === t.categoryId)
            .map((c) => ({ key: String(c.id), value: c.id as number | null, label: (<><CategoryDot category={c} /> {c.name}</>) })),
        ]}
        onSelect={(categoryId) => update({ categoryId })}
        display={category ? <><CategoryDot category={category} /> {category.name}</> : <Muted>Kategori yok</Muted>}
      />
    ),
    priority: (look: Look) => (
      <Choice
        look={look}
        value={t.priority}
        options={PRIORITY_LABEL.map((l, i) => ({
          key: String(i),
          value: i,
          label: i === 0 ? <Muted>Yok</Muted> : (<><Flag className={cn("size-3.5", PRIORITY_COLOR[i])} /> {l}</>),
        }))}
        onSelect={(priority) => update({ priority })}
        display={
          t.priority === 0 ? <Muted>Öncelik yok</Muted> : (<><Flag className={cn("size-3.5", PRIORITY_COLOR[t.priority])} /> {PRIORITY_LABEL[t.priority]}</>)
        }
      />
    ),
    due: (look: Look) => (
      <PopoverValue
        look={look}
        width="w-auto"
        display={
          <>
            <CalendarClock className="size-3.5 text-muted-foreground" />
            {t.dueDate ? <span className={cn(overdue && "text-red-500")}>{fmt(t.dueDate, "d MMM, EEE")}</span> : <Muted>Son tarih yok</Muted>}
          </>
        }
      >
        {(close) => (
          <div className="space-y-2">
            <Calendar
              mode="single"
              locale={tr}
              weekStartsOn={1}
              selected={t.dueDate ? toDate(t.dueDate) : undefined}
              defaultMonth={t.dueDate ? toDate(t.dueDate) : undefined}
              onSelect={(d) => {
                update({ dueDate: d ? toStr(d) : null });
                close();
              }}
              className="p-0"
            />
            {t.dueDate && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  update({ dueDate: null });
                  close();
                }}
              >
                Temizle
              </Button>
            )}
          </div>
        )}
      </PopoverValue>
    ),
    calendar: (look: Look) => (
      <PopoverValue
        look={look}
        className={t.blocks.length === 1 ? PART_PILL[t.blocks[0].status] : undefined}
        width="w-[min(34rem,94vw)]"
        display={
          <>
            <CalendarDays className="size-3.5 text-muted-foreground" />
            {t.blocks.length === 0 ? (
              <Muted>Takvimde yok</Muted>
            ) : t.blocks.length === 1 ? (
              <>
                {t.blocks[0].status === "done" && <Check className="size-3.5" />}
                {t.blocks[0].status === "missed" && <X className="size-3.5" />}
                {`${shortDate(t.blocks[0].date)} ${timeLabel(t.blocks[0])}`}
              </>
            ) : (
              <>
                <span className="flex gap-0.5">
                  {t.blocks.map((b) => (
                    <span key={b.id} className={cn("size-1.5 rounded-full", PART_DOT[b.status])} />
                  ))}
                </span>
                {t.blocks.length} parça
              </>
            )}
          </>
        }
      >
        {() => <PartsSection task={t} />}
      </PopoverValue>
    ),
  };

  return (
    <div>
      {/* Header: title (click to edit) and the more menu. */}
      <DialogHeader className="border-b p-4 pr-20">
        <DialogTitle className="sr-only">{t.title}</DialogTitle>
        <DialogDescription className="sr-only">Görev ayrıntıları</DialogDescription>
        {editTitle ? (
          <Input
            autoFocus
            defaultValue={t.title}
            onBlur={(e) => {
              if (e.target.value.trim() && e.target.value !== t.title) update({ title: e.target.value });
              setEditTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                e.stopPropagation();
                setEditTitle(false);
              }
            }}
            className="-mx-2 h-9 px-2 text-lg font-semibold"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditTitle(true)}
            className={cn("-mx-2 rounded-md px-2 py-1 text-left text-lg leading-snug font-semibold hover:bg-accent", t.status === "done" && "line-through opacity-70")}
          >
            {t.title}
          </button>
        )}
        {/* Who, status and points as one plain line under the title. */}
        <div className="-ml-1 flex flex-wrap items-center text-sm text-muted-foreground">
          {f.owner("inline")}
          <span className="px-0.5">·</span>
          {f.status("inline")}
          <span className="px-0.5">·</span>
          {f.sp("inline")}
        </div>
        {(t.unplannedAt || rule || (t.carriedFromSprintId && !t.recurringRuleId) || !inActive) && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {!inActive && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{sprintName(t.sprintId)}</span>
            )}
            {t.unplannedAt && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2 py-0.5 text-xs text-orange-600 dark:text-orange-400">
                <Zap className="size-3" /> Plan dışı
              </span>
            )}
            {rule && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                <Repeat className="size-3" /> Tekrarlayan: {rule.title}
              </span>
            )}
            {t.carriedFromSprintId && !t.recurringRuleId && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                <Undo2 className="size-3" /> Devreden
              </span>
            )}
          </div>
        )}
      </DialogHeader>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="absolute top-3 right-11 size-8" aria-label="Diğer seçenekler">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {inActive && (
            <DropdownMenuItem onSelect={() => update({ unplanned: !t.unplannedAt })}>
              <Zap className="text-orange-500" /> {t.unplannedAt ? "Plan dışı işaretini kaldır" : "Plan dışı işaretle"}
            </DropdownMenuItem>
          )}
          {!t.recurringRuleId && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowRightLeft /> Sprinti değiştir
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {[null, state.activeSprint?.id, state.plannedSprint?.id]
                  .filter((sid) => sid !== undefined)
                  .map((sid) => (
                    <DropdownMenuItem key={String(sid)} disabled={sid === t.sprintId} onSelect={() => update({ sprintId: sid as number | null })}>
                      {sprintName(sid as number | null)}
                      {sid === t.sprintId && <Check className="ml-auto" />}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {!t.recurringRuleId && (
            <DropdownMenuItem onSelect={() => setConvert(true)}>
              <Repeat /> Tekrarlayana çevir
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
            <Trash2 /> Görevi sil
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="space-y-5 p-4">
        {/* The calendar part this view was opened from: asks done / not done while it is still planned.
            After marking, the line goes away; the Takvim badge shows the result in color. */}
        {block && block.status === "planned" && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
            <span className="text-sm">
              <span className="text-muted-foreground">Bu parça · </span>
              {fmt(block.date, "d MMM EEE")} {timeLabel(block)}
            </span>
            <div className="ml-auto">
              <MarkButtons size="sm" status="planned" onChange={mark} />
            </div>
          </div>
        )}

        {/* Other properties as badges, edited on click. */}
        <div className="flex flex-wrap gap-1.5">
          {f.category("pill")}
          {f.priority("pill")}
          {f.due("pill")}
          {f.calendar("pill")}
        </div>

        {/* Progress: full-width bar; a click opens the editor. */}
        <ProgressRow task={t} onComplete={() => update({ status: "done" })} />

        {/* Description: text, or a muted placeholder; a click turns it into a textbox. */}
        <section className="space-y-1">
          <h3 className="text-xs text-muted-foreground">Açıklama</h3>
          {editDesc ? (
            <Textarea
              autoFocus
              rows={4}
              defaultValue={t.description}
              placeholder="Detay, kabul kriteri…"
              onBlur={(e) => {
                if (e.target.value !== t.description) update({ description: e.target.value });
                setEditDesc(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setEditDesc(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditDesc(true)}
              className="-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left text-sm whitespace-pre-wrap hover:bg-accent"
            >
              {t.description ? t.description : <Muted>Açıklama ekle…</Muted>}
            </button>
          )}
        </section>

        {/* Checklist: only a small link until it has items. */}
        {t.checklistTotal > 0 || showChecklist ? (
          <section className="space-y-1.5">
            <h3 className="text-xs text-muted-foreground">
              Kontrol listesi {t.checklistTotal > 0 && `· ${t.checklistDone}/${t.checklistTotal}`}
            </h3>
            {detail?.checklist.map((item) => (
              <div key={item.id} className="group flex items-center gap-2">
                <Checkbox checked={item.done} onCheckedChange={(v) => void api.patch(`/api/checklist/${item.id}`, { done: !!v }).then(load)} />
                <span className={cn("flex-1 text-sm", item.done && "text-muted-foreground line-through")}>{item.text}</span>
                <button
                  className="text-muted-foreground opacity-0 group-hover:opacity-100"
                  onClick={() => void api.del(`/api/checklist/${item.id}`).then(load)}
                  aria-label="Maddeyi sil"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            <form onSubmit={addItem}>
              <Input
                autoFocus={showChecklist && t.checklistTotal === 0}
                placeholder="Madde ekle…"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                className="h-8"
              />
            </form>
          </section>
        ) : (
          <button type="button" onClick={() => setShowChecklist(true)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <Plus className="size-3.5" /> Kontrol listesi
          </button>
        )}

        {/* Comments */}
        <section className="space-y-2 border-t pt-4">
          {detail?.comments.map((c) => {
            const u = users.find((x) => x.id === c.userId);
            return (
              <div key={c.id} className="flex gap-2 text-sm">
                <UserAvatar user={u} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{u?.name}</span> · {relativeTime(c.createdAt)}
                  </p>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </div>
              </div>
            );
          })}
          <form onSubmit={addComment} className="flex gap-2">
            <Input placeholder="Yorum yaz…" value={comment} onChange={(e) => setComment(e.target.value)} className="h-8" />
            <Button type="submit" size="icon" variant="ghost" className="size-8 shrink-0" aria-label="Gönder" disabled={!comment.trim()}>
              <Send className="size-4" />
            </Button>
          </form>
        </section>

        <TaskHistory taskId={t.id} version={t.updatedAt} />
      </div>

      <Dialog open={convert} onOpenChange={setConvert}>
        <DialogContent className="thin-scroll max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
          {convert && (
            <RuleForm
              title="Tekrarlayana çevir"
              hint="Bu görevden bir tekrarlayan kural oluşur. Görevin günü kurala uyarsa o günün tekrarı olur."
              draft={toRuleDraft(t)}
              onClose={() => setConvert(false)}
              submit={async (body) => {
                const r = await api.post<{ linked: boolean }>(`/api/tasks/${t.id}/to-recurring`, body);
                toast.success(r.linked ? "Görev tekrarlayana çevrildi." : "Kural oluşturuldu. Bu görev normal görev olarak kaldı.");
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
