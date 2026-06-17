import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

function mockFetch(response: Response): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
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
 * 天云接手时:把每个 it.todo 升为 it,按注释 setup + assert 补实现。
 *  - mock 策略: vi.stubGlobal("fetch", vi.fn()),按 case 配 mockResolvedValueOnce 链
 *  - 涉及定时器(超时/sleep 退避)的 case 必须用 vi.useFakeTimers() + vi.advanceTimersByTimeAsync
 *  - 断言风格跟 §1/§2 已冻结测试对齐:具体值,不弱化阈值
 *  - 不许 skip / xfail。觉得断言写错了 → 提 issue 让人类裁定
 * ============================================================================ */

describe("api · fetchWithPolicy 重试与超时", () => {
  it.todo(
    "首次 503 → 第二次 200 透明成功,fetch 被调用 2 次,第二次发生在 ~200ms 后",
    // setup: useFakeTimers; fetch mockResolvedValueOnce(503).mockResolvedValueOnce(200+json)
    // act: const p = api.getMe('tok'); await advanceTimersByTimeAsync(220); await p
    // assert: fetch 调用次数 === 2;返回值 = mock 的 json;第二次 setTimeout delay arg === 200
  );

  it.todo(
    "连续 4 次 503 → 用完重试(MAX_RETRY_ATTEMPTS+1 = 4 次)后抛 ApiError",
    // setup: fetch 永远返 503 + body {code:'ERR_X', message:'down'}
    // act: 包 try/catch;每次 advanceTimersByTimeAsync(200/400/800) 推进退避
    // assert: fetch 调用 4 次;throw ApiError;error.status===503;error.code==='ERR_X'
  );

  it.todo(
    "退避严格遵循指数: setTimeout delay 第 1/2/3 次为 200 / 400 / 800ms",
    // setup: spyOn(window,'setTimeout');fetch 永远 503
    // assert: 重试 setTimeout 参数列表(过滤掉 AbortController 30s 的那批)严格匹配 [200,400,800]
  );

  it.todo(
    "4xx 不重试(400 / 401 / 403 / 404 / 409 / 422 各覆盖一次),fetch 调用 1 次",
    // setup: 对每个 status,fetch 返该 status + 合法错误体;assert 调用次数 === 1
  );

  it.todo(
    "请求超时 30s → AbortController.abort → 抛 Error('请求超时,请稍后重试')",
    // setup: useFakeTimers; fetch 返一个永不 resolve 的 Promise
    // act: const p = api.getMe('tok'); await advanceTimersByTimeAsync(30_001)
    // assert: rejects.toThrow('请求超时,请稍后重试')
  );

  it.todo(
    "网络错误(fetch reject TypeError)视为可重试,重试到上限后抛原 error",
    // setup: fetch rejectedValue(new TypeError('NetworkError'))
    // assert: fetch 调用 4 次;最终 throw 同一个 TypeError(error instanceof TypeError)
  );
});

describe("api · 响应体解析其它分支", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.todo(
    "204 No Content → 返回 undefined,不抛错",
    // setup: mockFetch(new Response(null, { status: 204 }))
    // assert: await api.deleteNode('tok','n1') === undefined
  );

  it.todo(
    "错误体非 JSON(纯文本)→ code = ERR_HTTP_<status>,message = 原文",
    // setup: mockFetch(new Response('gateway exploded', { status: 502 }))
    // assert: error.code === 'ERR_HTTP_502'; error.message === 'gateway exploded'
  );

  it.todo(
    "错误体只含 {code} 缺 {message} → code 保留,message fallback 为 'HTTP <status>'",
    // setup: mockFetch(new Response(JSON.stringify({code:'ERR_X'}), { status: 422 }))
    // assert: error.code === 'ERR_X'; error.message === 'HTTP 422'
  );

  it.todo(
    "Authorization header 在传 token 时被设置为 'Bearer <token>',不传则缺席",
    // setup: fetch mock,let captured: Headers; mockImpl 捕获 init.headers
    // act: api.getMe('tok-abc') 与 api.login('u','p')
    // assert: getMe 时 headers.get('Authorization')==='Bearer tok-abc';login 时 === null
  );

  it.todo(
    "POST + body 自动加 Content-Type: application/json",
    // setup: 同上捕获 headers
    // act: api.createNode('tok', payload)
    // assert: headers.get('Content-Type') === 'application/json'
  );
});

describe("api · 分页 helper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.todo(
    "requestAllPages 在某页 length < limit 时停止,合并所有页(覆盖 listAllNodes)",
    // setup: fetch mock 返 3 页:[200 items], [200 items], [50 items] (DEFAULT_PAGE_SIZE=200)
    // act: api.listAllNodes('tok')
    // assert: 返回 length === 450;fetch 调用 3 次;最后一次 query 含 offset=400
  );

  it.todo(
    "requestAllCursorPages 用 next_cursor 串联,next_cursor=null 时停止(覆盖 listAllTasks)",
    // setup: fetch mock 返 {items, next_cursor:'c1'} / {..., next_cursor:'c2'} / {..., next_cursor:null}
    // act: api.listAllTasks('tok')
    // assert: 3 次调用;第 2/3 次 URL 含 cursor=c1/c2;最终数组是 3 页 items concat
  );
});

describe("api · ApiError 类语义", () => {
  it.todo(
    "构造时 status / code / message / details 全部赋值,super(message) 落 Error.message",
    // const e = new ApiError(404, 'ERR_X', 'msg', {a:1})
    // assert: 4 字段都对;e instanceof ApiError && e instanceof Error;e.message === 'msg'
  );

  it.todo(
    "message 为空时,super 使用 'HTTP <status>' 作为 fallback",
    // const e = new ApiError(500, 'ERR_X', '')
    // assert: e.message === 'HTTP 500'
  );
});

/* 故意不在 K2 骨架内的项 - 写在这里是为了让接手者知道我们想过:
 *  - 业务 endpoint 的 happy-path 全集 → 由 e2e/integration 套件覆盖,不在单测范围
 *  - login/refresh token 生命周期 → 在 ConsoleStore.test.tsx 里覆盖(依赖 callApi)
 *  - 真实网络重试(集成 MSW) → 路线图项,本轮用 fetch mock 足够
 */
