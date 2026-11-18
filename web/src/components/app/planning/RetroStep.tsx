import type { RetroItem, RetroKind, SprintStats } from "@shared/types.ts";
import { ArrowRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { hoverProps, markStyle, PartnerTag, usePartnerMark } from "@/lib/hover";
import { useStore } from "@/lib/store";
import { RETRO_LABEL } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { fmtSp, UserAvatar } from "../common";
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

function RetroCard({ item }: { item: RetroItem }) {
  const { state } = useStore();
  const mark = usePartnerMark(`retro:${item.id}`);
  return (
    <div
      {...hoverProps(`retro:${item.id}`)}
      className={cn("group relative flex items-start gap-2 rounded-md bg-muted/60 p-2 text-sm", mark && "ring-2")}
      style={markStyle(mark)}
    >
      <PartnerTag mark={mark} />
      <UserAvatar user={state.users.find((u) => u.id === item.userId)} className="size-5" />
      <p className="flex-1 whitespace-pre-wrap">{item.text}</p>
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

function Column({ kind, sprintId, items }: { kind: RetroKind; sprintId: number; items: RetroItem[] }) {
  const [text, setText] = useState("");
  const add = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!text.trim()) return;
    setText("");
    await api.post(`/api/retro/${sprintId}`, { kind, text });
  };
  return (
    <section className={cn("flex flex-col gap-2 rounded-lg border border-t-4 p-3", KIND_STYLE[kind])}>
      <h3 className="text-sm font-medium">{RETRO_LABEL[kind]}</h3>
      {items.map((i) => (
        <RetroCard key={i.id} item={i} />
      ))}
      <form onSubmit={add}>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ekle…" className="h-8" />
      </form>
    </section>
  );
}

export function RetroStep() {
  const { state } = useStore();
  const active = state.activeSprint!;
  const items = useRetro(active.id);
  const stats = useSprintStats().find((s) => s.sprint.id === active.id);
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
