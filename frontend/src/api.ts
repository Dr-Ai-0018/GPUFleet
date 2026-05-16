import type {
  AdminTaskDetail,
  AuditEventView,
  DashboardOverview,
  NodeResponse,
  SecurityWarningView,
  TokenPair,
} from "./types";

const API_ROOT = "";

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function login(username: string, password: string): Promise<TokenPair> {
  return request<TokenPair>("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function getOverview(token: string): Promise<DashboardOverview> {
  return request<DashboardOverview>("/api/admin/dashboard/overview", {}, token);
}

export function getNodes(token: string): Promise<NodeResponse[]> {
  return request<NodeResponse[]>("/api/admin/nodes", {}, token);
}

export function getTaskDetail(token: string, taskId: string): Promise<AdminTaskDetail> {
  return request<AdminTaskDetail>(`/api/admin/tasks/${taskId}`, {}, token);
}

export function createTask(
  token: string,
  payload: {
    node_id: string;
    type: string;
    payload: Record<string, unknown>;
    workdir?: string | null;
    env?: Record<string, string>;
    requested_gpu_ids?: number[];
    timeout_sec?: number | null;
    kill_grace_sec?: number;
    danger_level?: string;
  },
): Promise<AdminTaskDetail> {
  return request<AdminTaskDetail>(
    "/api/admin/tasks",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export function cancelTask(token: string, taskId: string): Promise<AdminTaskDetail> {
  return request<AdminTaskDetail>(
    `/api/admin/tasks/${taskId}/cancel`,
    {
      method: "POST",
    },
    token,
  );
}

export function getAuditEvents(token: string, limit = 50): Promise<AuditEventView[]> {
  return request<AuditEventView[]>(`/api/admin/audit-events?limit=${limit}`, {}, token);
}

export function getSecurityWarnings(token: string, limit = 50): Promise<SecurityWarningView[]> {
  return request<SecurityWarningView[]>(`/api/admin/security-warnings?limit=${limit}`, {}, token);
}
