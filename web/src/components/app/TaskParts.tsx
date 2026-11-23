// Task dialog sections: calendar parts (split a task) and completion percentage.
import type { Task, TaskBlock } from "@shared/types.ts";
import { Check, MoveRight, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useConfirm } from "./ConfirmDialog";
import { DatePicker } from "./DatePicker";

function PartRow({ block, index }: { block: TaskBlock; index: number }) {
  const patch = (body: Partial<TaskBlock>) => void api.patch(`/api/blocks/${block.id}`, body);
  const ask = useConfirm();
  const remove = async () => {
    if (await ask({ title: "Bu parça silinsin mi?", description: "Görev kalır, sadece bu takvim parçası silinir." }))
      void api.del(`/api/blocks/${block.id}`);
  };
  const [multi, setMulti] = useState(!!block.endDate);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-6 text-xs text-muted-foreground">{index + 1}.</span>
        <DatePicker
          size="sm"
          className="h-8 w-[9.5rem]"
          value={block.date}
          onChange={(date) => date && date !== block.date && patch({ date })}
        />
        <Input
          type="time"
          defaultValue={block.startTime ?? ""}
          disabled={!!block.endDate}
          className="h-8 w-[5.5rem] px-2"
          onBlur={(e) => (e.target.value || null) !== block.startTime && patch({ startTime: e.target.value || null })}
        />
        <Input
          type="time"
          defaultValue={block.endTime ?? ""}
          disabled={!block.startTime}
          className="h-8 w-[5.5rem] px-2"
          onBlur={(e) => (e.target.value || null) !== block.endTime && patch({ endTime: e.target.value || null })}
        />
        {/* Fixed-width toggle: ✓ done, ✕ missed. A click on the active one sets the part back to planned. */}
        <div className="flex h-8 overflow-hidden rounded-md border" role="group" aria-label="Parça durumu">
          <button
            type="button"
            onClick={() => patch({ status: block.status === "done" ? "planned" : "done" })}
            title={block.status === "done" ? "Yapıldı (geri almak için tıkla)" : "Yapıldı"}
            aria-pressed={block.status === "done"}
            className={cn(
              "flex w-8 items-center justify-center text-muted-foreground hover:bg-accent",
              block.status === "done" && "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400",
            )}
          >
            <Check className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => patch({ status: block.status === "missed" ? "planned" : "missed" })}
            title={block.status === "missed" ? "Yapılmadı (geri almak için tıkla)" : "Yapılmadı"}
            aria-pressed={block.status === "missed"}
            className={cn(
              "flex w-8 items-center justify-center border-l text-muted-foreground hover:bg-accent",
              block.status === "missed" && "bg-red-500/15 text-red-600 hover:bg-red-500/20 dark:text-red-400",
            )}
          >
            <X className="size-4" />
          </button>
        </div>
        <Button variant="ghost" size="icon" className="size-8" onClick={remove} aria-label="Parçayı sil">
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {/* Multi-day part: an end date (no times); drawn as one bar across the days. */}
      {multi ? (
        <div className="flex items-center gap-1.5 pl-7 text-xs text-muted-foreground">
          <MoveRight className="size-3.5" /> Bitiş günü
          <DatePicker
            size="sm"
            clearable
            className="h-7 w-[9.5rem]"
            placeholder="Tek gün"
            value={block.endDate}
            onChange={(endDate) => {
              patch({ endDate: endDate && endDate > block.date ? endDate : null });
              if (!endDate) setMulti(false);
            }}
          />
        </div>
      ) : (
        <button type="button" onClick={() => setMulti(true)} className="pl-7 text-xs text-muted-foreground hover:text-foreground">
          + Birden çok gün
        </button>
      )}
    </div>
  );
}

export function PartsSection({ task }: { task: Task }) {
  const { state } = useStore();
  const add = () => {
    const last = task.blocks.at(-1);
    void api.post(`/api/tasks/${task.id}/blocks`, { date: last?.date ?? state.today });
  };
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">Takvim parçaları</h3>
        <span className="text-xs text-muted-foreground">{task.blocks.length === 0 ? "takvimde yok" : `${task.blocks.length} parça`}</span>
        {!task.recurringRuleId && (
          <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={add}>
            <Plus className="size-3.5" /> Parça ekle
          </Button>
        )}
      </div>
      {task.blocks.map((b, i) => (
        // key includes the values, so the inputs reset after a remote change
        <PartRow key={`${b.id}-${b.date}-${b.startTime}-${b.endTime}`} block={b} index={i} />
      ))}
      {task.blocks.length === 0 && (
        <p className="text-xs text-muted-foreground">Görevi takvimde birden çok zamana bölmek için parça ekleyin.</p>
      )}
    </section>
  );
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Same rule as the server (server/src/domain/blocks.ts computeProgress) without the manual value. */
export function autoProgress(task: Task): number {
  if (task.status === "done") return 100;
  if (task.blocks.length) {
    const len = (b: TaskBlock) => (b.startTime && b.endTime ? Math.max(15, toMin(b.endTime) - toMin(b.startTime)) : 60);
    const total = task.blocks.reduce((s, b) => s + len(b), 0);
    const done = task.blocks.filter((b) => b.status === "done").reduce((s, b) => s + len(b), 0);
    return Math.round((done / total) * 100);
  }
  if (task.checklistTotal) return Math.round((task.checklistDone / task.checklistTotal) * 100);
  return 0;
}

/**
 * Progress editor: slider (step 5) and quick buttons. Any change sets a manual value;
 * "Otomatik" removes it. Used in the task dialog and in the calendar part popup.
 */
export function ProgressControl({ task }: { task: Task }) {
  const { patchTask } = useStore();
  const manual = task.progressManual != null;
  const [value, setValue] = useState(task.progress);
  const save = (v: number) => {
    setValue(v);
    if (v !== task.progressManual) void patchTask(task.id, { progressManual: v });
  };
  const auto = autoProgress(task);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium tabular-nums">%{value}</span>
        <span className="text-xs text-muted-foreground">{manual ? "elle" : "otomatik"}</span>
        <div className="ml-auto flex gap-1">
          {[25, 50, 75].map((n) => (
            <Button
              key={n}
              type="button"
              size="sm"
              variant={value === n ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              disabled={task.status === "done"}
              onClick={() => save(n)}
            >
              %{n}
            </Button>
          ))}
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        disabled={task.status === "done"}
        onChange={(e) => setValue(Number(e.target.value))}
        onPointerUp={() => save(value)}
        onKeyUp={() => save(value)}
        className="w-full accent-primary"
        aria-label="İlerleme yüzdesi"
      />
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {task.status === "done"
          ? "Görev tamamlandı."
          : manual
            ? `Otomatik hesap: %${auto}`
            : task.blocks.length
              ? "Yapılan parçaların süresinden hesaplanır."
              : task.checklistTotal
                ? "Kontrol listesinden hesaplanır."
                : "Kaydırarak elle ayarlayın."}
        {manual && task.status !== "done" && (
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => void patchTask(task.id, { progressManual: null })}
          >
            Otomatiğe dön
          </button>
        )}
      </p>
    </div>
  );
}

export function ProgressSection({ task }: { task: Task }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">İlerleme</h3>
      <ProgressControl key={`${task.progress}-${task.progressManual}-${task.status}`} task={task} />
    </section>
  );
}
