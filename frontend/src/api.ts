import type {
  AdminProfile,
  AdminTaskDetail,
  AdminTaskListItem,
  AdminTaskListPage,
  AlertMessageView,
  AuditEventView,
  AuditEventPage,
  DashboardOverview,
  NodeCreatePayload,
  NodeCreateResponse,
  NodeOnboardingLifecycleResponse,
  NodeResetSecretResponse,
  NodeResponse,
  NodeStatusHistoryResponse,
  NodeStatusPreview,
  NodeUpdatePayload,
  SecurityWarningView,
  SecurityWarningPage,
  TaskCreatePayload,
  ListQuery,
  TokenPair,
} from "./types";

const API_ROOT = "";
const API_BASE = "/api/v1";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 200;

type ApiErrorDetails = Record<string, unknown>;

class ApiError extends Error {
  status: number;
  code: string;
  details?: ApiErrorDetails;
  body: string;

  constructor(status: number, code: string, message: string, details?: ApiErrorDetails) {
    super(message || `HTTP ${status}`);
    this.status = status;
    this.code = code;
    this.details = details;
    this.body = this.message;
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

      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      continue;
    } catch (error) {
      window.clearTimeout(timeoutId);
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("请求超时,请稍后重试");
      }
      lastError = error;
      if (attempt === MAX_RETRY_ATTEMPTS) {
        break;
      }
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("请求失败");
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
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
    let code = `ERR_HTTP_${response.status}`;
    let message = text || `HTTP ${response.status}`;
    let details: ApiErrorDetails | undefined;
    try {
      const parsed = JSON.parse(text) as {
        code?: string;
        message?: string;
        details?: ApiErrorDetails;
      };
      code = parsed.code ?? code;
      message = parsed.message ?? `HTTP ${response.status}`;
      details = parsed.details;
    } catch {
      /* keep raw text */
    }
    throw new ApiError(response.status, code, message, details);
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
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.node_id) params.set("node_id", query.node_id);
  if (query.status) params.set("status", query.status);
  if (query.type) params.set("type", query.type);
  if (query.since) params.set("since", query.since);
  if (query.until) params.set("until", query.until);
  if (query.actor_type) params.set("actor_type", query.actor_type);
  if (query.action) params.set("action", query.action);
  if (query.target_type) params.set("target_type", query.target_type);
  if (query.warning_type) params.set("warning_type", query.warning_type);
  if (query.source_type) params.set("source_type", query.source_type);
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
    const page = await request<T[]>(`${path}${buildListQuery({ limit, offset })}`, {}, token);
    items.push(...page);
    if (page.length < limit) {
      return items;
    }
    offset += page.length;
  }
}

async function requestAllCursorPages<T>(
  token: string,
  path: string,
  limit = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await request<{ items: T[]; next_cursor?: string | null }>(
      `${path}${buildListQuery({ limit, cursor })}`,
      {},
      token,
    );
    items.push(...page.items);
    if (!page.next_cursor) {
      return items;
    }
    cursor = page.next_cursor;
  }
}

