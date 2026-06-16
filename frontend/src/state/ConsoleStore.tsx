import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiError, api } from "../api";
import { formatSectionError, i18n } from "../lib/i18n";
import { labelForError } from "../lib/labels";
import type {
  AdminProfile,
  AdminTaskListItem,
  AuditEventView,
  DashboardOverview,
  NodeCreateResponse,
  NodeResponse,
  SecurityWarningView,
  TokenPair,
} from "../types";

export type LoadState = "idle" | "loading" | "ready" | "error";

export type ConsoleState = {
  token: string;
  me: AdminProfile | null;
  loading: LoadState;
  lastError: string | null;
  overviewLoading: LoadState;
  overviewError: string | null;
  nodesLoading: LoadState;
  nodesError: string | null;
  tasksLoading: LoadState;
  tasksError: string | null;
  overview: DashboardOverview | null;
  prevOverview: DashboardOverview | null; // cached previous overview for delta calculation
  nodes: NodeResponse[];
  tasks: AdminTaskListItem[];
  audits: AuditEventView[];
  warnings: SecurityWarningView[];
  recentOnboarding: NodeCreateResponse | null;
  lastSyncedAt: number | null;
};

export type ConsoleStore = ConsoleState & {
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  refreshOverview: (opts?: { silent?: boolean }) => Promise<void>;
  refreshNodes: (opts?: { silent?: boolean }) => Promise<void>;
  refreshTasks: (opts?: { silent?: boolean }) => Promise<void>;
  setRecentOnboarding: (pkg: NodeCreateResponse | null) => void;
  signalAuthFailure: () => void;
  callApi: <T>(operation: (token: string) => Promise<T>) => Promise<T>;
};

const defaultState: ConsoleState = {
  token: "",
  me: null,
  loading: "idle",
  lastError: null,
  overviewLoading: "idle",
  overviewError: null,
  nodesLoading: "idle",
  nodesError: null,
  tasksLoading: "idle",
  tasksError: null,
  overview: null,
  prevOverview: null,
  nodes: [],
  tasks: [],
  audits: [],
  warnings: [],
  recentOnboarding: null,
  lastSyncedAt: null,
};

const ConsoleCtx = createContext<ConsoleStore | null>(null);

const REFRESH_INTERVAL_MS = 5000;

function nextLoadState(current: LoadState): LoadState {
  return current === "ready" ? "ready" : "loading";
}

function deriveAggregateLoadState(
  state: Pick<
    ConsoleState,
    | "overviewLoading"
    | "nodesLoading"
    | "tasksLoading"
    | "overviewError"
    | "nodesError"
    | "tasksError"
  >,
): LoadState {
  if (
    state.overviewLoading === "loading" ||
    state.nodesLoading === "loading" ||
    state.tasksLoading === "loading"
  ) {
    return "loading";
  }
  if (state.overviewError || state.nodesError || state.tasksError) {
    return "error";
  }
  if (
    state.overviewLoading === "ready" ||
    state.nodesLoading === "ready" ||
    state.tasksLoading === "ready"
  ) {
    return "ready";
  }
  return "idle";
}

function deriveAggregateError(
  state: Pick<ConsoleState, "overviewError" | "nodesError" | "tasksError">,
): string | null {
  return (
    [state.overviewError, state.nodesError, state.tasksError].filter(Boolean).join(" · ") || null
  );
}

type ProviderProps = {
  auth: TokenPair;
  onAuthUpdate: (auth: TokenPair) => void;
  onAuthFailure: () => void;
  children: ReactNode;
};

