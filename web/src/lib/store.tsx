// Client store: bootstrap data patched by SSE events. See openwiki/realtime.md.
import type {
  Activity,
  Bootstrap,
  Category,
  Presence,
  RecurringRule,
  ServerEvent,
  Sprint,
  Task,
  User,
} from "@shared/types.ts";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { api } from "./api";
import { setAppTimeZone } from "./dates";

export type ViewFilter = "all" | "shared" | number;

interface State {
  ready: boolean;
  me: User | null;
  users: User[];
  categories: Category[];
  activeSprint: Sprint | null;
  plannedSprint: Sprint | null;
  tasks: Record<number, Task>;
  rules: RecurringRule[];
  presence: Record<number, Presence>;
  activity: Activity[];
  vapidPublicKey: string | null;
  today: string;
  sourceUrl: string;
  view: ViewFilter;
  connected: boolean;
  /** Event counters per type. Page-level data (retro, availability) refetches when its counter changes. */
  versions: Partial<Record<ServerEvent["type"], number>>;
}

type Action =
  | { type: "hydrate"; data: Bootstrap }
  | { type: "task"; task: Task }
  | { type: "taskDelete"; id: number }
  | { type: "categories"; list: Category[] }
  | { type: "users"; list: User[] }
  | { type: "rules"; list: RecurringRule[] }
  | { type: "presence"; p: Presence }
  | { type: "activity"; list: Activity[]; prepend?: boolean }
  | { type: "view"; view: ViewFilter }
  | { type: "connected"; value: boolean }
  | { type: "event"; event: ServerEvent };

const initial: State = {
  ready: false,
  me: null,
  users: [],
  categories: [],
  activeSprint: null,
  plannedSprint: null,
  tasks: {},
  rules: [],
  presence: {},
  activity: [],
  vapidPublicKey: null,
  today: "",
  sourceUrl: "",
  view: "all",
  connected: false,
  versions: {},
};

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "hydrate": {
      const d = a.data;
      return {
        ...s,
        ready: true,
        me: d.me,
        users: d.users,
        categories: d.categories,
        activeSprint: d.activeSprint,
        plannedSprint: d.plannedSprint,
        tasks: Object.fromEntries(d.tasks.map((t) => [t.id, t])),
        rules: d.recurringRules,
        presence: Object.fromEntries(d.presence.map((p) => [p.userId, p])),
        vapidPublicKey: d.vapidPublicKey,
        today: d.today,
        sourceUrl: d.sourceUrl,
      };
    }
    case "task":
      return { ...s, tasks: { ...s.tasks, [a.task.id]: a.task } };
    case "taskDelete": {
      const tasks = { ...s.tasks };
      delete tasks[a.id];
      return { ...s, tasks };
    }
    case "categories":
      return { ...s, categories: a.list };
    case "users":
      return { ...s, users: a.list, me: a.list.find((u) => u.id === s.me?.id) ?? s.me };
    case "rules":
      return { ...s, rules: a.list };
    case "presence":
      return { ...s, presence: { ...s.presence, [a.p.userId]: a.p } };
    case "activity":
      return { ...s, activity: a.prepend ? [...a.list, ...s.activity].slice(0, 100) : a.list };
    case "view":
      return { ...s, view: a.view };
    case "connected":
      return { ...s, connected: a.value };
    case "event":
      return { ...s, versions: { ...s.versions, [a.event.type]: (s.versions[a.event.type] ?? 0) + 1 } };
  }
}

interface StoreApi {
  state: State;
  dispatch: (a: Action) => void;
  reload: () => Promise<void>;
  /** Applies a task locally before the server answers. */
  patchTask: (id: number, patch: Partial<Task> & { assigneeIds?: number[]; unplanned?: boolean }) => Promise<Task | null>;
  createTask: (body: Partial<Task> & { title: string; assigneeIds: number[] }) => Promise<Task>;
  deleteTask: (id: number) => Promise<void>;
  setView: (v: ViewFilter) => void;
}

const Ctx = createContext<StoreApi | null>(null);

