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
