// Create / edit a general calendar event (optionally repeating).
import type { CalendarEvent, EventKind, MarkStatus, RecurringFreq } from "@shared/types.ts";
import { Repeat, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { WEEKDAY_SHORT } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { AssigneePicker } from "../common";
import { EVENT_KINDS, EVENT_STATUS_LABEL } from "./eventMeta";
import { useConfirm } from "../ConfirmDialog";
import { DatePicker } from "../DatePicker";

export interface EventDraft {
  id?: number;
  ruleId?: number | null;
  title?: string;
  note?: string;
  kind?: EventKind;
  date: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  attendeeIds?: number[];
  status?: MarkStatus;
}

type Repeat = "none" | RecurringFreq;
const REPEAT_LABEL: Record<Repeat, string> = { none: "Tekrar yok", daily: "Her gün", weekdays: "Hafta içi", weekly: "Seçili günler" };

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm",
        active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

export function EventForm({ draft, onClose }: { draft: EventDraft; onClose: () => void }) {
  const { state } = useStore();
  const ask = useConfirm();
  const [d, setD] = useState({
    title: draft.title ?? "",
    note: draft.note ?? "",
    kind: draft.kind ?? ("meet" as EventKind),
    date: draft.date,
    endDate: draft.endDate ?? null,
    startTime: draft.startTime ?? null,
    endTime: draft.endTime ?? null,
    attendeeIds: draft.attendeeIds ?? (state.me ? [state.me.id] : []),
    status: draft.status ?? ("planned" as MarkStatus),
  });
  const [repeat, setRepeat] = useState<Repeat>("none");
  const [mask, setMask] = useState(0);
  const [wholeSeries, setWholeSeries] = useState(false);
  const set = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));
  const editing = !!draft.id;
  const valid = d.title.trim() && d.attendeeIds.length > 0 && (repeat !== "weekly" || mask > 0);

  const save = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!valid) return;
    const fields = {
      title: d.title,
      note: d.note,
      kind: d.kind,
      startTime: d.startTime,
      endTime: d.startTime ? d.endTime : null,
      attendeeIds: d.attendeeIds,
    };
    if (!editing) {
      await api.post("/api/calendar-events", {
        ...fields,
        date: d.date,
        endDate: repeat === "none" && !d.startTime ? d.endDate : null,
        ...(repeat !== "none" ? { repeat: { freq: repeat, weekdaysMask: mask } } : {}),
      });
    } else if (wholeSeries && draft.ruleId) {
      await api.patch(`/api/event-rules/${draft.ruleId}`, fields);
      await api.patch(`/api/calendar-events/${draft.id}`, { status: d.status });
    } else {
      await api.patch(`/api/calendar-events/${draft.id}`, {
        ...fields,
        date: d.date,
        status: d.status,
        ...(draft.ruleId ? {} : { endDate: d.startTime ? null : d.endDate }),
      });
    }
    onClose();
  };

  const remove = async () => {
    const ok = await ask(
      draft.ruleId
        ? { title: "Bu tekrar silinsin mi?", description: "Seri devam eder. Bu gün 'Gerçekleşmedi' olarak kalır." }
        : { title: "Etkinlik silinsin mi?" },
    );
    if (!ok) return;
    await api.del(`/api/calendar-events/${draft.id}`);
    onClose();
  };
  const removeSeries = async () => {
    const ok = await ask({
      title: "Tüm seri silinsin mi?",
      description: "Geçmiş tekrarlar kalır. Gelecekteki planlı tekrarlar silinir.",
      confirmText: "Seriyi sil",
    });
    if (!ok) return;
    await api.del(`/api/event-rules/${draft.ruleId}`);
    onClose();
  };

  return (
    <form onSubmit={save}>
      <DialogHeader className="border-b p-4">
        <DialogTitle>{editing ? "Etkinlik" : "Yeni etkinlik"}</DialogTitle>
        <DialogDescription>Etkinlikler sprintten bağımsızdır, SP'ye sayılmaz.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 p-4">
        <Input autoFocus={!editing} placeholder="Örn. Arkadaşlarla yemek" value={d.title} onChange={(e) => set({ title: e.target.value })} />
        <div className="flex flex-wrap gap-1.5">
          {EVENT_KINDS.map((k) => (
            <Chip key={k.kind} active={d.kind === k.kind} onClick={() => set({ kind: k.kind })}>
              <k.icon className="size-3.5" /> {k.label}
            </Chip>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Kim</Label>
          <AssigneePicker value={d.attendeeIds} onChange={(attendeeIds) => set({ attendeeIds })} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-3 space-y-1.5 sm:col-span-1">
            <Label className="text-xs text-muted-foreground">Gün</Label>
            <DatePicker value={d.date} disabled={wholeSeries} onChange={(date) => date && set({ date })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Başlangıç</Label>
            <Input type="time" value={d.startTime ?? ""} onChange={(e) => set({ startTime: e.target.value || null })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Bitiş</Label>
            <Input type="time" disabled={!d.startTime} value={d.endTime ?? ""} onChange={(e) => set({ endTime: e.target.value || null })} />
          </div>
        </div>
        {!d.startTime && repeat === "none" && !draft.ruleId ? (
          <div className="-mt-1 grid grid-cols-3 gap-3">
            <div className="col-span-3 space-y-1.5 sm:col-span-1">
              <Label className="text-xs text-muted-foreground">Bitiş günü (ops.)</Label>
              <DatePicker clearable placeholder="Tek gün" value={d.endDate} onChange={(endDate) => set({ endDate: endDate && endDate > d.date ? endDate : null })} />
            </div>
            <p className="col-span-3 self-end text-xs text-muted-foreground sm:col-span-2">Saat boşsa tüm gün sayılır. Bitiş günü seçerseniz takvimde günler boyunca tek çubuk olur.</p>
          </div>
        ) : (
          <p className="-mt-2 text-xs text-muted-foreground">Saat boşsa tüm gün sayılır.</p>
        )}
        {!editing && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Tekrar</Label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(REPEAT_LABEL) as Repeat[]).map((r) => (
                <Chip key={r} active={repeat === r} onClick={() => setRepeat(r)}>
                  {REPEAT_LABEL[r]}
                </Chip>
              ))}
            </div>
            {repeat === "weekly" && (
              <div className="grid grid-cols-7 gap-1 pt-1">
                {WEEKDAY_SHORT.map((w, i) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setMask(mask ^ (1 << i))}
                    className={cn("rounded-md border py-1.5 text-xs", mask & (1 << i) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
                  >
                    {w}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {editing && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Durum</Label>
            <div className="flex flex-wrap gap-1.5">
              {(["planned", "done", "missed"] as MarkStatus[]).map((s) => (
                <Chip key={s} active={d.status === s} onClick={() => set({ status: s })}>
                  {EVENT_STATUS_LABEL[s]}
                </Chip>
              ))}
            </div>
          </div>
        )}
        <Textarea placeholder="Not" rows={2} value={d.note} onChange={(e) => set({ note: e.target.value })} />
        {editing && draft.ruleId && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={wholeSeries} onCheckedChange={(v) => setWholeSeries(!!v)} />
            <Repeat className="size-3.5" /> Değişikliği tüm seriye uygula (gelecek tekrarlar)
          </label>
        )}
      </div>
      <DialogFooter className="flex-row flex-wrap justify-between gap-2 border-t p-4 sm:justify-between">
        <div className="flex gap-1">
          {editing && (
            <Button type="button" variant="ghost" className="text-destructive" onClick={remove}>
              <Trash2 className="size-4" /> Sil
            </Button>
          )}
          {editing && draft.ruleId && (
            <Button type="button" variant="ghost" className="text-destructive" onClick={removeSeries}>
              Seriyi sil
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={!valid}>
            Kaydet
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

export function eventToDraft(e: CalendarEvent): EventDraft {
  return { ...e };
}
