// Collapsible change history of a task (closed by default). Data: GET /api/tasks/:id/history.
import type { TaskHistoryEntry, TaskStatus } from "@shared/types.ts";
import { ChevronDown, History } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { relativeTime, shortDate } from "@/lib/dates";
import { useStore } from "@/lib/store";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { fmtSp, UserAvatar } from "./common";

type Part = { date: string; startTime?: string | null; endTime?: string | null; status?: string };

const partLabel = (p: Part | null) =>
  p ? `${shortDate(p.date)}${p.startTime ? ` ${p.startTime}${p.endTime ? `–${p.endTime}` : ""}` : ""}` : "";
const MARK: Record<string, string> = { planned: "planlandı", done: "yapıldı", missed: "yapılmadı" };

function useDescribe() {
  const { state } = useStore();
  const userName = (ids: unknown) => {
    const list = (ids as number[] | null) ?? [];
    if (list.length > 1) return "Ortak";
    return state.users.find((u) => u.id === list[0])?.name ?? "—";
  };
  const category = (id: unknown) => state.categories.find((c) => c.id === id)?.name ?? "Yok";
  const sprint = (id: unknown) =>
    id == null
      ? "Backlog"
      : id === state.activeSprint?.id
        ? `Sprint ${state.activeSprint.number}`
        : id === state.plannedSprint?.id
          ? `Sprint ${state.plannedSprint.number}`
          : "başka bir sprint";
  const sp = (v: unknown) => (v == null ? "puansız" : `${fmtSp(v as number)} SP`);
  const arrow = (a: string, b: string) => (
    <>
      <span className="text-muted-foreground">{a}</span> → {b}
    </>
  );

  return (e: TaskHistoryEntry): React.ReactNode => {
    const o = e.oldValue as any;
    const n = e.newValue as any;
    switch (e.field) {
      case "created":
        return "görevi oluşturdu";
      case "title":
        return <>başlığı değiştirdi: {arrow(`“${o}”`, `“${n}”`)}</>;
      case "description":
        return "açıklamayı güncelledi";
      case "status":
        return <>durumu değiştirdi: {arrow(STATUS_LABEL[o as TaskStatus], STATUS_LABEL[n as TaskStatus])}</>;
      case "sp":
        return <>puanı değiştirdi: {arrow(sp(o), sp(n))}</>;
      case "priority":
        return <>önceliği değiştirdi: {arrow(PRIORITY_LABEL[o ?? 0], PRIORITY_LABEL[n ?? 0])}</>;
      case "categoryId":
        return <>kategoriyi değiştirdi: {arrow(category(o), category(n))}</>;
      case "sprintId":
        return <>taşıdı: {arrow(sprint(o), sprint(n))}</>;
      case "dueDate":
        return <>son tarihi değiştirdi: {arrow(o ? shortDate(o) : "yok", n ? shortDate(n) : "yok")}</>;
      case "assigneeIds":
        return <>kişiyi değiştirdi: {arrow(userName(o), userName(n))}</>;
      case "progressManual":
        return n == null ? "ilerlemeyi otomatiğe döndürdü" : `ilerlemeyi %${n} yaptı`;
      case "unplannedAt":
        return n ? "plan dışı olarak işaretledi" : "plan dışı işaretini kaldırdı";
      case "missedAt":
        return n ? "görev yapılmadı olarak işaretlendi" : "yapılmadı işareti kalktı";
      case "part.add":
        return `takvime parça ekledi: ${partLabel(n)}`;
      case "part.remove":
        return `takvim parçasını sildi: ${partLabel(o)}`;
      case "part.move":
        return <>parçayı taşıdı: {arrow(partLabel(o), partLabel(n))}</>;
      case "part.status":
        return `${shortDate(n.date)} parçasını ${MARK[n.status] ?? n.status} olarak işaretledi`;
      case "checklist.add":
        return `kontrol listesine ekledi: “${n}”`;
      case "checklist.done":
        return n?.done ? `“${n.text}” maddesini tamamladı` : `“${n?.text}” maddesini geri aldı`;
      case "comment":
        return "yorum yaptı";
      default:
        return e.field;
    }
  };
}

export function TaskHistory({ taskId, version }: { taskId: number; version: string }) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<TaskHistoryEntry[] | null>(null);
  const describe = useDescribe();

  useEffect(() => {
    if (!open) return;
    void api.get<TaskHistoryEntry[]>(`/api/tasks/${taskId}/history`).then(setEntries).catch(() => {});
  }, [open, taskId, version]);

  return (
    <section className="border-t pt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <History className="size-3.5" /> Geçmiş
        <ChevronDown className={cn("ml-auto size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ol className="mt-3 space-y-2.5">
          {entries === null && <li className="text-xs text-muted-foreground">Yükleniyor…</li>}
          {entries?.map((e) => {
            const u = state.users.find((x) => x.id === e.userId);
            return (
              <li key={`${e.id}-${e.field}-${e.createdAt}`} className="flex gap-2 text-xs">
                {u ? <UserAvatar user={u} className="size-4" /> : <span className="size-4 shrink-0 rounded-full bg-muted" />}
                <p className="min-w-0 flex-1 leading-snug">
                  <span className="font-medium">{u?.name ?? "Sistem"}</span> {describe(e)}
                  <span className="text-muted-foreground"> · {relativeTime(e.createdAt)}</span>
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
