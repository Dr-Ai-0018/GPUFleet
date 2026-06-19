import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

function mockFetch(response: Response): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), init);
}

function fetchMock(): ReturnType<typeof vi.fn> {
  return vi.mocked(fetch) as unknown as ReturnType<typeof vi.fn>;
}

describe("api error parsing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses structured API errors into ApiError fields", async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          code: "ERR_TASK_NOT_FOUND",
          message: "Task not found",
          details: { task_id: "tsk_1" },
        }),
        { status: 404 },
      ),
    );

    await expect(api.getTaskDetail("token", "tsk_1")).rejects.toMatchObject({
      status: 404,
      code: "ERR_TASK_NOT_FOUND",
      message: "Task not found",
      details: { task_id: "tsk_1" },
    });
  });

  it("does not fall back to legacy detail bodies", async () => {
    mockFetch(new Response(JSON.stringify({ detail: "Legacy detail" }), { status: 400 }));

    try {
      await api.getOverview("token");
      throw new Error("Expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        status: 400,
        code: "ERR_HTTP_400",
        message: "HTTP 400",
      });
    }
  });
});

/* ============================================================================
 * K2 骨架 — §5.2 关键路径覆盖(可迪 2026-06-17 出,天云 T4 实施)
 *
 * 天云接手时:把每个占位用例升为可执行 it,按注释 setup + assert 补实现。
 *  - mock 策略: vi.stubGlobal("fetch", vi.fn()),按 case 配 mockResolvedValueOnce 链
 *  - 涉及定时器(超时/sleep 退避)的 case 必须用 vi.useFakeTimers() + vi.advanceTimersByTimeAsync
 *  - 断言风格跟 §1/§2 已冻结测试对齐:具体值,不弱化阈值
 *  - 不许 skip / xfail。觉得断言写错了 → 提 issue 让人类裁定
 * ============================================================================ */

describe("api · fetchWithPolicy 重试与超时", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("首次 503 → 第二次 200 透明成功,fetch 被调用 2 次,第二次发生在 ~200ms 后", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ code: "ERR_DOWN", message: "down" }, { status: 503 }))
        .mockResolvedValueOnce(jsonResponse({ username: "aka47" }, { status: 200 })),
    );

    const promise = api.getMe("tok");
    await vi.advanceTimersByTimeAsync(220);
    await expect(promise).resolves.toEqual({ username: "aka47" });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(setTimeoutSpy.mock.calls.map((call) => call[1]).filter((ms) => ms !== 30_000)).toEqual([
      200,
    ]);
  });

  it("连续 4 次 503 → 用完重试(MAX_RETRY_ATTEMPTS+1 = 4 次)后抛 ApiError", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ code: "ERR_X", message: "down" }, { status: 503 })),
    );

    const promise = api.getMe("tok");
    const assertion = expect(promise).rejects.toMatchObject({
      status: 503,
      code: "ERR_X",
      message: "down",
    });
    await vi.advanceTimersByTimeAsync(2_000);

    await assertion;
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("退避严格遵循指数: setTimeout delay 第 1/2/3 次为 200 / 400 / 800ms", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ code: "ERR_X", message: "down" }, { status: 503 })),
    );

    const promise = api.getMe("tok");
    const assertion = expect(promise).rejects.toBeInstanceOf(ApiError);
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;

    expect(setTimeoutSpy.mock.calls.map((call) => call[1]).filter((ms) => ms !== 30_000)).toEqual([
      200, 400, 800,
    ]);
  });

  it("4xx 不重试(400 / 401 / 403 / 404 / 409 / 422 各覆盖一次),fetch 调用 1 次", async () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      vi.unstubAllGlobals();
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse({ code: `ERR_${status}`, message: `status ${status}` }, { status }),
          ),
      );

      await expect(api.getMe("tok")).rejects.toMatchObject({
        status,
        code: `ERR_${status}`,
        message: `status ${status}`,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("请求超时 30s → AbortController.abort → 抛 Error('请求超时,请稍后重试')", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      }),
    );

    const promise = api.getMe("tok");
    const assertion = expect(promise).rejects.toThrow("请求超时,请稍后重试");
    await vi.advanceTimersByTimeAsync(30_001);

    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("网络错误(fetch reject TypeError)视为可重试,重试到上限后抛原 error", async () => {
    vi.useFakeTimers();
    const networkError = new TypeError("NetworkError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));

    const promise = api.getMe("tok");
    const assertion = expect(promise).rejects.toBe(networkError);
    await vi.advanceTimersByTimeAsync(2_000);

    await assertion;
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

describe("api · 响应体解析其它分支", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("204 No Content → 返回 undefined,不抛错", async () => {
    mockFetch(new Response(null, { status: 204 }));

    await expect(api.deleteNode("tok", "n1")).resolves.toBeUndefined();
  });

  it("错误体非 JSON(纯文本)→ code = ERR_HTTP_<status>,message = 原文", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("gateway exploded", { status: 502 })),
    );

    const assertion = expect(api.getMe("tok")).rejects.toMatchObject({
      status: 502,
      code: "ERR_HTTP_502",
      message: "gateway exploded",
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
  });

  it("错误体只含 {code} 缺 {message} → code 保留,message fallback 为 'HTTP <status>'", async () => {
    mockFetch(jsonResponse({ code: "ERR_X" }, { status: 422 }));

    await expect(api.getMe("tok")).rejects.toMatchObject({
      status: 422,
      code: "ERR_X",
      message: "HTTP 422",
    });
  });

  it("Authorization header 在传 token 时被设置为 'Bearer <token>',不传则缺席", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ username: "aka47" })));
    await api.getMe("tok-abc");
    const authedHeaders = fetchMock().mock.calls[0][1].headers as Headers;

    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ access_token: "a", refresh_token: "r" })),
    );
    await api.login("u", "p");
    const loginHeaders = fetchMock().mock.calls[0][1].headers as Headers;

    expect(authedHeaders.get("Authorization")).toBe("Bearer tok-abc");
    expect(loginHeaders.get("Authorization")).toBeNull();
  });

  it("POST + body 自动加 Content-Type: application/json", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ node_id: "n1" })));

    await api.createNode("tok", {
      node_id: "n1",
      display_name: "Node 1",
      node_type: "physical",
      os_type: "linux",
      hostname: "node-1",
      heartbeat_interval_sec: 5,
      allowed_workdirs: [],
      tags: [],
    });

    const headers = fetchMock().mock.calls[0][1].headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});

