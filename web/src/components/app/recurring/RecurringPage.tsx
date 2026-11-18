// Recurring rules: list and form. See openwiki/recurring.md.
import type { RecurringFreq, RecurringRule } from "@shared/types.ts";
import { Clock, Plus, Repeat, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { WEEKDAY_SHORT } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { Assignees, AssigneePicker, CategoryDot, EmptyState, SpBadge, SpPicker } from "../common";
import { useConfirm } from "../ConfirmDialog";

export type RuleDraft = Omit<RecurringRule, "id"> & { id?: number };
type Draft = RuleDraft;

const FREQ_LABEL: Record<RecurringFreq, string> = { daily: "Her gün", weekdays: "Hafta içi", weekly: "Seçili günler" };

export function describeRule(r: Pick<RecurringRule, "freq" | "weekdaysMask" | "startTime" | "endTime">): string {
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
  const valid = d.title.trim() && d.assigneeIds.length > 0 && (d.freq !== "weekly" || d.weekdaysMask > 0);

  const save = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!valid) return;
    const body = {
      title: d.title,
      description: d.description,
      categoryId: d.categoryId,
      freq: d.freq,
      weekdaysMask: d.weekdaysMask,
      startTime: d.startTime,
      endTime: d.startTime ? d.endTime : null,
      defaultSp: d.defaultSp,
      active: d.active,
      assigneeIds: d.assigneeIds,
    };
    if (submit) await submit(body);
    else if (d.id) await api.patch(`/api/recurring/${d.id}`, body);
    else await api.post("/api/recurring", body);
    onClose();
  };

  return (
    <form onSubmit={save}>
      <DialogHeader className="border-b p-4">
        <DialogTitle>{title ?? (d.id ? "Tekrarlayan görevi düzenle" : "Yeni tekrarlayan görev")}</DialogTitle>
        <DialogDescription>{hint ?? "Değişiklik bugünden sonraki açık tekrarlara uygulanır."}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 p-4">
        <Input autoFocus={!d.title} placeholder="Örn. Mesaiye git" value={d.title} onChange={(e) => set({ title: e.target.value })} />
        <Textarea placeholder="Açıklama" rows={2} value={d.description} onChange={(e) => set({ description: e.target.value })} />
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Sıklık</Label>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(FREQ_LABEL) as RecurringFreq[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => set({ freq: f })}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm",
                  d.freq === f ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                )}
              >
                {FREQ_LABEL[f]}
              </button>
            ))}
          </div>
          {d.freq === "weekly" && (
            <div className="grid grid-cols-7 gap-1 pt-1">
              {WEEKDAY_SHORT.map((w, i) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => set({ weekdaysMask: d.weekdaysMask ^ (1 << i) })}
                  className={cn(
                    "rounded-md border py-1.5 text-xs",
                    d.weekdaysMask & (1 << i) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                  )}
                >
                  {w}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Başlangıç (ops.)</Label>
            <Input type="time" value={d.startTime ?? ""} onChange={(e) => set({ startTime: e.target.value || null })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Bitiş</Label>
            <Input
              type="time"
              disabled={!d.startTime}
              value={d.endTime ?? ""}
              onChange={(e) => set({ endTime: e.target.value || null })}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Kimin işi</Label>
          <AssigneePicker value={d.assigneeIds} onChange={(assigneeIds) => set({ assigneeIds })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Kategori</Label>
            <Select
              value={d.categoryId ? String(d.categoryId) : "none"}
              onValueChange={(v) => set({ categoryId: v === "none" ? null : Number(v) })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Yok</SelectItem>
                {state.categories
                  .filter((c) => !c.archived)
                  .map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      <CategoryDot category={c} /> {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Varsayılan SP</Label>
            <SpPicker size="sm" value={d.defaultSp} onChange={(defaultSp) => set({ defaultSp })} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={d.active} onCheckedChange={(active) => set({ active })} /> Aktif
        </label>
      </div>
      <DialogFooter className="border-t p-4">
        <Button type="button" variant="ghost" onClick={onClose}>
          Vazgeç
        </Button>
        <Button type="submit" disabled={!valid}>
          Kaydet
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
