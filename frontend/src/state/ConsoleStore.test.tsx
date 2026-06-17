/**
 * K2 骨架 — §5.2 关键路径覆盖(可迪 2026-06-17 出,天云 T4 实施)
 *
 * 范围:ConsoleStore 的三件关键行为
 *  1) callApi 的 401 → refresh → 重试 链路
 *  2) refreshOverview / refreshNodes / refreshTasks 的独立降级(单接口失败不影响其它)
 *  3) loading/error 聚合派生(deriveAggregateLoadState / deriveAggregateError)
 *
 * 渲染策略:
 *  - 用 @testing-library/react 的 renderHook(从 'react') + ConsoleStoreProvider 包一层
 *  - 推荐建一个 wrapper helper: makeWrapper({auth, onAuthUpdate, onAuthFailure})
 *  - api 模块整体 mock: vi.mock("../api", ...) 暴露每个方法独立 vi.fn()
 *  - 避免 setInterval 真触发污染测试: 用 vi.useFakeTimers 但只 advance 你需要的 5s 周期
 *
 * 断言风格不弱化。觉得断言写错了 → 提 issue 让人类裁定,不要 skip。
 */

import { afterEach, beforeEach, describe, it, vi } from "vitest";

// import { renderHook, act, waitFor } from "@testing-library/react";
// import { ConsoleStoreProvider, useConsoleStore } from "./ConsoleStore";
// import { api, ApiError } from "../api";
// import type { ReactNode } from "react";
// import type { TokenPair } from "../types";

vi.mock("../api"); // 让 vitest 自动给每个 api.* 方法发 vi.fn()

/* -------------------------------------------------------------------------- */
/* Wrapper helper 占位 - 天云填实现                                            */
/* -------------------------------------------------------------------------- */
//
// function makeWrapper(opts: {
//   auth?: TokenPair;
//   onAuthUpdate?: (a: TokenPair) => void;
//   onAuthFailure?: () => void;
// } = {}) {
//   const auth = opts.auth ?? { access_token: "tok-A", refresh_token: "ref-A" };
//   const onAuthUpdate = opts.onAuthUpdate ?? vi.fn();
//   const onAuthFailure = opts.onAuthFailure ?? vi.fn();
//   const Wrapper = ({ children }: { children: ReactNode }) => (
//     <ConsoleStoreProvider auth={auth} onAuthUpdate={onAuthUpdate} onAuthFailure={onAuthFailure}>
//       {children}
//     </ConsoleStoreProvider>
//   );
//   return { Wrapper, onAuthUpdate, onAuthFailure, auth };
// }

/* -------------------------------------------------------------------------- */
describe("ConsoleStore · callApi 401 refresh 链路", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it.todo(
    "operation 首次返 401 → 自动 api.refresh → 用新 token 重试 operation 一次 → 透明成功",
    // setup:
    //   api.refresh.mockResolvedValue({access_token:'tok-B', refresh_token:'ref-B'})
    //   const op = vi.fn()
    //     .mockRejectedValueOnce(new ApiError(401,'ERR_UNAUTHORIZED','token expired'))
    //     .mockResolvedValueOnce({ok:true})
    // act: const { result } = renderHook(() => useConsoleStore(), { wrapper })
    //      const out = await result.current.callApi(op)
    // assert:
    //   op 调用 2 次;第 1 次传 'tok-A',第 2 次传 'tok-B'
    //   api.refresh 调用 1 次,参数 'ref-A'
    //   onAuthUpdate 调用 1 次,参数为新 TokenPair
    //   out === {ok:true}
  );

  it.todo(
    "refresh 失败 → 调用 onAuthFailure → 抛 refreshError(不是原 401)",
    // setup:
    //   api.refresh.mockRejectedValue(new ApiError(401,'ERR_REFRESH_EXPIRED','expired'))
    //   const op = vi.fn().mockRejectedValue(new ApiError(401,'ERR_UNAUTHORIZED','token expired'))
    // act: await expect(callApi(op)).rejects.toMatchObject({code:'ERR_REFRESH_EXPIRED'})
    // assert: onAuthFailure 调用 1 次;op 调用 1 次(不重试);api.refresh 调用 1 次
  );

  it.todo(
    "非 401 错误(403 / 500 / 网络错误)直接抛出,不触发 refresh,不调用 onAuthFailure",
    // 对每个 status 跑一次;assert api.refresh.calledTimes === 0
  );

  it.todo(
    "非 ApiError 异常(Error / TypeError)直接抛出,不触发 refresh",
    // setup: op throw new Error('boom')
    // assert: callApi rejects 同一个 Error;api.refresh 未调用
  );
});

