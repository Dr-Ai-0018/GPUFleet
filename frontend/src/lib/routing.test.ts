import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHash, navigate, parseHash, useRoute, type Route } from "./routing";

describe("parseHash", () => {
  it("parses known static routes", () => {
    expect(parseHash("#/overview")).toEqual({ name: "overview" });
    expect(parseHash("#/onboarding")).toEqual({ name: "onboarding" });
    expect(parseHash("#/fleet")).toEqual({ name: "fleet" });
    expect(parseHash("#/tasks")).toEqual({ name: "tasks" });
    expect(parseHash("#/security")).toEqual({ name: "security" });
  });

  it("parses encoded detail ids", () => {
    expect(parseHash("#/nodes/node%201")).toEqual({ name: "node-detail", nodeId: "node 1" });
    expect(parseHash("#/tasks/task%2Fone")).toEqual({ name: "task-detail", taskId: "task/one" });
  });

  it("falls back for malformed or unknown hashes", () => {
    expect(parseHash("#/does-not-exist")).toEqual({ name: "overview" });
    expect(parseHash("#/nodes/%E0%A4%A")).toEqual({ name: "fleet" });
    expect(parseHash("#/tasks/%")).toEqual({ name: "tasks" });
    expect(parseHash("#/fleet/extra")).toEqual({ name: "overview" });
  });
});

/* ============================================================================
 * K2 骨架补丁 — §5.2 关键路径覆盖(可迪 2026-06-17 出,天云 T4 实施)
 *
 * 现有 parseHash 已覆盖: static / encoded detail / malformed / extra segments
 * 还缺以下 gap,天云填实现时把占位用例升为可执行 it。
 * ============================================================================ */

describe("parseHash · gap items pending T4", () => {
  it("空字符串 / 仅 '#' / 仅 '#/' → FALLBACK_ROUTE { name: 'overview' }", () => {
    expect(parseHash("")).toEqual({ name: "overview" });
    expect(parseHash("#")).toEqual({ name: "overview" });
    expect(parseHash("#/")).toEqual({ name: "overview" });
  });

  it("trailing slash 行为: '#/fleet/' 应等价于 '#/fleet'(filter(Boolean) 去掉空段)", () => {
    expect(parseHash("#/fleet/")).toEqual({ name: "fleet" });
    expect(parseHash("#/nodes/n1/")).toEqual({ name: "node-detail", nodeId: "n1" });
  });

  it("'#/nodes'(无 id)→ fleet;'#/nodes/'(空 id)→ fleet", () => {
    expect(parseHash("#/nodes")).toEqual({ name: "fleet" });
    expect(parseHash("#/nodes/")).toEqual({ name: "fleet" });
    expect(parseHash("#/nodes/   ")).toEqual({ name: "fleet" });
  });

  it("decode 后是纯空白 → 视为无 id 走 list", () => {
    expect(parseHash("#/nodes/%20%20")).toEqual({ name: "fleet" });
    expect(parseHash("#/tasks/%20")).toEqual({ name: "tasks" });
  });

  it("未知顶级路径但带二级段(如 '#/fleet/anything')→ FALLBACK_ROUTE", () => {
    expect(parseHash("#/security/extra")).toEqual({ name: "overview" });
    expect(parseHash("#/onboarding/x")).toEqual({ name: "overview" });
    expect(parseHash("#/tasks/x/y")).toEqual({ name: "overview" });
  });
});

describe("buildHash · 每个 Route shape 输出反过来能被 parseHash 还原", () => {
  it("对所有 Route shape 做 roundtrip: parseHash(buildHash(r)).toEqual(r)", () => {
    const routes: Route[] = [
      { name: "overview" },
      { name: "onboarding" },
      { name: "fleet" },
      { name: "tasks" },
      { name: "security" },
      { name: "node-detail", nodeId: "n1" },
      { name: "node-detail", nodeId: "n with space" },
      { name: "node-detail", nodeId: "n/slash" },
      { name: "task-detail", taskId: "t1" },
      { name: "task-detail", taskId: "t with space" },
    ];

    for (const route of routes) {
      expect(parseHash(buildHash(route))).toEqual(route);
    }
  });

  it("nodeId / taskId 含特殊字符(空格 / 斜杠 / 中文)→ buildHash 用 encodeURIComponent", () => {
    expect(buildHash({ name: "node-detail", nodeId: "n 1" })).toBe("#/nodes/n%201");
    expect(buildHash({ name: "node-detail", nodeId: "n/slash" })).toBe("#/nodes/n%2Fslash");
    expect(buildHash({ name: "task-detail", taskId: "任务" })).toMatch(/^#\/tasks\/%E4/);
  });
});

describe("navigate · 副作用", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.location.hash = "";
  });

  it("navigate 设置 window.location.hash 为 buildHash 结果", () => {
    window.location.hash = "#/overview";

    navigate({ name: "fleet" });

    expect(window.location.hash).toBe("#/fleet");
  });

  it("navigate 到同 hash 不重复 set(避免触发 hashchange 死循环)", async () => {
    window.location.hash = "#/fleet";
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const onHashChange = vi.fn();
    window.addEventListener("hashchange", onHashChange);

    navigate({ name: "fleet" });
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(onHashChange).not.toHaveBeenCalled();
    window.removeEventListener("hashchange", onHashChange);
  });
});

describe("useRoute · hook", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.location.hash = "";
  });

  it("mount 时若无 hash,replace 为 DEFAULT_HASH('#/onboarding')", () => {
    window.location.hash = "";

    renderHook(() => useRoute());

    expect(window.location.hash).toBe("#/onboarding");
  });

  it("hashchange 事件触发 → setRoute 同步", () => {
    window.location.hash = "#/overview";
    const { result } = renderHook(() => useRoute());

    act(() => {
      window.location.hash = "#/fleet";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(result.current).toEqual({ name: "fleet" });
  });

  it("unmount 时正确移除 hashchange listener,无泄漏", () => {
    window.location.hash = "#/overview";
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { result, unmount } = renderHook(() => useRoute());

    unmount();
    act(() => {
      window.location.hash = "#/fleet";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(removeSpy).toHaveBeenCalledWith("hashchange", expect.any(Function));
    expect(result.current).toEqual({ name: "overview" });
  });
});
