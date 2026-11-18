// Small shared UI pieces: avatars, person filter, SP and assignee pickers, category dot.
import type { Category, Task, User } from "@shared/types.ts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useStore, type ViewFilter } from "@/lib/store";

export function UserAvatar({ user, className, ring }: { user: User | undefined; className?: string; ring?: boolean }) {
  if (!user) return null;
  return (
    <Avatar
      className={cn("size-6 text-[10px]", ring && "ring-2 ring-offset-1 ring-offset-background", className)}
      style={ring ? ({ "--tw-ring-color": user.color } as React.CSSProperties) : undefined}
      title={user.name}
    >
      {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} referrerPolicy="no-referrer" />}
      <AvatarFallback style={{ backgroundColor: user.color, color: "white" }}>{user.name.slice(0, 1)}</AvatarFallback>
    </Avatar>
  );
}

export function Assignees({ ids, className }: { ids: number[]; className?: string }) {
  const { state } = useStore();
  return (
    <div className={cn("flex -space-x-1.5", className)}>
      {ids.map((id) => (
        <UserAvatar key={id} user={state.users.find((u) => u.id === id)} className="size-5 border border-background" />
      ))}
    </div>
  );
}

export function ViewTabs({ className }: { className?: string }) {
  const { state, setView } = useStore();
  const value = String(state.view);
  return (
    <Tabs value={value} onValueChange={(v) => setView((v === "all" || v === "shared" ? v : Number(v)) as ViewFilter)} className={className}>
      <TabsList className="h-8">
        {state.users.map((u) => (
          <TabsTrigger key={u.id} value={String(u.id)} className="px-2.5 text-xs">
            {u.name}
          </TabsTrigger>
        ))}
        <TabsTrigger value="shared" className="px-2.5 text-xs">
          Ortak
        </TabsTrigger>
        <TabsTrigger value="all" className="px-2.5 text-xs">
          Tümü
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

export function SpPicker({
  value,
  onChange,
  size = "md",
}: {
  value: number | null;
  onChange: (sp: number | null) => void;
  size?: "sm" | "md" | "lg";
}) {
  const dim = size === "lg" ? "size-11 text-base" : size === "sm" ? "size-7 text-xs" : "size-9 text-sm";
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Story point">
      {SP_VALUES.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          onClick={() => onChange(value === n ? null : n)}
          className={cn(
            "rounded-md border font-medium tabular-nums transition-colors",
            dim,
            value === n ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
          )}
        >
          {spLabel(n)}
        </button>
      ))}
    </div>
  );
}

export function AssigneePicker({ value, onChange }: { value: number[]; onChange: (ids: number[]) => void }) {
  const { state } = useStore();
  const allIds = state.users.map((u) => u.id);
  const options: { label: string; ids: number[] }[] = [
    ...state.users.map((u) => ({ label: u.name, ids: [u.id] })),
    { label: "İkisi", ids: allIds },
  ];
  const key = (ids: number[]) => [...ids].sort().join(",");
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          onClick={() => onChange(o.ids)}
          className={cn(
            "rounded-md border px-3 py-1.5 text-sm transition-colors",
            key(value) === key(o.ids) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CategoryDot({ category, className }: { category: Category | undefined; className?: string }) {
  if (!category) return null;
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ backgroundColor: category.color }} />;
}

export function SpBadge({ sp, className }: { sp: number | null; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 text-[11px] font-semibold tabular-nums",
        sp == null && "border-dashed text-muted-foreground",
        className,
      )}
      title="Story point"
    >
      {sp == null ? "–" : spLabel(sp)}
    </span>
  );
}

export const SP_VALUES = [0, 0.5, 1, 2, 3, 4, 5];

/** Short label for one story point value: 0.5 -> "½". */
export const spLabel = (n: number) => (n === 0.5 ? "½" : String(n));

/** SP sums in Turkish number format: 2.5 -> "2,5". */
export const fmtSp = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString("tr-TR", { maximumFractionDigits: 1 }));

/** Sum of SP; a task counts for each assignee when a user is given. */
export function sumSp(tasks: Task[], userId?: number): number {
  return tasks.filter((t) => userId == null || t.assigneeIds.includes(userId)).reduce((s, t) => s + (t.sp ?? 0), 0);
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children}
    </div>
  );
}

/** Owner strip on the left edge of a row: person color, two colors for shared tasks. Parent must be relative. */
export function OwnerStrip({ ids }: { ids: number[] }) {
  const { state } = useStore();
  const colors = ids.map((id) => state.users.find((u) => u.id === id)?.color).filter(Boolean) as string[];
  if (colors.length === 0) return null;
  const bg =
    colors.length === 1
      ? colors[0]
      : `linear-gradient(to bottom, ${colors.map((c, i) => `${c} ${(i * 100) / colors.length}% ${((i + 1) * 100) / colors.length}%`).join(", ")})`;
  return <span className="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-lg" style={{ background: bg }} aria-hidden />;
}

/** Owner name chip: a person name, or "Ortak" for shared tasks. */
export function OwnerChip({ ids, className }: { ids: number[]; className?: string }) {
  const { state } = useStore();
  const users = ids.map((id) => state.users.find((u) => u.id === id)).filter((u) => !!u);
  if (users.length === 0) return null;
  const shared = users.length > 1;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-medium", className)}
      style={{
        backgroundColor: shared ? "var(--muted)" : `color-mix(in oklab, ${users[0].color} 18%, transparent)`,
        color: shared ? undefined : users[0].color,
      }}
    >
      {shared && users.map((u) => <span key={u.id} className="size-2 rounded-full" style={{ backgroundColor: u.color }} />)}
      {shared ? "Ortak" : users[0].name}
    </span>
  );
}