/* -------------------------------------------------------------------------- */
describe("ConsoleStore · 独立降级刷新", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it.todo(
    "refreshNodes 500 失败时,refreshOverview / refreshTasks 仍正常完成(refresh allSettled)",
    // setup:
    //   api.getMe.mockResolvedValue(meFixture)
    //   api.getOverview.mockResolvedValue(overviewFixture)
    //   api.listAllNodes.mockRejectedValue(new ApiError(500,'ERR_INTERNAL','db down'))
    //   api.listAllTasks.mockResolvedValue([taskFixture])
    //   api.getAuditEvents.mockResolvedValue([])
    //   api.getSecurityWarnings.mockResolvedValue([])
    // act: render hook;await waitFor(...) 直到 overviewLoading === 'ready'
    // assert:
    //   state.overview === overviewFixture 且 overviewLoading === 'ready' 且 overviewError === null
    //   state.nodes === [] 且 nodesLoading === 'error' 且 nodesError 含 '节点'/i18n.console.nodesSection 文案
    //   state.tasks === [taskFixture] 且 tasksLoading === 'ready'
  );

  it.todo(
    "聚合 loading 在任一子项 loading 时为 'loading',全部完成才回 'ready'",
    // setup: 让 getOverview / listAllNodes / listAllTasks 各自 pending 一段时间
    // 顺序 advance 时间,assert 中间态 loading,end 态 ready
  );

  it.todo(
    "聚合 lastError 用 ' · ' 连接所有子项 error,无 error 时为 null",
    // setup: getOverview 抛 ApiError('ERR_A','msgA'),其余成功
    // assert: state.lastError 含 'msgA';nodesError/tasksError null;lastError 不为空串
    //
    // 然后再触发一个成功 refresh,assert lastError → null
  );

  it.todo(
    "silent: true 不切 loading 为 'loading'(后台轮询不该闪烁 UI)",
    // setup: refresh 已经 ready;再以 silent:true 调 refreshOverview
    // assert: 调用期间 overviewLoading 保持 'ready',不出现 'loading' 中间态
  );

  it.todo(
    "组件卸载后(aliveRef.current = false)setState 不再调用,避免 React 警告",
    // setup: 启动 refresh;在 fetch resolve 之前 unmount
    // assert: hook 不再 update;无 "Can't perform a React state update on unmounted" 警告
  );
});

/* -------------------------------------------------------------------------- */
describe("ConsoleStore · 周期 refresh + token 变化", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it.todo(
    "mount 后立刻触发一次 refresh,然后每 5s silent refresh 一次",
    // setup: 所有 api.* 都 resolve 空数据
    // act: render;await initial refresh 完成;advanceTimers 5_001ms
    // assert: api.getOverview 第 2 次调用发生;loading 保持 'ready' 不闪
  );

  it.todo(
    "auth.access_token 为空字符串时,refresh* 立刻 return,不发请求",
    // setup: auth = {access_token:'', refresh_token:''}
    // assert: api.* 任一调用都 === 0
  );

  it.todo(
    "auth.access_token 变化时,setState 同步更新 state.token",
    // setup: rerender 传新 auth
    // assert: state.token === auth.access_token
  );
});

/* -------------------------------------------------------------------------- */
describe("ConsoleStore · prevOverview delta cache", () => {
  it.todo(
    "首次 refresh 后 prevOverview === null,overview === fixture1",
    // 验证初始 cache 行为
  );

  it.todo(
    "第二次 refresh 后 prevOverview === fixture1,overview === fixture2",
    // 验证 DeltaBadge 数据源(P0-#3)的语义不被破坏
  );
});

/* -------------------------------------------------------------------------- */
describe("ConsoleStore · setRecentOnboarding", () => {
  it.todo(
    "setRecentOnboarding(pkg) → state.recentOnboarding === pkg",
  );

  it.todo(
    "setRecentOnboarding(null) → state.recentOnboarding === null",
  );
});

/* 故意不在 K2 骨架内的项:
 *  - useConsoleStore 在 Provider 外抛错的语义已经在 type 层强制,不需要单测重复
 *  - 完整 E2E refresh chain(真 fetch + 真 API) → integration 套件覆盖
 *  - refresh interval 的 cleanup → React 18 strict mode 自带覆盖
 */
