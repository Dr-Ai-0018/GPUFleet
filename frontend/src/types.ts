import type { components } from "./types.generated";

type Schemas = components["schemas"];

export type TokenPair = Schemas["TokenPair"];
export type AdminProfile = Schemas["AdminProfile"];
export type NodeOnboardingPackage = Omit<Schemas["NodeOnboardingPackage"], "onboarding_steps"> & {
  onboarding_steps: string[];
};
export type NodeStatusPreview = Omit<
  Schemas["NodeStatusPreview"],
  "cpu" | "memory" | "disks" | "gpus" | "nvidia" | "python_env" | "task_runtime" | "extra"
> & {
  cpu: Schemas["HeartbeatCpu"];
  memory: Schemas["HeartbeatMemory"];
  disks: Schemas["HeartbeatDisk"][];
  gpus: Schemas["HeartbeatGpu"][];
  nvidia: Schemas["HeartbeatNvidia"];
  python_env: Schemas["HeartbeatPythonEnv"];
  task_runtime: Schemas["HeartbeatTaskRuntime"];
  extra: Record<string, unknown>;
};
export type DashboardNodeCard = Omit<Schemas["DashboardNodeCard"], "latest_status"> & {
  latest_status: NodeStatusPreview | null;
};
export type DashboardTaskSummary = Schemas["DashboardTaskSummary"];
export type DashboardOverview = Omit<Schemas["DashboardOverview"], "nodes" | "recent_tasks"> & {
  nodes: DashboardNodeCard[];
  recent_tasks: DashboardTaskSummary[];
};
export type NodeStatusHistoryItem = Schemas["NodeStatusHistoryItem"];
export type NodeStatusHistoryResponse = Schemas["NodeStatusHistoryResponse"];
export type NodeResponse = Schemas["NodeResponse"];
export type NodeCreateResponse = Omit<Schemas["NodeCreateResponse"], "onboarding"> & {
  onboarding: NodeOnboardingPackage;
};
export type NodeResetSecretResponse = NodeCreateResponse;
export type NodeOnboardingLifecycleResponse = Schemas["NodeOnboardingLifecycleResponse"];
export type AdminTaskListItem = Schemas["AdminTaskListItem"];
export type AdminTaskListPage = Schemas["AdminTaskListPage"];
export type AdminTaskLogView = Schemas["AdminTaskLogView"];
export type AdminTaskArtifactView = Schemas["AdminTaskArtifactView"];
export type AdminTaskResultSummary = Schemas["AdminTaskResultSummary"];
export type AdminTaskDetail = Omit<Schemas["AdminTaskDetail"], "logs" | "artifacts"> & {
  logs: AdminTaskLogView[];
  artifacts: AdminTaskArtifactView[];
};
export type AuditEventView = Schemas["AuditEventView"];
export type AuditEventPage = Schemas["AuditEventPage"];
export type SecurityWarningView = Schemas["SecurityWarningView"];
export type SecurityWarningPage = Schemas["SecurityWarningPage"];
export type AlertMessageView = Schemas["AlertMessageView"];

export type OnlineStatus = NonNullable<NodeResponse["connection_status"]>;
export type OnboardingStatus = NonNullable<NodeResponse["onboarding_status"]>;
export type NodeType = NonNullable<Schemas["NodeCreateRequest"]["node_type"]>;
export type OsType = NonNullable<Schemas["NodeCreateRequest"]["os_type"]>;

export type NodeCreatePayload = Omit<Schemas["NodeCreateRequest"], "allow_shell" | "allow_modal"> & {
  allow_shell?: boolean;
  allow_modal?: boolean;
};
export type NodeUpdatePayload = Schemas["NodeUpdateRequest"];
export type TaskCreatePayload = Omit<Schemas["AdminTaskCreateRequest"], "type"> & {
  type: string;
};

export type ListQuery = {
  limit?: number;
  offset?: number;
  cursor?: string;
  node_id?: string;
  status?: string;
  type?: string;
  since?: string;
  until?: string;
  actor_type?: string;
  action?: string;
  target_type?: string;
  warning_type?: string;
  source_type?: string;
};
