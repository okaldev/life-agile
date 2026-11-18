// App layout: sidebar (desktop), bottom nav (mobile), header with partner presence and activity feed.
import {
  BarChart3,
  CalendarDays,
  History,
  KanbanSquare,
  ListTodo,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Repeat,
  Settings,
  Sun,
  Users,
  WifiOff,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { relativeTime, shortDate } from "@/lib/dates";
import { PAGE_LABEL, STEP_LABEL } from "@/lib/strings";
import { usePartner, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { UserAvatar } from "./common";

const NAV = [
  { page: "calendar", href: "/", icon: CalendarDays },
  { page: "board", href: "/board", icon: KanbanSquare },
  { page: "backlog", href: "/backlog", icon: ListTodo },
  { page: "planning", href: "/planlama", icon: Users },
  { page: "recurring", href: "/tekrarlayan", icon: Repeat },
  { page: "dashboard", href: "/dashboard", icon: BarChart3 },
  { page: "settings", href: "/ayarlar", icon: Settings },
];
const MOBILE_MAIN = ["board", "calendar", "backlog", "dashboard"];

function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("la.theme", next ? "dark" : "light");
    } catch {}
    setDark(next);
  };
  return [dark, toggle];
}

async function logout() {
  await api.post("/auth/logout").catch(() => {});
  window.location.href = "/giris";
}

function PartnerPresence() {
  const { state } = useStore();
  const partner = usePartner();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!partner) return null;
  const p = state.presence[partner.id];
  const online = !!p?.online;
  const task = p?.taskId ? state.tasks[p.taskId] : null;
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" title={task ? `${partner.name}: ${task.title}` : undefined}>
      <span className="relative">
        <UserAvatar user={partner} />
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background",
            online ? "bg-emerald-500" : "bg-muted-foreground/40",
          )}
        />
      </span>
      <span className="hidden truncate sm:inline">
        {online ? (
          <>
            {partner.name} · {PAGE_LABEL[p?.page ?? ""] ?? "çevrimiçi"}
            {task && <> · <span className="text-foreground">{task.title}</span></>}
          </>
        ) : (
          <>{partner.name} · {p ? relativeTime(p.at) : "çevrimdışı"}</>
        )}
      </span>
    </div>
  );
}

