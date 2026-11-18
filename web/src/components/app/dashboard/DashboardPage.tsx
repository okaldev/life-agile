// Metrics dashboard. Definitions: openwiki/metrics.md.
import type { Metrics, RetroItem, SprintStats } from "@shared/types.ts";
import { ChevronDown, Flame } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import { fmt, shortDate } from "@/lib/dates";
import { useStore } from "@/lib/store";
import { RETRO_LABEL } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { CategoryDot, EmptyState, UserAvatar, fmtSp, spLabel } from "../common";

const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
const TOOLTIP = {
  contentStyle: {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--popover-foreground)",
  },
  labelStyle: { color: "var(--muted-foreground)" },
  cursor: { fill: "var(--muted)", opacity: 0.5 },
};

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Panel({ title, hint, children, className }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3 rounded-lg border p-4", className)}>
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function SprintRow({ s }: { s: SprintStats }) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const [retro, setRetro] = useState<RetroItem[] | null>(null);
  const toggle = () => {
    setOpen(!open);
    if (!retro) void api.get<RetroItem[]>(`/api/retro/${s.sprint.id}`).then(setRetro);
  };
  return (
    <div className="border-b last:border-b-0">
      <button onClick={toggle} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-left text-sm">
        <span className="w-20 font-medium">Sprint {s.sprint.number}</span>
        <span className="w-28 text-xs text-muted-foreground">
          {shortDate(s.sprint.startDate)} – {shortDate(s.sprint.endDate)}
        </span>
        {s.perUser.map((p) => {
          const u = state.users.find((x) => x.id === p.userId);
          const hit = p.targetSp > 0 && p.doneSp >= p.targetSp;
          return (
            <span key={p.userId} className="flex items-center gap-1 tabular-nums">
              <UserAvatar user={u} className="size-4" />
              <span className={cn(hit && "font-medium")}>{fmtSp(p.doneSp)}</span>
              <span className="text-muted-foreground">/ {p.targetSp}</span>
              {hit && <span className="text-xs text-emerald-600">✓</span>}
            </span>
          );
        })}
        <span className="text-xs text-muted-foreground">{s.sprint.status === "active" ? "devam ediyor" : `${s.doneCount}/${s.taskCount} görev`}</span>
        <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2 pb-3 text-sm">
          {s.sprint.goal && <p>🎯 {s.sprint.goal}</p>}
          {retro && retro.length === 0 && <p className="text-xs text-muted-foreground">Retro notu yok.</p>}
          {retro && retro.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-3">
              {(["good", "bad", "try"] as const).map((k) => (
                <div key={k}>
                  <p className="text-xs font-medium text-muted-foreground">{RETRO_LABEL[k]}</p>
                  <ul className="list-disc pl-4 text-sm">
                    {retro.filter((r) => r.kind === k).map((r) => (
                      <li key={r.id}>{r.text}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { state } = useStore();
  const [m, setM] = useState<Metrics | null>(null);
  const taskVersion = state.versions["task.upsert"];
  useEffect(() => {
    void api.get<Metrics>("/api/metrics").then(setM);
  }, [taskVersion, state.activeSprint?.id]);

  if (!m) return <p className="text-sm text-muted-foreground">Yükleniyor…</p>;
  if (m.sprints.length === 0) return <EmptyState title="Henüz sprint yok. İlk sprinti tamamlayınca metrikler burada görünür." />;

  const users = state.users;
  const closed = m.sprints.filter((s) => s.sprint.status === "closed");
  const current = m.sprints.find((s) => s.sprint.status === "active");
  const last3 = closed.slice(-3);
  const avgVelocity = last3.length ? Math.round(last3.reduce((s, x) => s + x.totalDoneSp, 0) / last3.length) : null;
  const lastCarry = m.carryOver.at(-1);

  const velocity = m.sprints.map((s) => ({
    name: `S${s.sprint.number}`,
    ...Object.fromEntries(s.perUser.map((p) => [`u${p.userId}`, p.doneSp])),
    target: s.perUser.reduce((a, p) => a + p.targetSp, 0),
    total: s.totalDoneSp,
  }));
  const burn = m.burndown.map((b) => ({ ...b, name: fmt(b.date, "EEE") }));
  const catTotal = Math.max(1, ...m.categories.map((c) => c.recentSp));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile
          label="Bu sprint"
          value={current ? `${fmtSp(current.totalDoneSp)} SP` : "—"}
          sub={current ? `${fmtSp(current.totalPlannedSp)} SP planlandı` : "aktif sprint yok"}
        />
        <Tile label="Ortalama velocity" value={avgVelocity != null ? `${avgVelocity} SP` : "—"} sub="son 3 sprint, toplam" />
        <Tile
          label="Hedef tutma"
          value={(() => {
            const t = m.hitRate.find((h) => h.userId === null)!;
            return t.total ? `%${Math.round((t.hit / t.total) * 100)}` : "—";
          })()}
          sub={m.hitRate
            .filter((h) => h.userId !== null)
            .map((h) => `${users.find((u) => u.id === h.userId)?.name} ${h.hit}/${h.total}`)
            .join(" · ")}
        />
        <Tile label="Devreden iş oranı" value={lastCarry ? `%${Math.round(lastCarry.rate * 100)}` : "—"} sub="son sprint" />
        <Tile
          label="Plan dışı iş"
          value={current ? `${current.unplannedCount} iş` : "—"}
          sub={current ? `${fmtSp(current.unplannedSp)} SP · bu sprint` : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Velocity" hint="Sprint başına tamamlanan SP. Ortak görev iki kişiye de sayılır.">
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={velocity} barGap={2} margin={{ left: -20, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip {...TOOLTIP} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                {users.map((u) => (
                  <Bar key={u.id} dataKey={`u${u.id}`} name={u.name} fill={u.color} radius={[4, 4, 0, 0]} maxBarSize={28} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Toplam SP ve hedef" hint="Tamamlanan toplam SP ile toplam hedefin sprintten sprinte değişimi.">
          <div className="h-56">
            <ResponsiveContainer>
              <LineChart data={velocity} margin={{ left: -20, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip {...TOOLTIP} cursor={{ stroke: "var(--border)" }} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                <Line dataKey="total" name="Tamamlanan" stroke="var(--foreground)" strokeWidth={2} dot={{ r: 4 }} />
                <Line dataKey="target" name="Hedef" stroke="var(--muted-foreground)" strokeWidth={2} strokeDasharray="4 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        {burn.length > 0 && (
          <Panel title="Burndown" hint="Aktif sprintte kalan SP ve ideal çizgi.">
            <div className="h-56">
              <ResponsiveContainer>
                <LineChart data={burn} margin={{ left: -20, right: 8, top: 4 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip {...TOOLTIP} cursor={{ stroke: "var(--border)" }} />
                  <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                  <Line dataKey="ideal" name="İdeal" stroke="var(--muted-foreground)" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                  <Line dataKey="remaining" name="Kalan" stroke="var(--foreground)" strokeWidth={2} dot={{ r: 4 }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        )}

        <Panel title="Kategoriler" hint="Son 4 sprintte tamamlanan SP.">
          {m.categories.length === 0 && <p className="text-sm text-muted-foreground">Henüz tamamlanan görev yok.</p>}
          <div className="space-y-2.5">
            {[...m.categories]
              .sort((a, b) => b.recentSp - a.recentSp)
              .map((c) => {
                const cat = state.categories.find((x) => x.id === c.categoryId);
                return (
                  <div key={c.categoryId ?? 0} className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <CategoryDot category={cat} />
                      <span>{cat?.name ?? "Kategorisiz"}</span>
                      <span className="ml-auto text-muted-foreground tabular-nums">
                        {fmtSp(c.recentSp)} SP <span className="text-xs">(toplam {fmtSp(c.allSp)})</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(c.recentSp / catTotal) * 100}%`, backgroundColor: cat?.color ?? "var(--muted-foreground)" }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </Panel>

        <Panel title="Tekrarlayan görev uyumu" hint="Son 4 sprint. Seri: art arda tamamlanan tekrar sayısı.">
          {m.recurring.length === 0 && <p className="text-sm text-muted-foreground">Aktif tekrarlayan görev yok.</p>}
          <div className="space-y-2.5">
            {m.recurring.map((r) => (
              <div key={r.ruleId} className="space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="truncate">{r.title}</span>
                  <span className="ml-auto flex items-center gap-2 text-muted-foreground tabular-nums">
                    {r.streak > 0 && (
                      <span className="flex items-center gap-0.5 text-orange-500">
                        <Flame className="size-3.5" /> {r.streak}
                      </span>
                    )}
                    {r.done}/{r.total}
                  </span>
                </div>
                <Progress value={r.total ? (r.done / r.total) * 100 : 0} className="h-1.5" />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Plan dışı işler" hint="Sprint başladıktan sonra eklenen işler (change request). Pay: tamamlanan SP içindeki oranı.">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-1 font-normal">Sprint</th>
                <th className="pb-1 font-normal">İş</th>
                <th className="pb-1 font-normal">SP</th>
                <th className="pb-1 text-right font-normal">Pay</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...m.sprints].reverse().map((s) => (
                <tr key={s.sprint.id} className="border-t">
                  <td className="py-1.5">S{s.sprint.number}</td>
                  <td>{s.unplannedCount}</td>
                  <td>
                    {fmtSp(s.unplannedDoneSp)} / {fmtSp(s.unplannedSp)}
                  </td>
                  <td className="text-right text-muted-foreground">
                    {s.totalDoneSp ? `%${Math.round((s.unplannedDoneSp / s.totalDoneSp) * 100)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Tahmin doğruluğu" hint="SP değerine göre 'Devam ediyor'dan 'Tamamlandı'ya geçen medyan süre.">
          {m.estimateAccuracy.length === 0 ? (
            <p className="text-sm text-muted-foreground">Veri için görevleri önce "Devam ediyor"a taşıyın.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-1 font-normal">SP</th>
                  <th className="pb-1 font-normal">Medyan süre</th>
                  <th className="pb-1 text-right font-normal">Görev</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {m.estimateAccuracy.map((e) => (
                  <tr key={e.sp} className="border-t">
                    <td className="py-1.5 font-medium">{spLabel(e.sp)}</td>
                    <td>{e.medianHours < 24 ? `${e.medianHours} sa` : `${Math.round((e.medianHours / 24) * 10) / 10} gün`}</td>
                    <td className="text-right text-muted-foreground">{e.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <Panel title="Geçmiş sprintler" hint="Satıra dokunarak hedef ve retro notlarını açın.">
        <div>
          {[...m.sprints].reverse().map((s) => (
            <SprintRow key={s.sprint.id} s={s} />
          ))}
        </div>
      </Panel>
    </div>
  );
}
