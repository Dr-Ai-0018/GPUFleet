import type {
  AdminProfile,
  AdminTaskDetail,
  AdminTaskListItem,
  AuditEventView,
  DashboardOverview,
  NodeCreatePayload,
  NodeCreateResponse,
  NodeResetSecretResponse,
  NodeResponse,
  NodeStatusHistoryResponse,
  NodeStatusPreview,
  NodeUpdatePayload,
  SecurityWarningView,
  TaskCreatePayload,
  ListQuery,
  TokenPair,
} from "./types";

const API_ROOT = "";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 200;

class ApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(body || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isRetriableStatus(status: number): boolean {
  return status >= 500;
}

async function fetchWithPolicy(input: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      window.clearTimeout(timeoutId);

      if (!isRetriableStatus(response.status) || attempt === MAX_RETRY_ATTEMPTS) {
        return response;
      }

      await sleep(RETRY_BASE_DELAY_MS * (2 ** attempt));
      continue;
    } catch (error) {
      window.clearTimeout(timeoutId);
      lastError = error;
      if (attempt === MAX_RETRY_ATTEMPTS) {
        break;
      }
      await sleep(RETRY_BASE_DELAY_MS * (2 ** attempt));
    }
  }

  if (lastError instanceof DOMException && lastError.name === "AbortError") {
    throw new Error("请求超时，请稍后重试");
  }
  throw lastError instanceof Error ? lastError : new Error("请求失败");
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
  const response = await fetchWithPolicy(`${API_ROOT}${path}`, { ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { message?: string; detail?: string };
      detail = parsed?.message ?? parsed?.detail ?? detail;
    } catch {
      /* keep raw text */
    }
    throw new ApiError(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export { ApiError };

function buildListQuery(query?: ListQuery): string {
  if (!query) return "";
  const params = new URLSearchParams();
  if (typeof query.limit === "number") params.set("limit", String(query.limit));
  if (typeof query.offset === "number") params.set("offset", String(query.offset));
  const search = params.toString();
  return search ? `?${search}` : "";
}

const DEFAULT_PAGE_SIZE = 200;

async function requestAllPages<T>(
  token: string,
  path: string,
  limit = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;

  while (true) {
    const page = await request<T[]>(
      `${path}${buildListQuery({ limit, offset })}`,
      {},
      token,
    );
    items.push(...page);
    if (page.length < limit) {
      return items;
    }
    offset += page.length;
  }
}

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

  getNodes(token: string, query?: ListQuery): Promise<NodeResponse[]> {
    return request<NodeResponse[]>(`/api/admin/nodes${buildListQuery(query)}`, {}, token);
  },

  listAllNodes(token: string): Promise<NodeResponse[]> {
    return requestAllPages<NodeResponse>(token, "/api/admin/nodes");
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

  resetNodeSecret(token: string, nodeId: string): Promise<NodeResetSecretResponse> {
    return request<NodeResetSecretResponse>(
      `/api/admin/nodes/${encodeURIComponent(nodeId)}/reset-secret`,
      { method: "POST" },
      token,
    );
  },

  deleteNode(token: string, nodeId: string): Promise<void> {
    return request<void>(
      `/api/admin/nodes/${encodeURIComponent(nodeId)}`,
      { method: "DELETE" },
      token,
    );
  },

  refreshNodeFingerprint(
    token: string,
    nodeId: string,
  ): Promise<{ status: string; node_id: string; note?: string }> {
    return request(
      `/api/admin/nodes/${encodeURIComponent(nodeId)}/refresh-fingerprint`,
      { method: "POST" },
      token,
    );
  },

  listTasks(token: string, query?: ListQuery): Promise<AdminTaskListItem[]> {
    return request<AdminTaskListItem[]>(`/api/admin/tasks${buildListQuery(query)}`, {}, token);
  },

  listAllTasks(token: string): Promise<AdminTaskListItem[]> {
    return requestAllPages<AdminTaskListItem>(token, "/api/admin/tasks");
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

  getNodeStatusHistory(token: string, nodeId: string, limit = 60): Promise<NodeStatusHistoryResponse> {
    return request<NodeStatusHistoryResponse>(
      `/api/admin/nodes/${encodeURIComponent(nodeId)}/status/history?limit=${limit}`,
      {},
      token,
    );
  },
};
