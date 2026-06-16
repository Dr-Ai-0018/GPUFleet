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
