import { Rocket } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { shortDate } from "@/lib/dates";
import { useStore } from "@/lib/store";
import { sumSp, UserAvatar, fmtSp } from "../common";
import { useAvailability, availableDays } from "./EstimationStep";

export function StartStep() {
  const { state } = useStore();
  const planned = state.plannedSprint!;
  const [busy, setBusy] = useState(false);
  const tasks = Object.values(state.tasks).filter((t) => t.sprintId === planned.id);
  const avail = useAvailability(planned.startDate, planned.endDate);
  const missing = tasks.filter((t) => t.sp == null).length;

  const start = async () => {
    setBusy(true);
    try {
      await api.post("/api/planning/finish");
      window.location.href = "/board";
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="space-y-4 rounded-lg border p-4">
        <div>
          <h3 className="font-semibold">Sprint {planned.number}</h3>
          <p className="text-sm text-muted-foreground">
            {shortDate(planned.startDate)} – {shortDate(planned.endDate)} · {tasks.length} görev · {fmtSp(sumSp(tasks))} SP
          </p>
          {planned.goal && <p className="mt-2 text-sm">🎯 {planned.goal}</p>}
        </div>
        <div className="divide-y rounded-md border">
          {state.users.map((u) => {
            const target = planned.members.find((m) => m.userId === u.id)?.targetSp ?? 0;
            const sp = sumSp(tasks, u.id);
            return (
              <div key={u.id} className="flex items-center gap-2 p-2.5 text-sm">
                <UserAvatar user={u} className="size-5" />
                <span className="font-medium">{u.name}</span>
                <span className="text-xs text-muted-foreground">{availableDays(avail, u.id)} gün</span>
                <span className="ml-auto tabular-nums">
                  {fmtSp(sp)} SP planlandı · hedef {target}
                </span>
              </div>
            );
          })}
        </div>
        {missing > 0 && <p className="text-sm text-amber-600">{missing} görevin puanı yok. Yine de başlatabilirsiniz.</p>}
        {state.activeSprint && (
          <p className="text-xs text-muted-foreground">
            Sprint {state.activeSprint.number} kapanır. Sonradan eklenen bitmemiş görevler backloga döner.
          </p>
        )}
      </div>
      <Button size="lg" className="w-full" onClick={start} disabled={busy}>
        <Rocket className="size-4" /> Sprinti başlat
      </Button>
    </div>
  );
}
