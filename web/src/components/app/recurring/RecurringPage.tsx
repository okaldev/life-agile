// Recurring rules: list and form. See openwiki/recurring.md.
import type { RecurringFreq, RecurringRule } from "@shared/types.ts";
import { Clock, Plus, Repeat, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { WEEKDAY_SHORT } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { Assignees, CategoryDot, EmptyState, SpBadge } from "../common";
import { useConfirm } from "../ConfirmDialog";
import { Muted, PopoverValue, taskFields } from "../TaskView";

export type RuleDraft = Omit<RecurringRule, "id"> & { id?: number };
type Draft = RuleDraft;

const FREQ_LABEL: Record<RecurringFreq, string> = { daily: "Her gün", weekdays: "Hafta içi", weekly: "Seçili günler" };

export function describeRule(r: Pick<RecurringRule, "freq" | "weekdaysMask" | "startTime" | "endTime" | "timesPerWeek">): string {
  if (r.timesPerWeek) return `Haftada ${r.timesPerWeek} kez · gün serbest`;
  const days =
    r.freq === "weekly" ? WEEKDAY_SHORT.filter((_, i) => r.weekdaysMask & (1 << i)).join(", ") || "gün yok" : FREQ_LABEL[r.freq];
  const time = r.startTime ? ` · ${r.startTime}${r.endTime ? `–${r.endTime}` : ""}` : "";
  return days + time;
}

export function RuleForm({
  draft,
  onClose,
  submit,
  title,
  hint,
}: {
  draft: Draft;
  onClose: () => void;
  /** Custom save (e.g. convert a task). Default: create or update a rule. */
  submit?: (body: Record<string, unknown>) => Promise<void>;
  title?: string;
  hint?: string;
}) {
  const { state } = useStore();
  const [d, setD] = useState<Draft>(draft);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const flex = !!d.timesPerWeek;
  const valid = d.title.trim() && d.assigneeIds.length > 0 && (flex || d.freq !== "weekly" || d.weekdaysMask > 0);

  const save = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!valid) return;
    const body = {
      title: d.title,
      description: d.description,
      categoryId: d.categoryId,
      freq: d.freq,
      weekdaysMask: d.weekdaysMask,
      startTime: flex ? null : d.startTime,
      endTime: !flex && d.startTime ? d.endTime : null,
      timesPerWeek: d.timesPerWeek,
      defaultSp: d.defaultSp,
      active: d.active,
      assigneeIds: d.assigneeIds,
    };
    if (submit) await submit(body);
    else if (d.id) await api.patch(`/api/recurring/${d.id}`, body);
    else await api.post("/api/recurring", body);
    onClose();
  };

  // Shared pickers of the task view: people, default SP, category.
  const f = taskFields(
    { assigneeIds: d.assigneeIds, status: "todo", sp: d.defaultSp, categoryId: d.categoryId, priority: 0, dueDate: null },
    (p) => {
      if (p.assigneeIds) set({ assigneeIds: p.assigneeIds });
      if ("sp" in p) set({ defaultSp: p.sp ?? null });
      if ("categoryId" in p) set({ categoryId: p.categoryId ?? null });
    },
    state,
  );
  const freqText = flex
    ? `Haftada ${d.timesPerWeek} kez`
    : d.freq === "weekly"
      ? WEEKDAY_SHORT.filter((_, i) => d.weekdaysMask & (1 << i)).join(", ") || "Gün seçin"
      : FREQ_LABEL[d.freq];
  const choice = (active: boolean) =>
    cn("rounded-md border px-2.5 py-1.5 text-sm", active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent");

  return (
    <form onSubmit={save}>
      <DialogHeader className="space-y-1 border-b p-4 pr-12">
        <DialogTitle className={cn(!title && "sr-only")}>{title ?? (d.id ? "Tekrarlayan görevi düzenle" : "Yeni tekrarlayan görev")}</DialogTitle>
        <DialogDescription className={cn(!hint && "sr-only")}>{hint ?? "Değişiklik bugünden sonraki açık tekrarlara uygulanır."}</DialogDescription>
        <input
          autoFocus={!d.title}
          placeholder="Tekrarlayan görev (örn. Mesaiye git)"
          value={d.title}
          onChange={(e) => set({ title: e.target.value })}
          className="-mx-2 w-[calc(100%+1rem)] rounded-md bg-transparent px-2 py-1 text-lg font-semibold outline-none placeholder:text-muted-foreground/60 focus:bg-accent/40"
        />
        <div className="-ml-1 flex flex-wrap items-center text-sm text-muted-foreground">
          {f.owner("inline")}
          <span className="px-0.5">·</span>
          {f.sp("inline")}
          <span className="px-0.5 text-xs">her tekrar</span>
        </div>
      </DialogHeader>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap gap-1.5">
          <PopoverValue
            look="pill"
            width="w-80"
            className={cn(!flex && d.freq === "weekly" && d.weekdaysMask === 0 && "border-amber-500/60 text-amber-700 dark:text-amber-300")}
            display={
              <>
                <Repeat className="size-3.5 text-muted-foreground" />
                {freqText}
              </>
            }
          >
            {() => (
              <div className="space-y-2.5">
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(FREQ_LABEL) as RecurringFreq[]).map((fr) => (
                    <button key={fr} type="button" onClick={() => set({ freq: fr, timesPerWeek: null })} className={choice(!flex && d.freq === fr)}>
                      {FREQ_LABEL[fr]}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => set({ freq: "weekly", weekdaysMask: 0, timesPerWeek: d.timesPerWeek ?? 2 })}
                    className={choice(flex)}
                  >
                    Haftada N kez
                  </button>
                </div>
                {flex && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      {[1, 2, 3, 4, 5, 6].map((n) => (
                        <button key={n} type="button" onClick={() => set({ timesPerWeek: n })} className={cn("size-8", choice(d.timesPerWeek === n))}>
                          {n}
                        </button>
                      ))}
                      <span className="text-sm text-muted-foreground">kez / hafta</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Her sprintte bu kadar günsüz görev oluşur. Günü takvime sürükleyerek siz seçersiniz.</p>
                  </div>
                )}
                {!flex && d.freq === "weekly" && (
                  <div className="grid grid-cols-7 gap-1">
                    {WEEKDAY_SHORT.map((w, i) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => set({ weekdaysMask: d.weekdaysMask ^ (1 << i) })}
                        className={cn("rounded-md border py-1.5 text-xs", d.weekdaysMask & (1 << i) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </PopoverValue>
          {!flex && (
            <PopoverValue
              look="pill"
              width="w-64"
              display={
                <>
                  <Clock className="size-3.5 text-muted-foreground" />
                  {d.startTime ? `${d.startTime}${d.endTime ? `–${d.endTime}` : ""}` : <Muted>Saat yok · tüm gün</Muted>}
                </>
              }
            >
              {() => (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Başlangıç</Label>
                    <Input type="time" value={d.startTime ?? ""} onChange={(e) => set({ startTime: e.target.value || null })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Bitiş</Label>
                    <Input type="time" disabled={!d.startTime} value={d.endTime ?? ""} onChange={(e) => set({ endTime: e.target.value || null })} />
                  </div>
                </div>
              )}
            </PopoverValue>
          )}
          {f.category("pill")}
          <button
            type="button"
            onClick={() => set({ active: !d.active })}
            aria-pressed={d.active}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs",
              d.active ? "hover:bg-accent" : "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            )}
            title="Durdurulan kural yeni tekrar oluşturmaz"
          >
            <span className={cn("size-2 rounded-full", d.active ? "bg-emerald-500" : "bg-amber-500")} />
            {d.active ? "Aktif" : "Durduruldu"}
          </button>
        </div>
        <Textarea
          placeholder="Açıklama ekle…"
          rows={2}
          value={d.description}
          onChange={(e) => set({ description: e.target.value })}
          className="resize-none border-dashed shadow-none"
        />
      </div>
      <DialogFooter className="border-t p-4">
        <Button type="button" variant="ghost" onClick={onClose}>
          Vazgeç
        </Button>
        <Button type="submit" disabled={!valid}>
          {d.id ? "Kaydet" : "Oluştur"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export default function RecurringPage() {
  const { state } = useStore();
  const [draft, setDraft] = useState<Draft | null>(null);
  const empty = (): Draft => ({
    title: "",
    description: "",
    categoryId: null,
    freq: "weekdays",
    weekdaysMask: 0,
    startTime: null,
    endTime: null,
    defaultSp: 1,
    active: true,
    assigneeIds: state.me ? [state.me.id] : [],
    timesPerWeek: null,
  });
  const ask = useConfirm();
  const remove = async (r: RecurringRule) => {
    if (!(await ask({ title: `"${r.title}" silinsin mi?`, description: "Gelecekteki açık tekrarları da silinir. Geçmiş kayıtlar kalır." })))
      return;
    await api.del(`/api/recurring/${r.id}`);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">Tekrarlayan görevler her sprintte otomatik oluşur.</p>
        <Button size="sm" className="ml-auto" onClick={() => setDraft(empty())}>
          <Plus className="size-4" /> Ekle
        </Button>
      </div>
      {state.rules.length === 0 ? (
        <EmptyState title="Henüz tekrarlayan görev yok.">
          <Button variant="outline" size="sm" onClick={() => setDraft({ ...empty(), title: "Mesaiye git", startTime: "09:00", endTime: "18:00" })}>
            Örnek: Mesaiye git
          </Button>
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {state.rules.map((r) => (
            <div key={r.id} className={cn("flex items-center gap-3 rounded-lg border p-3", !r.active && "opacity-50")}>
              <Repeat className="size-4 shrink-0 text-muted-foreground" />
              <button className="min-w-0 flex-1 text-left" onClick={() => setDraft({ ...r })}>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <CategoryDot category={state.categories.find((c) => c.id === r.categoryId)} />
                  {r.title}
                  {!r.active && <span className="text-xs font-normal text-muted-foreground">(duraklatıldı)</span>}
                </p>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="size-3" /> {describeRule(r)}
                </p>
              </button>
              <Assignees ids={r.assigneeIds} />
              <SpBadge sp={r.defaultSp} />
              <Button variant="ghost" size="icon" className="size-8" onClick={() => remove(r)} aria-label="Sil">
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent
          className="thin-scroll max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-lg"
          // Do not focus (and select) the first field on open; empty forms focus their title with autoFocus.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {draft && <RuleForm draft={draft} onClose={() => setDraft(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
