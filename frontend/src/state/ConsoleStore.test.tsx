import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api";
import type {
  AdminProfile,
  AdminTaskListItem,
  DashboardOverview,
  NodeCreateResponse,
  NodeResponse,
  TokenPair,
} from "../types";
import { ConsoleStoreProvider, useConsoleStore } from "./ConsoleStore";
import type { ReactNode } from "react";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ApiError: actual.ApiError,
    api: {
      refresh: vi.fn(),
      getMe: vi.fn(),
      getOverview: vi.fn(),
      listAllNodes: vi.fn(),
      listAllTasks: vi.fn(),
      getAuditEvents: vi.fn(),
      getSecurityWarnings: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

const authA: TokenPair = { access_token: "tok-A", refresh_token: "ref-A", token_type: "bearer" };
const authB: TokenPair = { access_token: "tok-B", refresh_token: "ref-B", token_type: "bearer" };
const meFixture = { username: "aka47" } as AdminProfile;
const overviewFixture1 = {
  total_nodes: 1,
  online_nodes: 1,
  queued_tasks: 0,
  running_tasks: 0,
  failed_tasks: 0,
  nodes: [],
  recent_tasks: [],
} as unknown as DashboardOverview;
const overviewFixture2 = {
  ...overviewFixture1,
  total_nodes: 2,
} as DashboardOverview;
const nodeFixture = { node_id: "node-1", display_name: "Node 1" } as NodeResponse;
const taskFixture = { task_id: "task-1", status: "queued" } as AdminTaskListItem;
const onboardingFixture = {
  node: nodeFixture,
  onboarding: {
    token: "node-secret",
    install_snippet: "uv run gpufleet-agent heartbeat-loop",
    env_template: "GPUFLEET_AGENT_NODE_ID=node-1",
    onboarding_steps: [],
  },
} as unknown as NodeCreateResponse;

function makeDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function seedApiSuccess(): void {
  mockedApi.refresh.mockResolvedValue(authB);
  mockedApi.getMe.mockResolvedValue(meFixture);
  mockedApi.getOverview.mockResolvedValue(overviewFixture1);
  mockedApi.listAllNodes.mockResolvedValue([nodeFixture]);
  mockedApi.listAllTasks.mockResolvedValue([taskFixture]);
  mockedApi.getAuditEvents.mockResolvedValue([]);
  mockedApi.getSecurityWarnings.mockResolvedValue([]);
}

function makeWrapper(
  opts: {
    auth?: TokenPair;
    onAuthUpdate?: (auth: TokenPair) => void;
    onAuthFailure?: () => void;
  } = {},
) {
  let auth = opts.auth ?? authA;
  const onAuthUpdate = opts.onAuthUpdate ?? vi.fn();
  const onAuthFailure = opts.onAuthFailure ?? vi.fn();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <ConsoleStoreProvider auth={auth} onAuthUpdate={onAuthUpdate} onAuthFailure={onAuthFailure}>
      {children}
    </ConsoleStoreProvider>
  );
  return {
    Wrapper,
    onAuthUpdate,
    onAuthFailure,
    auth,
    setAuth(next: TokenPair) {
      auth = next;
    },
  };
}

async function renderReadyStore(Wrapper: ({ children }: { children: ReactNode }) => JSX.Element) {
  const hook = renderHook(() => useConsoleStore(), { wrapper: Wrapper });
  await waitFor(() => expect(hook.result.current.overviewLoading).toBe("ready"));
  vi.clearAllMocks();
  seedApiSuccess();
  return hook;
}