describe("api · 分页 helper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requestAllPages 在某页 length < limit 时停止,合并所有页(覆盖 listAllNodes)", async () => {
    const makePage = (start: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({ node_id: `n${start + index}` }));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(makePage(0, 200)))
        .mockResolvedValueOnce(jsonResponse(makePage(200, 200)))
        .mockResolvedValueOnce(jsonResponse(makePage(400, 50))),
    );

    const nodes = await api.listAllNodes("tok");

    expect(nodes).toHaveLength(450);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(fetchMock().mock.calls[2][0])).toContain("offset=400");
  });

  it("requestAllCursorPages 用 next_cursor 串联,next_cursor=null 时停止(覆盖 listAllTasks)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ items: [{ task_id: "t0" }], next_cursor: "c1" }))
        .mockResolvedValueOnce(jsonResponse({ items: [{ task_id: "t1" }], next_cursor: "c2" }))
        .mockResolvedValueOnce(jsonResponse({ items: [{ task_id: "t2" }], next_cursor: null })),
    );

    const tasks = await api.listAllTasks("tok");

    expect(tasks.map((task) => task.task_id)).toEqual(["t0", "t1", "t2"]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(fetchMock().mock.calls[1][0])).toContain("cursor=c1");
    expect(String(fetchMock().mock.calls[2][0])).toContain("cursor=c2");
  });
});

describe("api · ApiError 类语义", () => {
  it("构造时 status / code / message / details 全部赋值,super(message) 落 Error.message", () => {
    const details = { a: 1 };
    const error = new ApiError(404, "ERR_X", "msg", details);

    expect(error.status).toBe(404);
    expect(error.code).toBe("ERR_X");
    expect(error.details).toBe(details);
    expect(error.message).toBe("msg");
    expect(error.body).toBe("msg");
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
  });

  it("message 为空时,super 使用 'HTTP <status>' 作为 fallback", () => {
    const error = new ApiError(500, "ERR_X", "");

    expect(error.message).toBe("HTTP 500");
    expect(error.body).toBe("HTTP 500");
  });
});

/* 故意不在 K2 骨架内的项 - 写在这里是为了让接手者知道我们想过:
 *  - 业务 endpoint 的 happy-path 全集 → 由 e2e/integration 套件覆盖,不在单测范围
 *  - login/refresh token 生命周期 → 在 ConsoleStore.test.tsx 里覆盖(依赖 callApi)
 *  - 真实网络重试(集成 MSW) → 路线图项,本轮用 fetch mock 足够
 */
