import { CalendarClock, Rocket } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { fmt, shortDate } from "@/lib/dates";
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

  // The sprint week has not begun yet: it can also start by itself at 00:00 of its first day.
  const canSchedule = planned.startDate > state.today;
  const run = async (path: string) => {
    setBusy(true);
    try {
      await api.post(path);
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
      </div>
      {canSchedule ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <StartOption
            icon={<CalendarClock className="size-4" />}
            title="Zamanında başlat"
            when={`${fmt(planned.startDate, "d MMMM EEEE")} 00:00`}
            hint={
              state.activeSprint
                ? `Sprint ${state.activeSprint.number} o zamana kadar sürer. Devreden görevler board'da kalır; o arada bitenler Sprint ${state.activeSprint.number}'e sayılır.`
                : "Sprint o gün kendiliğinden başlar."
            }
            primary
            disabled={busy}
            onClick={() => void run("/api/planning/schedule")}
          />
          <StartOption
            icon={<Rocket className="size-4" />}
            title="Şimdi başlat"
            when="Hemen"
            hint={
              state.activeSprint
                ? `Sprint ${state.activeSprint.number} şimdi kapanır. Sonradan eklenen bitmemiş görevler backloga döner.`
                : "Sprint hemen başlar."
            }
            disabled={busy}
            onClick={() => void run("/api/planning/finish")}
          />
        </div>
      ) : (
        <>
          {state.activeSprint && (
            <p className="text-xs text-muted-foreground">
              Sprint {state.activeSprint.number} kapanır. Sonradan eklenen bitmemiş görevler backloga döner.
            </p>
          )}
          <Button size="lg" className="w-full" onClick={() => void run("/api/planning/finish")} disabled={busy}>
            <Rocket className="size-4" /> Sprinti başlat
          </Button>
        </>
      )}
    </div>
  );
}

function StartOption({
  icon,
  title,
  when,
  hint,
  primary,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  when: string;
  hint: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm">{when}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Button className="mt-auto w-full" variant={primary ? "default" : "outline"} onClick={onClick} disabled={disabled}>
        {icon} {title}
      </Button>
    </div>
  );
}