describe("ConsoleStore · callApi 401 refresh 链路", () => {
  beforeEach(() => {
    seedApiSuccess();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("operation 首次返 401 → 自动 api.refresh → 用新 token 重试 operation 一次 → 透明成功", async () => {
    const { Wrapper, onAuthUpdate } = makeWrapper();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(401, "ERR_UNAUTHORIZED", "token expired"))
      .mockResolvedValueOnce({ ok: true });

    const { result } = await renderReadyStore(Wrapper);
    let out: { ok: boolean } | undefined;
    await act(async () => {
      out = await result.current.callApi(operation);
    });

    expect(operation).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenNthCalledWith(1, "tok-A");
    expect(operation).toHaveBeenNthCalledWith(2, "tok-B");
    expect(mockedApi.refresh).toHaveBeenCalledTimes(1);
    expect(mockedApi.refresh).toHaveBeenCalledWith("ref-A");
    expect(onAuthUpdate).toHaveBeenCalledTimes(1);
    expect(onAuthUpdate).toHaveBeenCalledWith(authB);
    expect(out).toEqual({ ok: true });
  });

  it("多个并发 callApi 同时遇 401 → 只发一次 api.refresh (single-flight 合并)", async () => {
    // 防 W4 副作用: 后端 /admin/refresh 加了 10/min 限流后, 多个轮询 / 多窗口
    // 同时遇 401 会触多次 refresh → 撞 429 → 强制 logout. 必须合并为单次请求.
    const { Wrapper, onAuthUpdate } = makeWrapper();
    const op1 = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(401, "ERR_UNAUTHORIZED", "expired"))
      .mockResolvedValueOnce({ from: "op1" });
    const op2 = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(401, "ERR_UNAUTHORIZED", "expired"))
      .mockResolvedValueOnce({ from: "op2" });
    const op3 = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(401, "ERR_UNAUTHORIZED", "expired"))
      .mockResolvedValueOnce({ from: "op3" });

    // 让 refresh 慢一点, 三个 callApi 才能真正并发等同一个 inflight Promise
    let releaseRefresh: ((value: TokenPair) => void) | undefined;
    mockedApi.refresh.mockReturnValue(
      new Promise<TokenPair>((resolve) => {
        releaseRefresh = resolve;
      }),
    );

    const { result } = await renderReadyStore(Wrapper);
    let results: Array<{ from: string }> = [];
    await act(async () => {
      const p1 = result.current.callApi(op1);
      const p2 = result.current.callApi(op2);
      const p3 = result.current.callApi(op3);
      // 三个 op 都已经各自抛了 401, 都在等同一个 inflight refresh
      releaseRefresh?.(authB);
      results = await Promise.all([p1, p2, p3]);
    });

    expect(mockedApi.refresh).toHaveBeenCalledTimes(1);
    expect(onAuthUpdate).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.from)).toEqual(["op1", "op2", "op3"]);
    // 每个 op 用新 token 重试了一次
    expect(op1).toHaveBeenNthCalledWith(2, "tok-B");
    expect(op2).toHaveBeenNthCalledWith(2, "tok-B");
    expect(op3).toHaveBeenNthCalledWith(2, "tok-B");
  });

  it("refresh 失败 → 调用 onAuthFailure → 抛 refreshError(不是原 401)", async () => {
    const refreshError = new ApiError(401, "ERR_REFRESH_EXPIRED", "expired");
    const operation = vi
      .fn()
      .mockRejectedValue(new ApiError(401, "ERR_UNAUTHORIZED", "token expired"));
    const { Wrapper, onAuthFailure } = makeWrapper();
    const { result } = await renderReadyStore(Wrapper);
    mockedApi.refresh.mockRejectedValue(refreshError);

    await expect(result.current.callApi(operation)).rejects.toBe(refreshError);

    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(mockedApi.refresh).toHaveBeenCalledTimes(1);
  });

  it("非 401 错误(403 / 500 / 网络错误)直接抛出,不触发 refresh,不调用 onAuthFailure", async () => {
    const cases = [
      new ApiError(403, "ERR_FORBIDDEN", "forbidden"),
      new ApiError(500, "ERR_INTERNAL", "db down"),
      new TypeError("NetworkError"),
    ];

    for (const error of cases) {
      vi.clearAllMocks();
      seedApiSuccess();
      const operation = vi.fn().mockRejectedValue(error);
      const { Wrapper, onAuthFailure } = makeWrapper();
      const { result, unmount } = await renderReadyStore(Wrapper);

      await expect(result.current.callApi(operation)).rejects.toBe(error);

      expect(mockedApi.refresh).not.toHaveBeenCalled();
      expect(onAuthFailure).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("非 ApiError 异常(Error / TypeError)直接抛出,不触发 refresh", async () => {
    const error = new Error("boom");
    const operation = vi.fn().mockRejectedValue(error);
    const { Wrapper } = makeWrapper();
    const { result } = await renderReadyStore(Wrapper);

    await expect(result.current.callApi(operation)).rejects.toBe(error);

    expect(mockedApi.refresh).not.toHaveBeenCalled();
  });
});

describe("ConsoleStore · 独立降级刷新", () => {
  beforeEach(() => {
    seedApiSuccess();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("refreshNodes 500 失败时,refreshOverview / refreshTasks 仍正常完成(refresh allSettled)", async () => {
    mockedApi.listAllNodes.mockRejectedValue(new ApiError(500, "ERR_INTERNAL", "db down"));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useConsoleStore(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.overviewLoading).toBe("ready"));
    await waitFor(() => expect(result.current.tasksLoading).toBe("ready"));
    await waitFor(() => expect(result.current.nodesLoading).toBe("error"));

    expect(result.current.overview).toBe(overviewFixture1);
    expect(result.current.overviewError).toBeNull();
    expect(result.current.nodes).toEqual([]);
    expect(result.current.nodesError).toContain("节点");
    expect(result.current.tasks).toEqual([taskFixture]);
    expect(result.current.tasksError).toBeNull();
  });

  it("聚合 loading 在任一子项 loading 时为 'loading',全部完成才回 'ready'", async () => {
    const overviewDeferred = makeDeferred<DashboardOverview>();
    const nodesDeferred = makeDeferred<NodeResponse[]>();
    const tasksDeferred = makeDeferred<AdminTaskListItem[]>();
    mockedApi.getOverview.mockReturnValue(overviewDeferred.promise);
    mockedApi.listAllNodes.mockReturnValue(nodesDeferred.promise);
    mockedApi.listAllTasks.mockReturnValue(tasksDeferred.promise);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useConsoleStore(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.loading).toBe("loading"));

    await act(async () => {
      overviewDeferred.resolve(overviewFixture1);
      nodesDeferred.resolve([nodeFixture]);
      tasksDeferred.resolve([taskFixture]);
    });

    await waitFor(() => expect(result.current.loading).toBe("ready"));
  });

  it("聚合 lastError 用 ' · ' 连接所有子项 error,无 error 时为 null", async () => {
    mockedApi.getOverview.mockRejectedValue(new ApiError(500, "ERR_A", "msgA"));
    mockedApi.listAllNodes.mockRejectedValue(new ApiError(500, "ERR_B", "msgB"));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useConsoleStore(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.lastError).toContain("msgA"));
    expect(result.current.lastError).toContain(" · ");
    expect(result.current.lastError).toContain("msgB");

    mockedApi.getOverview.mockResolvedValue(overviewFixture1);
    mockedApi.listAllNodes.mockResolvedValue([nodeFixture]);
    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => expect(result.current.lastError).toBeNull());
  });

  it("silent: true 不切 loading 为 'loading'(后台轮询不该闪烁 UI)", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useConsoleStore(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.overviewLoading).toBe("ready"));
    const deferred = makeDeferred<DashboardOverview>();
    mockedApi.getOverview.mockReturnValueOnce(deferred.promise);

    act(() => {
      void result.current.refreshOverview({ silent: true });
    });

    expect(result.current.overviewLoading).toBe("ready");

    await act(async () => {
      deferred.resolve(overviewFixture2);
    });
    await waitFor(() => expect(result.current.overview).toBe(overviewFixture2));
  });

  it("组件卸载后(aliveRef.current = false)setState 不再调用,避免 React 警告", async () => {
    const overviewDeferred = makeDeferred<DashboardOverview>();
    mockedApi.getOverview.mockReturnValue(overviewDeferred.promise);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { Wrapper } = makeWrapper();
    const { unmount } = renderHook(() => useConsoleStore(), { wrapper: Wrapper });

    unmount();
    await act(async () => {
      overviewDeferred.resolve(overviewFixture1);
    });

    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("Can't perform a React state update on an unmounted component"),
    );
  });
});