export function ConsoleStoreProvider({
  auth,
  onAuthUpdate,
  onAuthFailure,
  children,
}: ProviderProps): JSX.Element {
  const [state, setState] = useState<ConsoleState>({ ...defaultState, token: auth.access_token });
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const signalAuthFailure = useCallback(() => {
    onAuthFailure();
  }, [onAuthFailure]);

  const refreshAccessToken = useCallback(async (): Promise<string> => {
    const next = await api.refresh(auth.refresh_token);
    if (!aliveRef.current) {
      return next.access_token;
    }
    onAuthUpdate(next);
    setState((prev) => ({ ...prev, token: next.access_token }));
    return next.access_token;
  }, [auth.refresh_token, onAuthUpdate]);

  const callApi = useCallback<ConsoleStore["callApi"]>(
    async <T,>(operation: (token: string) => Promise<T>): Promise<T> => {
      try {
        return await operation(auth.access_token);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) {
          throw error;
        }
        try {
          const nextAccessToken = await refreshAccessToken();
          return await operation(nextAccessToken);
        } catch (refreshError) {
          signalAuthFailure();
          throw refreshError;
        }
      }
    },
    [auth.access_token, refreshAccessToken, signalAuthFailure],
  );

  const refreshOverview = useCallback<ConsoleStore["refreshOverview"]>(
    async ({ silent } = {}) => {
      if (!auth.access_token) return;
      if (!silent) {
        setState((prev) => {
          const next = { ...prev, overviewLoading: nextLoadState(prev.overviewLoading) };
          return {
            ...next,
            loading: deriveAggregateLoadState(next),
          };
        });
      }
      try {
        const [me, overview, audits, warnings] = await callApi((token) =>
          Promise.all([
            api.getMe(token),
            api.getOverview(token),
            api.getAuditEvents(token, 50),
            api.getSecurityWarnings(token, 50),
          ]),
        );
        if (!aliveRef.current) return;
        setState((prev) => {
          const next = {
            ...prev,
            me,
            prevOverview: prev.overview,
            overview,
            audits,
            warnings,
            overviewLoading: "ready" as const,
            overviewError: null,
            lastSyncedAt: Date.now(),
          };
          return {
            ...next,
            loading: deriveAggregateLoadState(next),
            lastError: deriveAggregateError(next),
          };
        });
      } catch (error) {
        if (!aliveRef.current) return;
        const message = labelForError(error, i18n.console.loadFailed);
        setState((prev) => {
          const next = {
            ...prev,
            overviewLoading: "error" as const,
            overviewError: formatSectionError(i18n.console.overviewSection, message),
          };
          return {
            ...next,
            loading: deriveAggregateLoadState(next),
            lastError: deriveAggregateError(next),
          };
        });
      }
    },
    [auth.access_token, callApi],
  );

  const refreshNodes = useCallback<ConsoleStore["refreshNodes"]>(
    async ({ silent } = {}) => {
      if (!auth.access_token) return;
      if (!silent) {
        setState((prev) => {
          const next = { ...prev, nodesLoading: nextLoadState(prev.nodesLoading) };
          return {
            ...next,
            loading: deriveAggregateLoadState(next),
          };
        });
      }
      try {
        const nodes = await callApi((token) => api.listAllNodes(token));
        if (!aliveRef.current) return;
        setState((prev) => {
          const next = {
            ...prev,
            nodes,
            nodesLoading: "ready" as const,
            nodesError: null,
            lastSyncedAt: Date.now(),
          };
          return {
            ...next,
            loading: deriveAggregateLoadState(next),
            lastError: deriveAggregateError(next),
          };
        });
      } catch (error) {
        if (!aliveRef.current) return;
        const message = labelForError(error, i18n.console.loadFailed);
        setState((prev) => {
          const next = {
            ...prev,
            nodesLoading: "error" as const,
            nodesError: formatSectionError(i18n.console.nodesSection, message),
          };
          return {
            ...next,
            loading: deriveAggregateLoadState(next),
            lastError: deriveAggregateError(next),
          };
        });
      }
    },
    [auth.access_token, callApi],
  );

  const refreshTasks = useCallback<ConsoleStore["refreshTasks"]>(
    async ({ silent } = {}) => {
      if (!auth.access_token) return;
      if (!silent) {
        setState((prev) => {
          const next = { ...prev, tasksLoading: nextLoadState(prev.tasksLoading) };
          return {
            ...next,
            loading: deriveAggregateLoadState(next),
          };
        });
      }
      try {
        const tasks = await callApi((token) => api.listAllTasks(token));
        if (!aliveRef.current) return;
        setState((prev) => {
          const next = {
            ...prev,
            tasks,
            tasksLoading: "ready" as const,
            tasksError: null,
            lastSyncedAt: Date.now(),
          };
          return {
            ...next,
            loading: deriveAggregateLoadState(next),
            lastError: deriveAggregateError(next),
          };
        });
      } catch (error) {
        if (!aliveRef.current) return;
        const message = labelForError(error, i18n.console.loadFailed);
        setState((prev) => {
          const next = {
            ...prev,
            tasksLoading: "error" as const,
            tasksError: formatSectionError(i18n.console.tasksSection, message),
          };
          return {
            ...next,
            loading: deriveAggregateLoadState(next),
            lastError: deriveAggregateError(next),
          };
        });
      }
    },
    [auth.access_token, callApi],
  );

  const refresh = useCallback<ConsoleStore["refresh"]>(
    async ({ silent } = {}) => {
      await Promise.allSettled([
        refreshOverview({ silent }),
        refreshNodes({ silent }),
        refreshTasks({ silent }),
      ]);
    },
    [refreshNodes, refreshOverview, refreshTasks],
  );

  useEffect(() => {
    setState((prev) => ({ ...prev, token: auth.access_token }));
  }, [auth.access_token]);

  useEffect(() => {
    if (!auth.access_token) return;
    void refresh();
    const id = window.setInterval(() => {
      void refresh({ silent: true });
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [auth.access_token, refresh]);

  const setRecentOnboarding = useCallback((pkg: NodeCreateResponse | null) => {
    setState((prev) => ({ ...prev, recentOnboarding: pkg }));
  }, []);

  const value = useMemo<ConsoleStore>(
    () => ({
      ...state,
      refresh,
      refreshOverview,
      refreshNodes,
      refreshTasks,
      setRecentOnboarding,
      signalAuthFailure,
      callApi,
    }),
    [
      state,
      refresh,
      refreshOverview,
      refreshNodes,
      refreshTasks,
      setRecentOnboarding,
      signalAuthFailure,
      callApi,
    ],
  );

  return <ConsoleCtx.Provider value={value}>{children}</ConsoleCtx.Provider>;
}

export function useConsoleStore(): ConsoleStore {
  const ctx = useContext(ConsoleCtx);
  if (!ctx) throw new Error("useConsoleStore must be used inside ConsoleStoreProvider");
  return ctx;
}
