import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { ERROR_LABELS, labelForError } from "./labels";

const D1_ERROR_CODES = [
  "ERR_AUTH_INVALID_TOKEN",
  "ERR_AUTH_ADMIN_NOT_FOUND",
  "ERR_AUTH_TOKEN_REVOKED",
  "ERR_AUTH_REFRESH_REVOKED",
  "ERR_AUTH_INVALID_CREDENTIALS",
  "ERR_AUTH_INVALID_REFRESH_TOKEN",
  "ERR_AUTH_INVALID_TIMESTAMP",
  "ERR_AUTH_MISSING_HEADERS",
  "ERR_AUTH_TIMESTAMP_SKEW",
  "ERR_AUTH_NODE_NOT_FOUND_OR_DISABLED",
  "ERR_AUTH_SIGNING_KEY_UNAVAILABLE",
  "ERR_AUTH_INVALID_SIGNATURE",
  "ERR_AUTH_NONCE_DUPLICATE",
  "ERR_AUTH_TIMESTAMP_REPLAY",
  "ERR_NODE_NOT_FOUND",
  "ERR_NODE_DUPLICATE_ID",
  "ERR_NODE_NO_CHANGES",
  "ERR_NODE_STATUS_NOT_FOUND",
  "ERR_NODE_DISABLED",
  "ERR_TASK_NOT_FOUND",
  "ERR_TASK_DUPLICATE_ID",
  "ERR_TASK_TARGET_NODE_NOT_FOUND",
  "ERR_TASK_INVALID_TARGET_FOR_TYPE",
  "ERR_TASK_WORKDIR_NOT_ALLOWED",
  "ERR_TASK_TYPE_FORBIDDEN_ON_NODE",
  "ERR_TASK_INVALID_STATE_TRANSITION",
  "ERR_REVIEW_NOT_PENDING",
  "ERR_REVIEW_COOLDOWN_NOT_REACHED",
  "ERR_LOG_OFFSET_MUST_START_ZERO",
  "ERR_LOG_OFFSET_GAP",
  "ERR_LOG_STREAM_TRUNCATED",
  "ERR_STORAGE_QUOTA_EXCEEDED",
  "ERR_ARTIFACT_INVALID_NAME",
  "ERR_ARTIFACT_INVALID_CONTENT_LENGTH",
  "ERR_ARTIFACT_INVALID_BASE64",
  "ERR_PAYLOAD_TOO_LARGE",
  "ERR_ALERT_NOT_FOUND",
  "ERR_VALIDATION_FAILED",
  "ERR_VALIDATION_INVALID_PAYLOAD",
  "ERR_RATE_LIMITED",
] as const;

describe("ERROR_LABELS", () => {
  it("covers every D1 error code with a non-empty Chinese label", () => {
    expect(Object.keys(ERROR_LABELS).sort()).toEqual([...D1_ERROR_CODES].sort());
    for (const code of D1_ERROR_CODES) {
      expect(ERROR_LABELS[code]).toMatch(/[\u4e00-\u9fa5]/);
    }
  });

  it("labels ApiError by code and falls back for unknown errors", () => {
    expect(labelForError(new ApiError(404, "ERR_TASK_NOT_FOUND", "Task not found"))).toBe(
      "任务不存在",
    );
    expect(labelForError(new ApiError(499, "ERR_UNKNOWN", "Unknown thing"))).toBe("Unknown thing");
    expect(labelForError(new ApiError(418, "ERR_HTTP_418", "Teapot"))).toBe("请求失败（HTTP 418）");
    expect(labelForError("oops", "操作失败")).toBe("操作失败");
  });
});