describe("ConsoleStore · 周期 refresh + token 变化", () => {
  beforeEach(() => {
    seedApiSuccess();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("mount 后立刻触发一次 refresh,然后每 5s silent refresh 一次", async () => {
    vi.useFakeTimers();
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useConsoleStore(), { wrapper: Wrapper });

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedApi.getOverview).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_001);
    });

    expect(mockedApi.getOverview).toHaveBeenCalledTimes(2);
    expect(result.current.overviewLoading).toBe("ready");
  });

  it("auth.access_token 为空字符串时,refresh* 立刻 return,不发请求", async () => {
    const { Wrapper } = makeWrapper({
      auth: { access_token: "", refresh_token: "", token_type: "bearer" },
    });
    const { result } = renderHook(() => useConsoleStore(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.refresh();
      await result.current.refreshOverview();
      await result.current.refreshNodes();
      await result.current.refreshTasks();
    });

    expect(mockedApi.getMe).not.toHaveBeenCalled();
    expect(mockedApi.getOverview).not.toHaveBeenCalled();
    expect(mockedApi.listAllNodes).not.toHaveBeenCalled();
    expect(mockedApi.listAllTasks).not.toHaveBeenCalled();
  });

  it("auth.access_token 变化时,setState 同步更新 state.token", async () => {
    const wrapperState = makeWrapper();
    const { result, rerender } = renderHook(() => useConsoleStore(), {
      wrapper: wrapperState.Wrapper,
    });

    expect(result.current.token).toBe("tok-A");

    wrapperState.setAuth(authB);
    rerender();

    await waitFor(() => expect(result.current.token).toBe("tok-B"));
  });
});

describe("ConsoleStore · prevOverview delta cache", () => {
  beforeEach(() => {
    seedApiSuccess();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("首次 refresh 后 prevOverview === null,overview === fixture1", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useConsoleStore(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.overview).toBe(overviewFixture1));

    expect(result.current.prevOverview).toBeNull();
  });

  it("第二次 refresh 后 prevOverview === fixture1,overview === fixture2", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useConsoleStore(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.overview).toBe(overviewFixture1));
    mockedApi.getOverview.mockResolvedValue(overviewFixture2);

    await act(async () => {
      await result.current.refreshOverview();
    });

    expect(result.current.prevOverview).toBe(overviewFixture1);
    expect(result.current.overview).toBe(overviewFixture2);
  });
});

describe("ConsoleStore · setRecentOnboarding", () => {
  beforeEach(() => {
    seedApiSuccess();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("setRecentOnboarding(pkg) → state.recentOnboarding === pkg", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = await renderReadyStore(Wrapper);

    act(() => result.current.setRecentOnboarding(onboardingFixture));

    expect(result.current.recentOnboarding).toBe(onboardingFixture);
  });

  it("setRecentOnboarding(null) → state.recentOnboarding === null", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = await renderReadyStore(Wrapper);

    act(() => result.current.setRecentOnboarding(onboardingFixture));
    act(() => result.current.setRecentOnboarding(null));

    expect(result.current.recentOnboarding).toBeNull();
  });
});
