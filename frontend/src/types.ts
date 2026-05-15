export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
};

export type NodeStatusPreview = {
  reported_at: string;
  cpu: Record<string, unknown>;
  memory: Record<string, unknown>;
  disks: Array<Record<string, unknown>>;
  gpus: Array<Record<string, unknown>>;
  python_env: Record<string, unknown>;
  task_runtime: Record<string, unknown>;
};

export type DashboardNodeCard = {
  node_id: string;
  display_name: string;
  node_type: string;
  os_type: string | null;
  hostname: string | null;
  tags: string[];
  is_enabled: boolean;
  heartbeat_interval_sec: number;
  last_seen_at: string | null;
  online_status: "online" | "offline" | "never_seen" | "disabled";
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
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
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

export type AdminTaskDetail = {
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
  idempotency_key: string;
  payload: Record<string, unknown>;
  env: Record<string, string>;
  kill_grace_sec: number;
  logs: AdminTaskLogView[];
  artifacts: AdminTaskArtifactView[];
  result: AdminTaskResultSummary | null;
};
