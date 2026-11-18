import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StoreProvider, useStore } from "@/lib/store";
import { AppShell } from "./AppShell";
import { TaskDialogProvider } from "./TaskDialog";
import BoardPage from "./board/BoardPage";
import BacklogPage from "./backlog/BacklogPage";
import CalendarPage from "./calendar/CalendarPage";
import DashboardPage from "./dashboard/DashboardPage";
import PlanningPage from "./planning/PlanningPage";
import RecurringPage from "./recurring/RecurringPage";
import SettingsPage from "./settings/SettingsPage";
import { ConfirmProvider } from "./ConfirmDialog";

const PAGES: Record<string, () => React.ReactElement> = {
  board: BoardPage,
  calendar: CalendarPage,
  backlog: BacklogPage,
  recurring: RecurringPage,
  planning: PlanningPage,
  dashboard: DashboardPage,
  settings: SettingsPage,
};

function Content({ page }: { page: string }) {
  const { state } = useStore();
  if (!state.ready)
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">Yükleniyor…</div>
    );
  const Page = PAGES[page] ?? BoardPage;
  return (
    <TaskDialogProvider page={page}>
      <AppShell page={page}>
        <Page />
      </AppShell>
    </TaskDialogProvider>
  );
}

export default function App({ page }: { page: string }) {
  return (
    <StoreProvider page={page}>
      <TooltipProvider delayDuration={300}>
        <ConfirmProvider>
          <Content page={page} />
        </ConfirmProvider>
        <Toaster position="top-center" richColors closeButton />
      </TooltipProvider>
    </StoreProvider>
  );
}
