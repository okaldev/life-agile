// Planning wizard: Retro -> Grooming -> Estimation -> Start. Shared live by both users.
// See openwiki/sprint-flow.md.
import type { PlanningStep } from "@shared/types.ts";
import { CalendarClock, Check, Pencil, Rocket, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { fmt, shortDate } from "@/lib/dates";
import { useStore } from "@/lib/store";
import { STEP_LABEL } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { EmptyState, fmtSp, sumSp } from "../common";
import { EstimationStep } from "./EstimationStep";
import { GroomingStep } from "./GroomingStep";
import { RetroStep } from "./RetroStep";
import { PlanWeek } from "./PlanWeek";
import { StartStep } from "./StartStep";
import { useConfirm } from "../ConfirmDialog";

const STEPS: PlanningStep[] = ["retro", "grooming", "estimation", "start"];

export function goStep(step: PlanningStep) {
  return api.post("/api/planning/step", { step });
}

function Stepper({ current, hasRetro }: { current: PlanningStep; hasRetro: boolean }) {
  const steps = hasRetro ? STEPS : STEPS.slice(1);
  const idx = steps.indexOf(current);
  return (
    <ol className="flex items-center gap-1 overflow-x-auto text-sm">
      {steps.map((s, i) => (
        <li key={s} className="flex shrink-0 items-center gap-1">
          {i > 0 && <span className="mx-1 h-px w-4 bg-border sm:w-8" />}
          <button
            onClick={() => s !== current && void goStep(s)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1",
              s === current ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
            )}
          >
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full border text-[11px]",
                s === current && "border-primary-foreground/40",
              )}
            >
              {i < idx ? <Check className="size-3" /> : i + 1}
            </span>
            {STEP_LABEL[s]}
          </button>
        </li>
      ))}
    </ol>
  );
}

/** A plan made early: it starts by itself at 00:00 of its first day. */
function ScheduledPlan() {
  const { state } = useStore();
  const ask = useConfirm();
  const planned = state.plannedSprint!;
  const tasks = Object.values(state.tasks).filter((t) => t.sprintId === planned.id && !t.cancelledAt);
  const active = state.activeSprint;

  const startNow = async () => {
    const ok = await ask({
      title: `Sprint ${planned.number} şimdi başlasın mı?`,
      description: active
        ? `Sprint ${active.number} şimdi kapanır. Sonradan eklenen bitmemiş görevler backloga döner.`
        : "Sprint hemen başlar.",
      confirmText: "Şimdi başlat",
      destructive: false,
    });
    if (!ok) return;
    await api.post("/api/planning/finish");
    window.location.href = "/board";
  };
  const edit = () => void api.post("/api/planning/start");
  const cancel = async () => {
    const ok = await ask({
      title: "Plan iptal edilsin mi?",
      description: "Görevler eski yerlerine döner. Retro notları kalır.",
      confirmText: "Planı iptal et",
      cancelText: "Vazgeç",
    });
    if (!ok) return;
    await api.post("/api/planning/cancel");
    window.location.href = "/board";
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex items-start gap-3">
          <span className="rounded-md bg-primary/10 p-2 text-primary">
            <CalendarClock className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold">Sprint {planned.number} planlandı</h2>
            <p className="text-sm text-muted-foreground">
              {shortDate(planned.startDate)} – {shortDate(planned.endDate)} · {tasks.length} görev · {fmtSp(sumSp(tasks))} SP
            </p>
          </div>
        </div>
        {planned.goal && <p className="text-sm">🎯 {planned.goal}</p>}
        <p className="rounded-md bg-muted/60 p-3 text-sm">
          <b>{fmt(planned.startDate, "d MMMM EEEE")} 00:00</b>'da kendiliğinden başlar.
          {active && ` O zamana kadar Sprint ${active.number} sürer; devreden görevler board'da kalır.`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={startNow}>
          <Rocket className="size-4" /> Şimdi başlat
        </Button>
        <Button variant="outline" onClick={edit}>
          <Pencil className="size-4" /> Planı düzenle
        </Button>
        <Button variant="ghost" className="ml-auto text-muted-foreground" onClick={cancel}>
          <X className="size-4" /> Planı iptal et
        </Button>
      </div>
    </div>
  );
}

export default function PlanningPage() {
  const { state } = useStore();
  const ask = useConfirm();
  const planned = state.plannedSprint;

  if (planned && !planned.planningStep && planned.scheduledAt) return <ScheduledPlan />;

  if (!planned?.planningStep) {
    const start = () => void api.post("/api/planning/start");
    return (
      <EmptyState title="Açık planlama yok.">
        <p className="max-w-sm text-sm text-muted-foreground">
          Sprint bitimine doğru planlamayı başlatın. Önce retro, sonra grooming ve estimation yapılır.
        </p>
        <Button onClick={start}>{state.activeSprint ? "Sprinti kapat ve planla" : "İlk sprinti planla"}</Button>
      </EmptyState>
    );
  }

  const cancel = async () => {
    const ok = await ask({
      title: "Planlama iptal edilsin mi?",
      description: "Görevler eski yerlerine döner. Retro notları kalır.",
      confirmText: "İptal et",
      cancelText: "Devam et",
    });
    if (!ok) return;
    await api.post("/api/planning/cancel");
    window.location.href = "/board";
  };
  const step = planned.planningStep;
  const hasRetro = !!state.activeSprint;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="font-semibold">Sprint {planned.number} planlaması</h2>
          <p className="text-sm text-muted-foreground">
            {shortDate(planned.startDate)} – {shortDate(planned.endDate)}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={cancel}>
          <X className="size-4" /> İptal
        </Button>
      </div>
      <Stepper current={step} hasRetro={hasRetro} />
      {step !== "retro" && <PlanWeek sprint={planned} />}
      {step === "retro" && <RetroStep />}
      {step === "grooming" && <GroomingStep />}
      {step === "estimation" && <EstimationStep />}
      {step === "start" && <StartStep />}
    </div>
  );
}
