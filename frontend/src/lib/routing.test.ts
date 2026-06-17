import { describe, expect, it } from "vitest";
import { parseHash } from "./routing";

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
 * 还缺以下 gap,天云填实现时把 it.todo 升为 it。
 * ============================================================================ */

describe("parseHash · gap items pending T4", () => {
  it.todo(
    "空字符串 / 仅 '#' / 仅 '#/' → FALLBACK_ROUTE { name: 'overview' }",
    // expect(parseHash("")).toEqual({ name: "overview" })
    // expect(parseHash("#")).toEqual({ name: "overview" })
    // expect(parseHash("#/")).toEqual({ name: "overview" })
  );

  it.todo(
    "trailing slash 行为: '#/fleet/' 应等价于 '#/fleet'(filter(Boolean) 去掉空段)",
    // expect(parseHash("#/fleet/")).toEqual({ name: "fleet" })
    // expect(parseHash("#/nodes/n1/")).toEqual({ name: "node-detail", nodeId: "n1" })
  );

  it.todo(
    "'#/nodes'(无 id)→ fleet;'#/nodes/'(空 id)→ fleet",
    // expect(parseHash("#/nodes")).toEqual({ name: "fleet" })
    // expect(parseHash("#/nodes/")).toEqual({ name: "fleet" })
    // expect(parseHash("#/nodes/   ")).toEqual({ name: "fleet" })  // safeDecode trim 空字符串
  );

  it.todo(
    "decode 后是纯空白 → 视为无 id 走 list",
    // expect(parseHash("#/nodes/%20%20")).toEqual({ name: "fleet" })
    // expect(parseHash("#/tasks/%20")).toEqual({ name: "tasks" })
  );

  it.todo(
    "未知顶级路径但带二级段(如 '#/fleet/anything')→ FALLBACK_ROUTE",
    // expect(parseHash("#/security/extra")).toEqual({ name: "overview" })
    // expect(parseHash("#/onboarding/x")).toEqual({ name: "overview" })
    // expect(parseHash("#/tasks/x/y")).toEqual({ name: "overview" }) // rest.length > 0
  );
});

describe("buildHash · 每个 Route shape 输出反过来能被 parseHash 还原", () => {
  it.todo(
    "对所有 Route shape 做 roundtrip: parseHash(buildHash(r)).toEqual(r)",
    // 列表:
    //   { name: 'overview' } / 'onboarding' / 'fleet' / 'tasks' / 'security'
    //   { name: 'node-detail', nodeId: 'n1' }
    //   { name: 'node-detail', nodeId: 'n with space' }
    //   { name: 'node-detail', nodeId: 'n/slash' }
    //   { name: 'task-detail', taskId: 't1' }
    //   { name: 'task-detail', taskId: 't with space' }
    // 全部应满足 parseHash(buildHash(r)) deep equal r
  );

  it.todo(
    "nodeId / taskId 含特殊字符(空格 / 斜杠 / 中文)→ buildHash 用 encodeURIComponent",
    // expect(buildHash({name:'node-detail', nodeId:'n 1'})).toBe('#/nodes/n%201')
    // expect(buildHash({name:'task-detail', taskId:'任务'})).toMatch(/^#\/tasks\/%E4/) // 中文 UTF-8 编码起始
  );
});

describe("navigate · 副作用", () => {
  it.todo(
    "navigate 设置 window.location.hash 为 buildHash 结果",
    // setup: 用 jsdom 默认 window;先 window.location.hash = '#/overview'
    // act: navigate({name:'fleet'})
    // assert: window.location.hash === '#/fleet'
  );

  it.todo(
    "navigate 到同 hash 不重复 set(避免触发 hashchange 死循环)",
    // setup: window.location.hash = '#/fleet'
    // act: spy on Object.getOwnPropertyDescriptor(window.location,'hash')?.set
    //      navigate({name:'fleet'})
    // assert: setter 没被调用(或 navigate 提前 return)
  );
});

describe("useRoute · hook", () => {
  it.todo(
    "mount 时若无 hash,replace 为 DEFAULT_HASH('#/onboarding')",
    // setup: jsdom 默认 hash=''
    // act: renderHook(useRoute)
    // assert: window.location.hash === '#/onboarding'
  );

  it.todo(
    "hashchange 事件触发 → setRoute 同步",
    // act: 改 window.location.hash + dispatchEvent(new HashChangeEvent('hashchange'))
    // assert: result.current 同步变成新 route
  );

  it.todo(
    "unmount 时正确移除 hashchange listener,无泄漏",
    // assert: removeEventListener 被调用,且后续 hashchange 不再 update
  );
});