export const api = {
  login(username: string, password: string): Promise<TokenPair> {
    return request<TokenPair>(`${API_BASE}/admin/login`, {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },

  refresh(refreshToken: string): Promise<TokenPair> {
    return request<TokenPair>(`${API_BASE}/admin/refresh`, {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  },

  logout(token: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`${API_BASE}/admin/logout`, { method: "POST" }, token);
  },

  listAlerts(token: string, statusFilter?: "unread" | "read"): Promise<AlertMessageView[]> {
    const query = statusFilter ? `?status=${statusFilter}&limit=50` : "?limit=50";
    return request<AlertMessageView[]>(`${API_BASE}/admin/alerts${query}`, {}, token);
  },

  getAlertsUnreadCount(token: string): Promise<{ unread_count: number }> {
    return request<{ unread_count: number }>(`${API_BASE}/admin/alerts/unread-count`, {}, token);
  },

  markAlertRead(token: string, alertId: number): Promise<AlertMessageView> {
    return request<AlertMessageView>(
      `${API_BASE}/admin/alerts/${alertId}/read`,
      { method: "POST" },
      token,
    );
  },

  getMe(token: string): Promise<AdminProfile> {
    return request<AdminProfile>(`${API_BASE}/admin/me`, {}, token);
  },

  getOverview(token: string): Promise<DashboardOverview> {
    return request<DashboardOverview>(`${API_BASE}/admin/dashboard/overview`, {}, token);
  },

  getNodes(token: string, query?: ListQuery): Promise<NodeResponse[]> {
    return request<NodeResponse[]>(`${API_BASE}/admin/nodes${buildListQuery(query)}`, {}, token);
  },

  listAllNodes(token: string): Promise<NodeResponse[]> {
    return requestAllPages<NodeResponse>(token, `${API_BASE}/admin/nodes`);
  },

  getNode(token: string, nodeId: string): Promise<NodeResponse> {
    return request<NodeResponse>(
      `${API_BASE}/admin/nodes/${encodeURIComponent(nodeId)}`,
      {},
      token,
    );
  },

  createNode(token: string, payload: NodeCreatePayload): Promise<NodeCreateResponse> {
    return request<NodeCreateResponse>(
      `${API_BASE}/admin/nodes`,
      { method: "POST", body: JSON.stringify(payload) },
      token,
    );
  },

  updateNode(token: string, nodeId: string, payload: NodeUpdatePayload): Promise<NodeResponse> {
    return request<NodeResponse>(
      `${API_BASE}/admin/nodes/${encodeURIComponent(nodeId)}`,
      { method: "PATCH", body: JSON.stringify(payload) },
      token,
    );
  },

  enableNode(token: string, nodeId: string): Promise<NodeResponse> {
    return request<NodeResponse>(
      `${API_BASE}/admin/nodes/${encodeURIComponent(nodeId)}/enable`,
      { method: "POST" },
      token,
    );
  },

  disableNode(token: string, nodeId: string): Promise<NodeResponse> {
    return request<NodeResponse>(
      `${API_BASE}/admin/nodes/${encodeURIComponent(nodeId)}/disable`,
      { method: "POST" },
      token,
    );
  },

  getLatestNodeStatus(token: string, nodeId: string): Promise<NodeStatusPreview> {
    return request<NodeStatusPreview>(
      `${API_BASE}/admin/nodes/${encodeURIComponent(nodeId)}/status/latest`,
      {},
      token,
    );
  },

  resetNodeSecret(token: string, nodeId: string): Promise<NodeResetSecretResponse> {
    return request<NodeResetSecretResponse>(
      `${API_BASE}/admin/nodes/${encodeURIComponent(nodeId)}/reset-secret`,
      { method: "POST" },
      token,
    );
  },

  getNodeOnboarding(token: string, nodeId: string): Promise<NodeOnboardingLifecycleResponse> {
    return request<NodeOnboardingLifecycleResponse>(
      `${API_BASE}/admin/nodes/${encodeURIComponent(nodeId)}/onboarding`,
      {},
      token,
    );
  },

  regenerateNodeOnboarding(
    token: string,
    nodeId: string,
  ): Promise<NodeOnboardingLifecycleResponse> {
    return request<NodeOnboardingLifecycleResponse>(
      `${API_BASE}/admin/nodes/${encodeURIComponent(nodeId)}/onboarding/regenerate`,
      { method: "POST" },
      token,
    );
  },

  deleteNode(token: string, nodeId: string): Promise<void> {
    return request<void>(
      `${API_BASE}/admin/nodes/${encodeURIComponent(nodeId)}`,
      { method: "DELETE" },
      token,
    );
  },

  refreshNodeFingerprint(
    token: string,
    nodeId: string,
  ): Promise<{ status: string; node_id: string; note?: string }> {
    return request(
      `${API_BASE}/admin/nodes/${encodeURIComponent(nodeId)}/refresh-fingerprint`,
      { method: "POST" },
      token,
    );
  },

  listTasks(token: string, query?: ListQuery): Promise<AdminTaskListPage> {
    return request<AdminTaskListPage>(`${API_BASE}/admin/tasks${buildListQuery(query)}`, {}, token);
  },

  listAllTasks(token: string): Promise<AdminTaskListItem[]> {
    return requestAllCursorPages<AdminTaskListItem>(token, `${API_BASE}/admin/tasks`);
  },

  getTaskDetail(token: string, taskId: string): Promise<AdminTaskDetail> {
    return request<AdminTaskDetail>(
      `${API_BASE}/admin/tasks/${encodeURIComponent(taskId)}`,
      {},
      token,
    );
  },

  escalateReview(token: string, taskId: string, note?: string): Promise<AdminTaskDetail> {
    return request<AdminTaskDetail>(
      `${API_BASE}/admin/tasks/${encodeURIComponent(taskId)}/review/escalate`,
      { method: "POST", body: JSON.stringify({ note: note ?? null }) },
      token,
    );
  },

  approveReview(token: string, taskId: string, note?: string): Promise<AdminTaskDetail> {
    return request<AdminTaskDetail>(
      `${API_BASE}/admin/tasks/${encodeURIComponent(taskId)}/review/approve`,
      { method: "POST", body: JSON.stringify({ note: note ?? null }) },
      token,
    );
  },

  rejectReview(token: string, taskId: string, note?: string): Promise<AdminTaskDetail> {
    return request<AdminTaskDetail>(
      `${API_BASE}/admin/tasks/${encodeURIComponent(taskId)}/review/reject`,
      { method: "POST", body: JSON.stringify({ note: note ?? null }) },
      token,
    );
  },

  createTask(token: string, payload: TaskCreatePayload): Promise<AdminTaskDetail> {
    return request<AdminTaskDetail>(
      `${API_BASE}/admin/tasks`,
      { method: "POST", body: JSON.stringify(payload) },
      token,
    );
  },

  cancelTask(token: string, taskId: string): Promise<AdminTaskDetail> {
    return request<AdminTaskDetail>(
      `${API_BASE}/admin/tasks/${encodeURIComponent(taskId)}/cancel`,
      { method: "POST" },
      token,
    );
  },

  getAuditEvents(token: string, limit = 50): Promise<AuditEventView[]> {
    return request<AuditEventView[]>(`${API_BASE}/admin/audit-events?limit=${limit}`, {}, token);
  },

  listAudits(token: string, query?: ListQuery): Promise<AuditEventPage> {
    return request<AuditEventPage>(`${API_BASE}/admin/audits${buildListQuery(query)}`, {}, token);
  },

  getSecurityWarnings(token: string, limit = 50): Promise<SecurityWarningView[]> {
    return request<SecurityWarningView[]>(
      `${API_BASE}/admin/security-warnings?limit=${limit}`,
      {},
      token,
    );
  },

  listWarnings(token: string, query?: ListQuery): Promise<SecurityWarningPage> {
    return request<SecurityWarningPage>(
      `${API_BASE}/admin/warnings${buildListQuery(query)}`,
      {},
      token,
    );
  },

  getNodeStatusHistory(
    token: string,
    nodeId: string,
    options: { limit?: number; since?: string; until?: string } = {},
  ): Promise<NodeStatusHistoryResponse> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.since) params.set("since", options.since);
    if (options.until) params.set("until", options.until);
    const qs = params.toString();
    return request<NodeStatusHistoryResponse>(
      `${API_BASE}/admin/nodes/${encodeURIComponent(nodeId)}/status/history${qs ? `?${qs}` : ""}`,
      {},
      token,
    );
  },
};
