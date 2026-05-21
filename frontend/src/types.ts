export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
};

export type AdminProfile = {
  id: number;
  username: string;
  is_active: boolean;
  last_login_at: string | null;
};

export type NodeOnboardingPackage = {
  control_plane_url: string;
  env_template: string;
  startup_command: string;
  onboarding_steps: string[];
};

export type NodeStatusPreview = {
  reported_at: string;
  cpu: Record<string, unknown>;
  memory: Record<string, unknown>;
  disks: Array<Record<string, unknown>>;
  gpus: Array<Record<string, unknown>>;
  nvidia: Record<string, unknown>;
  python_env: Record<string, unknown>;
  task_runtime: Record<string, unknown>;
  extra: Record<string, unknown>;
};

export type OnlineStatus = "online" | "offline" | "never_seen" | "disabled";
export type OnboardingStatus = "awaiting_first_heartbeat" | "connected" | "disabled";

export type DashboardNodeCard = {
  node_id: string;
  display_name: string;
  node_type: string;
  os_type: string | null;
  hostname: string | null;
  tags: string[];
  is_enabled: boolean;
  heartbeat_interval_sec: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  onboarding_status: OnboardingStatus;
  online_status: OnlineStatus;
  latest_status: NodeStatusPreview | null;
  active_task: {
    task_id: string;
    type: string;
    status: string;
    started_at: string | null;
    claimed_at: string | null;
  } | null;
};

export type DashboardTaskSummary = {
  task_id: string;
  node_id: string;
  type: string;
  status: string;
  created_at: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type DashboardOverview = {
  server_time: string;
  node_counts: Record<string, number>;
  task_counts: Record<string, number>;
  nodes: DashboardNodeCard[];
  recent_tasks: DashboardTaskSummary[];
  task_throughput_24h: number[];
};

export type NodeStatusHistoryItem = {
  reported_at: string;
  cpu_usage_percent: number | null;
  memory_usage_percent: number | null;
  gpu_utilization_percent: number | null;
  gpu_memory_percent: number | null;
  gpu_temperature_c: number | null;
  gpu_power_draw_w: number | null;
  gpu_clock_graphics_mhz: number | null;
};

export type NodeStatusHistoryResponse = {
  node_id: string;
  items: NodeStatusHistoryItem[];
};

export type NodeResponse = {
  node_id: string;
  display_name: string;
  node_type: string;
  os_type: string | null;
  hostname: string | null;
  heartbeat_interval_sec: number;
  allowed_workdirs: string[];
  tags: string[];
  is_enabled: boolean;
  first_seen_at: string | null;
  last_seen_at: string | null;
  connection_status: OnlineStatus;
  onboarding_status: OnboardingStatus;
  created_at: string;
  updated_at: string;
};

export type NodeCreateResponse = NodeResponse & {
  node_secret: string;
  signing_hint: string;
  onboarding: NodeOnboardingPackage;
};

export type NodeResetSecretResponse = NodeResponse & {
  node_secret: string;
  signing_hint: string;
  onboarding: NodeOnboardingPackage;
};

export type AdminTaskListItem = {
  task_id: string;
  revision: number;
  node_id: string;
  type: string;
  status: string;
  workdir: string | null;
  requested_gpu_ids: number[];
  timeout_sec: number;
  danger_level: string;
  created_at: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type AdminTaskLogView = {
  stream: "stdout" | "stderr";
  last_offset: number;
  preview_text: string;
  center_log_path: string | null;
  updated_at: string;
};

export type AdminTaskArtifactView = {
  artifact_name: string;
  artifact_type: string;
  content_type: string | null;
  size_bytes: number;
  storage_path: string;
  preview: Record<string, unknown>;
  created_at: string;
};

export type AdminTaskResultSummary = {
  exit_code: number | null;
  summary: Record<string, unknown>;
  finished_at: string | null;
};

export type AdminTaskDetail = AdminTaskListItem & {
  idempotency_key: string;
  payload: Record<string, unknown>;
  env: Record<string, string>;
  kill_grace_sec: number;
  logs: AdminTaskLogView[];
  artifacts: AdminTaskArtifactView[];
  result: AdminTaskResultSummary | null;
};

export type AuditEventView = {
  id: number;
  actor_type: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  request_ip: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};

export type SecurityWarningView = {
  id: number;
  source_type: string;
  source_id: string | null;
  warning_type: string;
  command_excerpt: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};

export type NodeType = "physical" | "modal_runner" | "control_plane";
export type OsType = "windows" | "linux";

export type NodeCreatePayload = {
  node_id: string;
  display_name: string;
  node_type: NodeType;
  os_type?: OsType | null;
  hostname?: string | null;
  heartbeat_interval_sec?: number;
  allowed_workdirs?: string[];
  tags?: string[];
};

export type NodeUpdatePayload = {
  display_name?: string;
  os_type?: OsType | null;
  hostname?: string | null;
  heartbeat_interval_sec?: number;
  allowed_workdirs?: string[];
  tags?: string[];
  is_enabled?: boolean;
};

export type TaskCreatePayload = {
  node_id: string;
  type: string;
  payload: Record<string, unknown>;
  task_id?: string | null;
  revision?: number;
  idempotency_key?: string | null;
  workdir?: string | null;
  env?: Record<string, string>;
  requested_gpu_ids?: number[];
  timeout_sec?: number | null;
  kill_grace_sec?: number;
  danger_level?: string;
};

export type ListQuery = {
  limit?: number;
  offset?: number;
};