function ActivityFeed() {
  const { state } = useStore();
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Aktivite">
          <History className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Aktivite</SheetTitle>
        </SheetHeader>
        <div className="space-y-3 overflow-y-auto px-4 pb-6">
          {state.activity.length === 0 && <p className="text-sm text-muted-foreground">Henüz aktivite yok.</p>}
          {state.activity.map((a) => {
            const u = state.users.find((x) => x.id === a.userId);
            return (
              <div key={a.id} className="flex gap-2.5 text-sm">
                <UserAvatar user={u} className="mt-0.5" />
                <div className="min-w-0">
                  <p className="leading-snug">
                    <span className="font-medium">{u?.name ?? "Sistem"}</span> {a.summary}
                  </p>
                  <p className="text-xs text-muted-foreground">{relativeTime(a.createdAt)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PlanningBanner({ page }: { page: string }) {
  const { state } = useStore();
  const p = state.plannedSprint;
  if (!p?.planningStep || page === "planning") return null;
  return (
    <a
      href="/planlama"
      className="flex items-center justify-between gap-2 border-b bg-primary px-4 py-2 text-sm text-primary-foreground"
    >
      <span>
        Sprint {p.number} planlaması devam ediyor · <b>{STEP_LABEL[p.planningStep]}</b>
      </span>
      <span className="font-medium underline underline-offset-2">Katıl →</span>
    </a>
  );
}

export function AppShell({ page, children }: { page: string; children: ReactNode }) {
  const { state } = useStore();
  const [dark, toggleTheme] = useTheme();
  const sprint = state.activeSprint;
  const title = PAGE_LABEL[page] ?? "";
  // Desktop sidebar can collapse to icons; remembered on this device. Ctrl/Cmd + B toggles it.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("la.sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const toggleSidebar = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem("la.sidebar", c ? "open" : "collapsed");
      } catch {}
      return !c;
    });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navLink = (item: (typeof NAV)[number], compact = false) => {
    const Icon = item.icon;
    const active = item.page === page;
    if (!compact && collapsed)
      return (
        <Tooltip key={item.page}>
          <TooltipTrigger asChild>
            <a
              href={item.href}
              aria-label={PAGE_LABEL[item.page]}
              className={cn(
                "relative flex size-9 items-center justify-center rounded-md",
                active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {item.page === "planning" && state.plannedSprint?.planningStep && (
                <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-emerald-500" />
              )}
            </a>
          </TooltipTrigger>
          <TooltipContent side="right">{PAGE_LABEL[item.page]}</TooltipContent>
        </Tooltip>
      );
    return (
      <a
        key={item.page}
        href={item.href}
        className={cn(
          compact
            ? "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]"
            : "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
          active ? (compact ? "text-foreground" : "bg-accent font-medium") : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon className={compact ? "size-5" : "size-4"} />
        {PAGE_LABEL[item.page]}
        {item.page === "planning" && state.plannedSprint?.planningStep && !compact && (
          <span className="ml-auto size-2 rounded-full bg-emerald-500" />
        )}
      </a>
    );
  };

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar: full (224 px) or icons only (56 px). */}
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r py-3 transition-[width] duration-200 md:flex",
          collapsed ? "w-14 items-center px-2" : "w-56 px-3",
        )}
      >
        <div className={cn("mb-4 flex items-center", collapsed ? "flex-col gap-2" : "gap-2")}>
          <a href="/" className={cn("flex items-center gap-2 py-1 font-semibold", !collapsed && "px-2")} title="Life Agile">
            <img src="/favicon.svg" alt="" className="size-6" />
            {!collapsed && "Life Agile"}
          </a>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("size-8 text-muted-foreground", !collapsed && "ml-auto")}
                onClick={toggleSidebar}
                aria-label={collapsed ? "Menüyü aç" : "Menüyü daralt"}
              >
                {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{collapsed ? "Menüyü aç" : "Menüyü daralt"} (Ctrl/⌘+B)</TooltipContent>
          </Tooltip>
        </div>
        <nav className={cn("flex flex-col gap-0.5", collapsed && "items-center")}>{NAV.map((n) => navLink(n))}</nav>
        {sprint && !collapsed && (
          <div className="mt-4 rounded-md border p-2.5 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Sprint {sprint.number}</p>
            <p>
              {shortDate(sprint.startDate)} – {shortDate(sprint.endDate)}
            </p>
          </div>
        )}
        {collapsed ? (
          <div className="mt-auto border-t pt-3">
            <DropdownMenu>
              <DropdownMenuTrigger className="rounded-full" aria-label="Hesap">
                <UserAvatar user={state.me ?? undefined} className="size-8" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end">
                <DropdownMenuItem asChild>
                  <a href="/ayarlar">
                    <Settings /> Profil ve ayarlar
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleTheme}>
                  {dark ? <Sun /> : <Moon />} {dark ? "Açık tema" : "Koyu tema"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void logout()}>
                  <LogOut /> Çıkış yap
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <div className="mt-auto flex items-center gap-2 border-t pt-3">
            <a href="/ayarlar" className="flex min-w-0 items-center gap-2" title="Profil ve ayarlar">
              <UserAvatar user={state.me ?? undefined} />
              <span className="truncate text-sm">{state.me?.name}</span>
            </a>
            <Button variant="ghost" size="icon" className="ml-auto size-8" onClick={toggleTheme} aria-label="Tema">
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="size-8" onClick={logout} aria-label="Çıkış">
              <LogOut className="size-4" />
            </Button>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur pt-[env(safe-area-inset-top)]">
          <PlanningBanner page={page} />
          <div className="flex h-12 items-center gap-3 px-4">
            <h1 className="text-base font-semibold">{title}</h1>
            {!state.connected && (
              <span className="flex items-center gap-1 text-xs text-amber-600" title="Canlı bağlantı yok">
                <WifiOff className="size-3.5" /> Bağlantı yok
              </span>
            )}
            <div className="ml-auto flex min-w-0 items-center gap-1">
              <PartnerPresence />
              <ActivityFeed />
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 pt-4 pb-24 md:pb-8">{children}</main>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {NAV.filter((n) => MOBILE_MAIN.includes(n.page)).map((n) => navLink(n, true))}
          <Sheet>
            <SheetTrigger asChild>
              <button
                className={cn(
                  "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]",
                  MOBILE_MAIN.includes(page) ? "text-muted-foreground" : "text-foreground",
                )}
              >
                <span className="relative">
                  <Menu className="size-5" />
                  {state.plannedSprint?.planningStep && (
                    <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-emerald-500" />
                  )}
                </span>
                Menü
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="pb-[calc(env(safe-area-inset-bottom)+1rem)]">
              <SheetHeader>
                <SheetTitle>Menü</SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-0.5 px-4">
                {NAV.filter((n) => !MOBILE_MAIN.includes(n.page)).map((n) => navLink(n))}
                <button onClick={toggleTheme} className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground">
                  {dark ? <Sun className="size-4" /> : <Moon className="size-4" />} {dark ? "Açık tema" : "Koyu tema"}
                </button>
                <button onClick={logout} className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground">
                  <LogOut className="size-4" /> Çıkış yap
                </button>
              </nav>
            </SheetContent>
          </Sheet>
        </nav>
      </div>
    </div>
  );
}
