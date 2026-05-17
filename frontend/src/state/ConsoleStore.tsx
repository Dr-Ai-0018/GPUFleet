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
  callApi: <T>(operation: (token: string) => Promise<T>) => Promise<T>;
};

const defaultState: ConsoleState = {
  token: "",
  me: null,
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

  const refresh = useCallback<ConsoleStore["refresh"]>(
    async ({ silent } = {}) => {
      if (!auth.access_token) return;
      if (!silent) {
        setState((prev) => ({ ...prev, loading: prev.loading === "ready" ? "ready" : "loading" }));
      }
      try {
        const [me, overview, nodes, tasks, audits, warnings] = await callApi((token) => Promise.all([
          api.getMe(token),
          api.getOverview(token),
          api.getNodes(token),
          api.listTasks(token),
          api.getAuditEvents(token, 50),
          api.getSecurityWarnings(token, 50),
        ]));
        if (!aliveRef.current) return;
        setState((prev) => ({
          ...prev,
          me,
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
        const message = error instanceof Error ? error.message : "加载控制台数据失败";
        setState((prev) => ({
          ...prev,
          loading: "error",
          lastError: message,
        }));
      }
    },
    [auth.access_token, callApi],
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
      setRecentOnboarding,
      signalAuthFailure,
      callApi,
    }),
    [state, refresh, setRecentOnboarding, signalAuthFailure, callApi],
  );

  return <ConsoleCtx.Provider value={value}>{children}</ConsoleCtx.Provider>;
}

export function useConsoleStore(): ConsoleStore {
  const ctx = useContext(ConsoleCtx);
  if (!ctx) throw new Error("useConsoleStore must be used inside ConsoleStoreProvider");
  return ctx;
}
