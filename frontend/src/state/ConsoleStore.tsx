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
import type {
  AdminTaskListItem,
  AuditEventView,
  DashboardOverview,
  NodeCreateResponse,
  NodeResponse,
  SecurityWarningView,
} from "../types";

export type LoadState = "idle" | "loading" | "ready" | "error";

export type ConsoleState = {
  token: string;
  loading: LoadState;
  lastError: string | null;
  overview: DashboardOverview | null;
  nodes: NodeResponse[];
  tasks: AdminTaskListItem[];
  audits: AuditEventView[];
  warnings: SecurityWarningView[];
  recentOnboarding: NodeCreateResponse | null;
  lastSyncedAt: number | null;
};

export type ConsoleStore = ConsoleState & {
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  setRecentOnboarding: (pkg: NodeCreateResponse | null) => void;
  signalAuthFailure: () => void;
};

const defaultState: ConsoleState = {
  token: "",
  loading: "idle",
  lastError: null,
  overview: null,
  nodes: [],
  tasks: [],
  audits: [],
  warnings: [],
  recentOnboarding: null,
  lastSyncedAt: null,
};

const ConsoleCtx = createContext<ConsoleStore | null>(null);

const REFRESH_INTERVAL_MS = 5000;

type ProviderProps = {
  token: string;
  onAuthFailure: () => void;
  children: ReactNode;
};

export function ConsoleStoreProvider({ token, onAuthFailure, children }: ProviderProps): JSX.Element {
  const [state, setState] = useState<ConsoleState>({ ...defaultState, token });
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

  const refresh = useCallback<ConsoleStore["refresh"]>(
    async ({ silent } = {}) => {
      if (!token) return;
      if (!silent) {
        setState((prev) => ({ ...prev, loading: prev.loading === "ready" ? "ready" : "loading" }));
      }
      try {
        const [overview, nodes, tasks, audits, warnings] = await Promise.all([
          api.getOverview(token),
          api.getNodes(token),
          api.listTasks(token),
          api.getAuditEvents(token, 50),
          api.getSecurityWarnings(token, 50),
        ]);
        if (!aliveRef.current) return;
        setState((prev) => ({
          ...prev,
          loading: "ready",
          lastError: null,
          overview,
          nodes,
          tasks,
          audits,
          warnings,
          lastSyncedAt: Date.now(),
        }));
      } catch (error) {
        if (!aliveRef.current) return;
        if (error instanceof ApiError && error.status === 401) {
          signalAuthFailure();
          return;
        }
        const message = error instanceof Error ? error.message : "加载控制台数据失败";
        setState((prev) => ({
          ...prev,
          loading: "error",
          lastError: message,
        }));
      }
    },
    [token, signalAuthFailure],
  );

  useEffect(() => {
    if (!token) return;
    void refresh();
    const id = window.setInterval(() => {
      void refresh({ silent: true });
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [token, refresh]);

  const setRecentOnboarding = useCallback((pkg: NodeCreateResponse | null) => {
    setState((prev) => ({ ...prev, recentOnboarding: pkg }));
  }, []);

  const value = useMemo<ConsoleStore>(
    () => ({
      ...state,
      refresh,
      setRecentOnboarding,
      signalAuthFailure,
    }),
    [state, refresh, setRecentOnboarding, signalAuthFailure],
  );

  return <ConsoleCtx.Provider value={value}>{children}</ConsoleCtx.Provider>;
}

export function useConsoleStore(): ConsoleStore {
  const ctx = useContext(ConsoleCtx);
  if (!ctx) throw new Error("useConsoleStore must be used inside ConsoleStoreProvider");
  return ctx;
}
