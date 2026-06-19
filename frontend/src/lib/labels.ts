import { ApiError } from "../api";
import type { OnboardingStatus, OnlineStatus } from "../types";

export type StatusTone = "online" | "waiting" | "offline" | "danger" | "muted" | "running";

export const onboardingLabel: Record<OnboardingStatus, string> = {
  awaiting_first_heartbeat: "待接入",
  connected: "已接入",
  disabled: "已停用",
};

export const onboardingTone: Record<OnboardingStatus, StatusTone> = {
  awaiting_first_heartbeat: "waiting",
  connected: "online",
  disabled: "muted",
};

export const connectionLabel: Record<OnlineStatus, string> = {
  online: "在线",
  offline: "离线",
  never_seen: "未上线",
  disabled: "已停用",
};

export const connectionTone: Record<OnlineStatus, StatusTone> = {
  online: "online",
  offline: "offline",
  never_seen: "waiting",
  disabled: "muted",
};

export const taskStatusLabel: Record<string, string> = {
  pending: "排队中",
  claimed: "已领取",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  timeout: "超时",
  cancel_requested: "取消中",
  cancelled: "已取消",
  lost: "失联",
};

export const taskStatusTone: Record<string, StatusTone> = {
  pending: "muted",
  claimed: "running",
  running: "running",
  succeeded: "online",
  failed: "danger",
  timeout: "danger",
  cancel_requested: "waiting",
  cancelled: "muted",
  lost: "danger",
};

export const nodeTypeLabel: Record<string, string> = {
  physical: "物理节点",
  modal_runner: "Modal 代理",
  control_plane: "控制面",
};

export const osLabel: Record<string, string> = {
  windows: "Windows",
  linux: "Linux",
};

export const ERROR_LABELS: Record<string, string> = {
  ERR_AUTH_INVALID_TOKEN: "登录已过期，请重新登录",
  ERR_AUTH_ADMIN_NOT_FOUND: "管理员账号不存在",
  ERR_AUTH_TOKEN_REVOKED: "登录状态已失效，请重新登录",
  ERR_AUTH_REFRESH_REVOKED: "登录状态已失效，请重新登录",
  ERR_AUTH_INVALID_CREDENTIALS: "用户名或密码错误",
  ERR_AUTH_INVALID_REFRESH_TOKEN: "刷新令牌无效，请重新登录",
  ERR_AUTH_INVALID_TIMESTAMP: "节点请求时间格式无效",
  ERR_AUTH_MISSING_HEADERS: "节点认证信息不完整",
  ERR_AUTH_TIMESTAMP_SKEW: "节点时间偏差过大",
  ERR_AUTH_NODE_NOT_FOUND_OR_DISABLED: "节点不存在或已停用",
  ERR_AUTH_SIGNING_KEY_UNAVAILABLE: "节点签名密钥不可用",
  ERR_AUTH_INVALID_SIGNATURE: "节点签名校验失败",
  ERR_AUTH_NONCE_DUPLICATE: "节点请求 nonce 重复",
  ERR_AUTH_TIMESTAMP_REPLAY: "节点请求时间戳必须递增",

  ERR_NODE_NOT_FOUND: "节点不存在",
  ERR_NODE_DUPLICATE_ID: "节点 ID 已存在",
  ERR_NODE_NO_CHANGES: "没有可保存的变更",
  ERR_NODE_STATUS_NOT_FOUND: "暂无节点状态快照",
  ERR_NODE_DISABLED: "目标节点已停用",

  ERR_TASK_NOT_FOUND: "任务不存在",
  ERR_TASK_DUPLICATE_ID: "任务 ID 已存在",
  ERR_TASK_TARGET_NODE_NOT_FOUND: "目标节点不存在",
  ERR_TASK_INVALID_TARGET_FOR_TYPE: "任务类型与目标节点不匹配",
  ERR_TASK_WORKDIR_NOT_ALLOWED: "任务工作目录不在节点允许范围内",
  ERR_TASK_TYPE_FORBIDDEN_ON_NODE: "节点未启用该任务类型",
  ERR_TASK_INVALID_STATE_TRANSITION: "任务状态不允许执行该操作",

  ERR_REVIEW_NOT_PENDING: "任务当前不需要人工审核",
  ERR_REVIEW_COOLDOWN_NOT_REACHED: "审核冷却中，请稍候",

  ERR_LOG_OFFSET_MUST_START_ZERO: "日志首段必须从 offset 0 开始",
  ERR_LOG_OFFSET_GAP: "日志分片 offset 不连续",
  ERR_LOG_STREAM_TRUNCATED: "日志流已被截断",
  ERR_STORAGE_QUOTA_EXCEEDED: "存储配额已用尽",
  ERR_ARTIFACT_INVALID_NAME: "产物文件名无效",
  ERR_ARTIFACT_INVALID_CONTENT_LENGTH: "Content-Length 头无效",
  ERR_ARTIFACT_INVALID_BASE64: "产物内容不是有效的 base64",
  ERR_PAYLOAD_TOO_LARGE: "请求内容超出大小限制",

  ERR_ALERT_NOT_FOUND: "告警不存在",

  ERR_VALIDATION_FAILED: "提交内容校验失败",
  ERR_VALIDATION_INVALID_PAYLOAD: "节点上报内容格式无效",
  ERR_RATE_LIMITED: "请求过于频繁，请稍后再试",
};

export function labelForError(error: unknown, fallback = "操作失败"): string {
  if (error instanceof ApiError) {
    if (error.code.startsWith("ERR_HTTP_")) {
      return ERROR_LABELS[error.code] ?? `请求失败（HTTP ${error.status}）`;
    }
    return ERROR_LABELS[error.code] ?? error.message;
  }
  return error instanceof Error ? error.message : fallback;
}
