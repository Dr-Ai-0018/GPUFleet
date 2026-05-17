import type {
  AdminProfile,
  AdminTaskDetail,
  AdminTaskListItem,
  AuditEventView,
  DashboardOverview,
  NodeCreatePayload,
  NodeCreateResponse,
  NodeResponse,
  NodeStatusPreview,
  NodeUpdatePayload,
  SecurityWarningView,
  TaskCreatePayload,
  TokenPair,
} from "./types";

const API_ROOT = "";

class ApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(body || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${API_ROOT}${path}`, { ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      if (parsed?.detail) detail = parsed.detail;
    } catch {
      /* keep raw text */
    }
    throw new ApiError(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export { ApiError };

export const api = {
  login(username: string, password: string): Promise<TokenPair> {
    return request<TokenPair>("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },

  refresh(refreshToken: string): Promise<TokenPair> {
    return request<TokenPair>("/api/admin/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  },

  getMe(token: string): Promise<AdminProfile> {
    return request<AdminProfile>("/api/admin/me", {}, token);
  },

  getOverview(token: string): Promise<DashboardOverview> {
    return request<DashboardOverview>("/api/admin/dashboard/overview", {}, token);
  },

  getNodes(token: string): Promise<NodeResponse[]> {
    return request<NodeResponse[]>("/api/admin/nodes", {}, token);
  },

  getNode(token: string, nodeId: string): Promise<NodeResponse> {
    return request<NodeResponse>(
      `/api/admin/nodes/${encodeURIComponent(nodeId)}`,
      {},
      token,
    );
  },

  createNode(token: string, payload: NodeCreatePayload): Promise<NodeCreateResponse> {
    return request<NodeCreateResponse>(
      "/api/admin/nodes",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    );
  },

  updateNode(token: string, nodeId: string, payload: NodeUpdatePayload): Promise<NodeResponse> {
    return request<NodeResponse>(
      `/api/admin/nodes/${encodeURIComponent(nodeId)}`,
      { method: "PATCH", body: JSON.stringify(payload) },
      token,
    );
  },

  enableNode(token: string, nodeId: string): Promise<NodeResponse> {
    return request<NodeResponse>(
      `/api/admin/nodes/${encodeURIComponent(nodeId)}/enable`,
      { method: "POST" },
      token,
    );
  },

  disableNode(token: string, nodeId: string): Promise<NodeResponse> {
    return request<NodeResponse>(
      `/api/admin/nodes/${encodeURIComponent(nodeId)}/disable`,
      { method: "POST" },
      token,
    );
  },

  getLatestNodeStatus(token: string, nodeId: string): Promise<NodeStatusPreview> {
    return request<NodeStatusPreview>(
      `/api/admin/nodes/${encodeURIComponent(nodeId)}/status/latest`,
      {},
      token,
    );
  },

  listTasks(token: string): Promise<AdminTaskListItem[]> {
    return request<AdminTaskListItem[]>("/api/admin/tasks", {}, token);
  },

  getTaskDetail(token: string, taskId: string): Promise<AdminTaskDetail> {
    return request<AdminTaskDetail>(
      `/api/admin/tasks/${encodeURIComponent(taskId)}`,
      {},
      token,
    );
  },

  createTask(token: string, payload: TaskCreatePayload): Promise<AdminTaskDetail> {
    return request<AdminTaskDetail>(
      "/api/admin/tasks",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    );
  },

  cancelTask(token: string, taskId: string): Promise<AdminTaskDetail> {
    return request<AdminTaskDetail>(
      `/api/admin/tasks/${encodeURIComponent(taskId)}/cancel`,
      { method: "POST" },
      token,
    );
  },

  getAuditEvents(token: string, limit = 50): Promise<AuditEventView[]> {
    return request<AuditEventView[]>(
      `/api/admin/audit-events?limit=${limit}`,
      {},
      token,
    );
  },

  getSecurityWarnings(token: string, limit = 50): Promise<SecurityWarningView[]> {
    return request<SecurityWarningView[]>(
      `/api/admin/security-warnings?limit=${limit}`,
      {},
      token,
    );
  },
};
