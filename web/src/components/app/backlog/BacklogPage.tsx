import type { Task } from "@shared/types.ts";
import { ArrowRight, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useStore, useTasks } from "@/lib/store";
import { CategoryDot, EmptyState, ViewTabs, sumSp, fmtSp } from "../common";
import { useTaskDialog } from "../TaskDialog";
import { BacklogList, type SortMode } from "./BacklogList";

export function useSortMode(): [SortMode, (m: SortMode) => void] {
  const [mode, setMode] = useState<SortMode>(() => {
    try {
      return (localStorage.getItem("la.backlogSort") as SortMode) || "smart";
    } catch {
      return "smart";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("la.backlogSort", mode);
    } catch {}
  }, [mode]);
  return [mode, setMode];
}

export function SortToggle({ mode, setMode }: { mode: SortMode; setMode: (m: SortMode) => void }) {
  return (
    <ToggleGroup type="single" size="sm" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as SortMode)}>
      <ToggleGroupItem value="smart" className="px-2.5 text-xs">
        Akıllı
      </ToggleGroupItem>
      <ToggleGroupItem value="manual" className="px-2.5 text-xs">
        Manuel
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export default function BacklogPage() {
  const { state, patchTask } = useStore();
  const { openNew } = useTaskDialog();
  const [mode, setMode] = useSortMode();
  const [category, setCategory] = useState("all");
  const tasks = useTasks((t) => t.sprintId === null && (category === "all" || String(t.categoryId) === category), [category]);
  const target = state.plannedSprint ?? state.activeSprint;

  const toSprint = (t: Task) =>
    target && (
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        title={state.plannedSprint ? "Planlanan sprinte ekle" : "Aktif sprinte ekle"}
        onClick={() => void patchTask(t.id, { sprintId: target.id })}
      >
        <ArrowRight className="size-4" />
      </Button>
    );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ViewTabs />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm kategoriler</SelectItem>
            {state.categories
              .filter((c) => !c.archived)
              .map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  <CategoryDot category={c} /> {c.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <SortToggle mode={mode} setMode={setMode} />
        <Button size="sm" className="ml-auto" onClick={() => openNew({ sprintId: null })}>
          <Plus className="size-4" /> Görev
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {tasks.length} görev · {fmtSp(sumSp(tasks))} SP ·{" "}
        {mode === "smart" ? "Öncelik ve son tarihe göre sıralı." : "Sürükleyerek sırala."}
      </p>
      {tasks.length === 0 ? (
        <EmptyState title="Backlog boş.">
          <Button variant="outline" size="sm" onClick={() => openNew({ sprintId: null })}>
            İlk görevi ekle
          </Button>
        </EmptyState>
      ) : (
        <BacklogList tasks={tasks} mode={mode} action={toSprint} />
      )}
    </div>
  );
}
