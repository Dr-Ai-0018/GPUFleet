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
