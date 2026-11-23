import type { RetroItem, RetroKind, SprintStats } from "@shared/types.ts";
import { ArrowRight, Check, ListPlus, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { hoverProps, markStyle, PartnerTag, usePartnerMark } from "@/lib/hover";
import { useStore } from "@/lib/store";
import { RETRO_LABEL } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { fmtSp, UserAvatar } from "../common";
import { useTaskDialog } from "../TaskDialog";
import { goStep } from "./PlanningPage";

const KINDS: RetroKind[] = ["good", "bad", "try"];
const KIND_STYLE: Record<RetroKind, string> = {
  good: "border-t-emerald-500",
  bad: "border-t-red-500",
  try: "border-t-sky-500",
};

/** Live retro items of a sprint. Reloads on retro events. */
export function useRetro(sprintId: number | undefined): RetroItem[] {
  const { state } = useStore();
  const [items, setItems] = useState<RetroItem[]>([]);
  const { versions } = state;
  useEffect(() => {
    if (!sprintId) return;
    void api.get<RetroItem[]>(`/api/retro/${sprintId}`).then(setItems);
  }, [sprintId, versions["retro.upsert"], versions["retro.delete"]]);
  return items;
}

export function useSprintStats(): SprintStats[] {
  const { state } = useStore();
  const [stats, setStats] = useState<SprintStats[]>([]);
  useEffect(() => {
    void api.get<SprintStats[]>("/api/sprints").then(setStats);
  }, [state.activeSprint?.id, state.plannedSprint?.id]);
  return stats;
}

const STATUS_TEXT = { todo: "yapılacak", in_progress: "devam ediyor", done: "yapıldı" } as const;

/** An action turned into a backlog task: shows the task state; a click opens it. */
function ActionTask({ item }: { item: RetroItem }) {
  const { state } = useStore();
  const { openTask } = useTaskDialog();
  const task = item.taskId ? state.tasks[item.taskId] : undefined;
  if (!item.taskId) return null;
  return (
    <button
      type="button"
      onClick={() => openTask(item.taskId!)}
      className={cn(
        "mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
        task?.status === "done" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-sky-500/15 text-sky-700 dark:text-sky-300",
      )}
    >
      <Check className="size-3" /> Görev{task ? ` · ${task.cancelledAt ? "iptal" : STATUS_TEXT[task.status]}` : ""}
    </button>
  );
}

function RetroCard({ item }: { item: RetroItem }) {
  const { state } = useStore();
  const mark = usePartnerMark(`retro:${item.id}`);
  const toTask = async () => {
    const task = await api.post<{ id: number }>("/api/tasks", { title: item.text.slice(0, 200), assigneeIds: [item.userId] });
    await api.patch(`/api/retro/items/${item.id}`, { taskId: task.id });
    toast.success("Aksiyon backloga görev olarak eklendi.");
  };
  return (
    <div
      {...hoverProps(`retro:${item.id}`)}
      className={cn("group relative flex items-start gap-2 rounded-md bg-muted/60 p-2 text-sm", mark && "ring-2")}
      style={markStyle(mark)}
    >
      <PartnerTag mark={mark} />
      <UserAvatar user={state.users.find((u) => u.id === item.userId)} className="size-5" />
      <div className="min-w-0 flex-1">
        <p className="break-words whitespace-pre-wrap">{item.text}</p>
        {item.kind === "try" && <ActionTask item={item} />}
      </div>
      {item.kind === "try" && !item.taskId && (
        <button
          className="text-muted-foreground opacity-70 hover:opacity-100"
          onClick={() => void toTask()}
          title="Göreve çevir (backloga eklenir)"
          aria-label="Göreve çevir"
        >
          <ListPlus className="size-4" />
        </button>
      )}
      <button
        className="text-muted-foreground opacity-60 hover:opacity-100"
        onClick={() => void api.del(`/api/retro/items/${item.id}`)}
        aria-label="Sil"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

const PLACEHOLDER: Record<RetroKind, string> = { good: "İyi giden bir şey…", bad: "Kötü giden bir şey…", try: "Ne yapacağız? (görev olabilir)" };

/** Text box that grows with its text. Enter sends (Shift+Enter: new line); the send button helps on phones. */
function AddItem({ kind, sprintId }: { kind: RetroKind; sprintId: number }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const full = el.scrollHeight + el.offsetHeight - el.clientHeight; // content + borders
    el.style.height = `${Math.min(full, 160)}px`;
    el.style.overflowY = full > 160 ? "auto" : "hidden";
  }, [text]);
  const add = async () => {
    if (!text.trim()) return;
    const value = text;
    setText("");
    await api.post(`/api/retro/${sprintId}`, { kind, text: value });
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
      className="flex items-end gap-1.5"
    >
      <textarea
        ref={ref}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void add();
          }
        }}
        placeholder={PLACEHOLDER[kind]}
        className="thin-scroll min-h-9 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-base leading-snug shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
      />
      <Button type="submit" size="icon" className="size-9 shrink-0 md:hidden" disabled={!text.trim()} aria-label="Ekle">
        <Send className="size-4" />
      </Button>
    </form>
  );
}