export function StoreProvider({ page, children }: { page: string; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const stateRef = useRef(state);
  stateRef.current = state;

  const reload = useCallback(async () => {
    const data = await api.get<Bootstrap>("/api/bootstrap");
    setAppTimeZone(data.timeZone);
    dispatch({ type: "hydrate", data });
  }, []);

  // Initial load, saved view filter, activity.
  useEffect(() => {
    try {
      const v = localStorage.getItem("la.view");
      if (v) dispatch({ type: "view", view: v === "all" || v === "shared" ? v : Number(v) });
    } catch {}
    void reload();
    void api.get<Activity[]>("/api/activity?limit=50").then((list) => dispatch({ type: "activity", list }));
  }, [reload]);

  // SSE stream.
  useEffect(() => {
    let es: EventSource | null = null;
    let first = true;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      es = new EventSource("/api/events");
      es.addEventListener("hello", () => {
        dispatch({ type: "connected", value: true });
        if (!first) void reload();
        first = false;
        void api.quietPost("/api/presence", { page, taskId: null }).catch(() => {});
      });
      es.addEventListener("message", (m) => {
        const ev = JSON.parse((m as MessageEvent).data) as ServerEvent<any>;
        handleEvent(ev);
      });
      es.onerror = () => {
        dispatch({ type: "connected", value: false });
        es?.close();
        if (!closed) retry = setTimeout(open, 3000);
      };
    };
    const handleEvent = (ev: ServerEvent<any>) => {
      switch (ev.type) {
        case "task.upsert":
          // Also own echoes: part and mark routes change tasks without a local optimistic copy.
          dispatch({ type: "task", task: ev.data });
          break;
        case "task.delete":
          dispatch({ type: "taskDelete", id: ev.data.id });
          break;
        case "users.changed":
          if (Array.isArray(ev.data)) dispatch({ type: "users", list: ev.data });
          break;
        case "category.changed":
          if (Array.isArray(ev.data)) dispatch({ type: "categories", list: ev.data });
          break;
        case "recurring.changed":
          if (Array.isArray(ev.data)) dispatch({ type: "rules", list: ev.data });
          else void reload();
          break;
        case "sprint.changed":
        case "planning.changed":
          void reload();
          break;
        case "presence":
          dispatch({ type: "presence", p: ev.data });
          return;
        case "activity":
          dispatch({ type: "activity", list: [ev.data], prepend: true });
          return;
      }
      dispatch({ type: "event", event: ev });
    };
    open();
    const ping = setInterval(() => {
      void api.quietPost("/api/presence", { page }).catch(() => {});
    }, 60_000);
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(ping);
      es?.close();
    };
  }, [page, reload]);

  const patchTask = useCallback(async (id: number, patch: Partial<Task> & { assigneeIds?: number[]; unplanned?: boolean }) => {
    const prev = stateRef.current.tasks[id];
    if (prev) dispatch({ type: "task", task: { ...prev, ...patch } });
    try {
      const task = await api.patch<Task>(`/api/tasks/${id}`, patch);
      dispatch({ type: "task", task });
      return task;
    } catch {
      if (prev) dispatch({ type: "task", task: prev });
      return null;
    }
  }, []);

  const createTask = useCallback(async (body: Partial<Task> & { title: string; assigneeIds: number[] }) => {
    const task = await api.post<Task>("/api/tasks", body);
    dispatch({ type: "task", task });
    return task;
  }, []);

  const deleteTask = useCallback(async (id: number) => {
    await api.del(`/api/tasks/${id}`);
    dispatch({ type: "taskDelete", id });
  }, []);

  const setView = useCallback((view: ViewFilter) => {
    try {
      localStorage.setItem("la.view", String(view));
    } catch {}
    dispatch({ type: "view", view });
  }, []);

  const value = useMemo(
    () => ({ state, dispatch, reload, patchTask, createTask, deleteTask, setView }),
    [state, reload, patchTask, createTask, deleteTask, setView],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}

/** Tasks that match the person filter. */
export function matchesView(task: Task, view: ViewFilter): boolean {
  if (view === "all") return true;
  if (view === "shared") return task.assigneeIds.length > 1;
  return task.assigneeIds.includes(view);
}

export function useTasks(filter: (t: Task) => boolean, deps: unknown[] = []): Task[] {
  const { state } = useStore();
  return useMemo(
    () => Object.values(state.tasks).filter((t) => matchesView(t, state.view) && filter(t)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.tasks, state.view, ...deps],
  );
}

export function usePartner(): User | null {
  const { state } = useStore();
  return state.users.find((u) => u.id !== state.me?.id) ?? null;
}

/** Sends the focused task to the partner (presence). */
export function focusTask(page: string, taskId: number | null): void {
  void api.quietPost("/api/presence", { page, taskId }).catch(() => {});
}
