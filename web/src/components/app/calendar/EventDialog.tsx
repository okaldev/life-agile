// Create / edit a general calendar event (optionally repeating).
import type { CalendarEvent, EventKind, MarkStatus, RecurringFreq } from "@shared/types.ts";
import { CalendarDays, Repeat, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { fmt, shortDate } from "@/lib/dates";
import { useStore } from "@/lib/store";
import { WEEKDAY_SHORT } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { EVENT_KINDS, EVENT_STATUS_LABEL } from "./eventMeta";
import { useConfirm } from "../ConfirmDialog";
import { DatePicker } from "../DatePicker";
import { TimePicker } from "../TimePicker";
import { Choice, Muted, PopoverValue, taskFields } from "../TaskView";

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

  const people = taskFields(
    { assigneeIds: d.attendeeIds, status: "todo", sp: null, categoryId: null, priority: 0, dueDate: null },
    (p) => p.assigneeIds && set({ attendeeIds: p.assigneeIds }),
    state,
  ).owner;
  const kind = EVENT_KINDS.find((k) => k.kind === d.kind) ?? EVENT_KINDS[0];
  const when = d.endDate
    ? `${shortDate(d.date)} – ${shortDate(d.endDate)}`
    : `${fmt(d.date, "d MMM, EEE")}${d.startTime ? ` ${d.startTime}${d.endTime ? `–${d.endTime}` : ""}` : " · tüm gün"}`;
  const repeatText =
    repeat === "none"
      ? null
      : repeat === "weekly"
        ? WEEKDAY_SHORT.filter((_, i) => mask & (1 << i)).join(", ") || "gün seçin"
        : REPEAT_LABEL[repeat];

  return (
    <form onSubmit={save}>
      <DialogHeader className="space-y-1 border-b p-4 pr-12">
        <DialogTitle className="sr-only">{editing ? "Etkinlik" : "Yeni etkinlik"}</DialogTitle>
        <DialogDescription className="sr-only">Etkinlikler sprintten bağımsızdır, SP'ye sayılmaz.</DialogDescription>
        <input
          autoFocus={!editing}
          placeholder="Etkinlik adı (örn. Arkadaşlarla yemek)"
          value={d.title}
          onChange={(e) => set({ title: e.target.value })}
          className="-mx-2 w-[calc(100%+1rem)] rounded-md bg-transparent px-2 py-1 text-lg font-semibold outline-none placeholder:text-muted-foreground/60 focus:bg-accent/40"
        />
        <div className="-ml-1 flex flex-wrap items-center text-sm text-muted-foreground">
          <Choice
            look="inline"
            value={d.kind}
            options={EVENT_KINDS.map((k) => ({ key: k.kind, value: k.kind, label: (<><k.icon className="size-3.5" style={{ color: k.color }} /> {k.label}</>) }))}
            onSelect={(k) => set({ kind: k })}
            display={<><kind.icon className="size-3.5" style={{ color: kind.color }} /> {kind.label}</>}
          />
          <span className="px-0.5">·</span>
          {people("inline")}
          {editing && (
            <>
              <span className="px-0.5">·</span>
              <Choice
                look="inline"
                value={d.status}
                options={(["planned", "done", "missed"] as MarkStatus[]).map((st) => ({ key: st, value: st, label: <>{EVENT_STATUS_LABEL[st]}</> }))}
                onSelect={(st) => set({ status: st })}
                display={
                  <span className={cn(d.status === "done" && "text-emerald-600 dark:text-emerald-400", d.status === "missed" && "text-red-600 dark:text-red-400")}>
                    {EVENT_STATUS_LABEL[d.status]}
                  </span>
                }
              />
            </>
          )}
        </div>
      </DialogHeader>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap gap-1.5">
          <PopoverValue
            look="pill"
            width="w-72"
            display={
              <>
                <CalendarDays className="size-3.5 text-muted-foreground" />
                {when}
              </>
            }
          >
            {() => (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Gün</Label>
                  <DatePicker value={d.date} disabled={wholeSeries} onChange={(date) => date && set({ date, endDate: d.endDate && d.endDate > date ? d.endDate : null })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Başlangıç</Label>
                    <TimePicker disabled={!!d.endDate} value={d.startTime} onChange={(startTime) => set({ startTime })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Bitiş</Label>
                    <TimePicker disabled={!d.startTime} value={d.endTime} near={d.startTime} onChange={(endTime) => set({ endTime })} />
                  </div>
                </div>
                {!d.startTime && repeat === "none" && !draft.ruleId && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Bitiş günü (birden çok gün)</Label>
                    <DatePicker clearable placeholder="Tek gün" value={d.endDate} onChange={(endDate) => set({ endDate: endDate && endDate > d.date ? endDate : null })} />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Saat boşsa tüm gün sayılır.</p>
              </div>
            )}
          </PopoverValue>
          {!editing && (
            <PopoverValue
              look="pill"
              width="w-72"
              display={
                <>
                  <Repeat className="size-3.5 text-muted-foreground" />
                  {repeatText ?? <Muted>Tekrar yok</Muted>}
                </>
              }
            >
              {() => (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(REPEAT_LABEL) as Repeat[]).map((r) => (
                      <Chip key={r} active={repeat === r} onClick={() => setRepeat(r)}>
                        {REPEAT_LABEL[r]}
                      </Chip>
                    ))}
                  </div>
                  {repeat === "weekly" && (
                    <div className="grid grid-cols-7 gap-1">
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
            </PopoverValue>
          )}
          {editing && draft.ruleId && (
            <button
              type="button"
              onClick={() => setWholeSeries(!wholeSeries)}
              aria-pressed={wholeSeries}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs",
                wholeSeries ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              <Repeat className="size-3.5" /> {wholeSeries ? "Tüm seriye uygulanacak" : "Sadece bu tekrar"}
            </button>
          )}
        </div>
        <Textarea
          placeholder="Not ekle…"
          rows={2}
          value={d.note}
          onChange={(e) => set({ note: e.target.value })}
          className="resize-none border-dashed shadow-none"
        />
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
            {editing ? "Kaydet" : "Oluştur"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

export function eventToDraft(e: CalendarEvent): EventDraft {
  return { ...e };
}