function Column({ kind, sprintId, items }: { kind: RetroKind; sprintId: number; items: RetroItem[] }) {
  return (
    <section className={cn("flex flex-col gap-2 rounded-lg border border-t-4 p-3", KIND_STYLE[kind])}>
      <h3 className="text-sm font-medium">{RETRO_LABEL[kind]}</h3>
      {kind === "try" && <p className="-mt-1 text-xs text-muted-foreground">İyi ve kötü gidenlere göre ne yapacağız? Bir aksiyonu tek tıkla göreve çevirin.</p>}
      {items.map((i) => (
        <RetroCard key={i.id} item={i} />
      ))}
      <AddItem kind={kind} sprintId={sprintId} />
    </section>
  );
}

export function RetroStep() {
  const { state } = useStore();
  const active = state.activeSprint!;
  const items = useRetro(active.id);
  const all = useSprintStats();
  const stats = all.find((s) => s.sprint.id === active.id);
  // The actions of the previous retro, to check them now.
  const prev = all.filter((s) => s.sprint.status === "closed").at(-1);
  const prevActions = useRetro(prev?.sprint.id).filter((i) => i.kind === "try");
  return (
    <div className="space-y-5">
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stats.perUser.map((p) => {
            const u = state.users.find((x) => x.id === p.userId);
            const hit = p.targetSp > 0 && p.doneSp >= p.targetSp;
            return (
              <div key={p.userId} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{u?.name}</p>
                <p className="text-xl font-semibold tabular-nums">
                  {fmtSp(p.doneSp)}
                  <span className="text-sm font-normal text-muted-foreground"> / {p.targetSp} SP</span>
                </p>
                <p className={cn("text-xs", hit ? "text-emerald-600" : "text-muted-foreground")}>
                  {hit ? "Hedef tuttu" : "Hedefin altında"}
                </p>
              </div>
            );
          })}
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Tamamlanan görev</p>
            <p className="text-xl font-semibold tabular-nums">
              {stats.doneCount}
              <span className="text-sm font-normal text-muted-foreground"> / {stats.taskCount}</span>
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Toplam SP</p>
            <p className="text-xl font-semibold tabular-nums">
              {fmtSp(stats.totalDoneSp)}
              <span className="text-sm font-normal text-muted-foreground"> / {fmtSp(stats.totalPlannedSp)}</span>
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Plan dışı iş</p>
            <p className="text-xl font-semibold tabular-nums">
              {stats.unplannedCount}
              <span className="text-sm font-normal text-muted-foreground"> iş · {fmtSp(stats.unplannedSp)} SP</span>
            </p>
          </div>
        </div>
      )}
      {prev && prevActions.length > 0 && (
        <section className="space-y-2 rounded-lg border p-3">
          <h3 className="text-sm font-medium">Geçen retronun aksiyonları · Sprint {prev.sprint.number}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {prevActions.map((i) => (
              <div key={i.id} className="flex items-start gap-2 rounded-md bg-muted/60 p-2 text-sm">
                <UserAvatar user={state.users.find((u) => u.id === i.userId)} className="size-5" />
                <div className="min-w-0 flex-1">
                  <p className="break-words whitespace-pre-wrap">{i.text}</p>
                  {i.taskId ? <ActionTask item={i} /> : <span className="text-[11px] text-muted-foreground">göreve çevrilmedi</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        {KINDS.map((k) => (
          <Column key={k} kind={k} sprintId={active.id} items={items.filter((i) => i.kind === k)} />
        ))}
      </div>
      <div className="flex justify-end">
        <Button onClick={() => void goStep("grooming")}>
          Grooming'e geç <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
