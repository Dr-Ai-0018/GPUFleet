from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# All task types currently supported by the node agent
TaskType = Literal[
    "shell",
    "python_script",
    "health_check",
    "git_pull",
    "pip_install",
    "download_file",
    "upload_and_unpack",
    "modal_command",
    "file_mkdir",
    "file_write",
    "file_patch_text",
    "file_move",
    "file_delete",
    "file_extract",
    "file_preview",
]


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class AdminProfile(BaseModel):
    id: int
    username: str
    is_active: bool
    last_login_at: str | None


class NodeCreateRequest(BaseModel):
    node_id: str = Field(min_length=3, max_length=100)
    display_name: str = Field(min_length=1, max_length=200)
    node_type: Literal["physical", "modal_runner", "control_plane"] = "physical"
    os_type: Literal["windows", "linux"] | None = None
    hostname: str | None = None
    heartbeat_interval_sec: int = Field(default=5, ge=3, le=3600)
    allowed_workdirs: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class NodeUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    os_type: Literal["windows", "linux"] | None = None
    hostname: str | None = None
    heartbeat_interval_sec: int | None = Field(default=None, ge=3, le=3600)
    allowed_workdirs: list[str] | None = None
    tags: list[str] | None = None
    is_enabled: bool | None = None


class NodeResponse(BaseModel):
    node_id: str
    display_name: str
    node_type: str
    os_type: str | None
    hostname: str | None
    heartbeat_interval_sec: int
    allowed_workdirs: list[str]
    tags: list[str]
    is_enabled: bool
    first_seen_at: str | None
    last_seen_at: str | None
    connection_status: Literal["online", "offline", "disabled", "never_seen"]
    onboarding_status: Literal["awaiting_first_heartbeat", "connected", "disabled"]
    created_at: str
    updated_at: str


class NodeOnboardingPackage(BaseModel):
    control_plane_url: str
    env_template: str
    startup_command: str
    onboarding_steps: list[str] = Field(default_factory=list)


class NodeCreateResponse(NodeResponse):
    node_secret: str
    signing_hint: str = "Agent should locally derive sha256(node_secret) and use it as the HMAC signing key."
    onboarding: NodeOnboardingPackage


class HeartbeatCpu(BaseModel):
    model: str | None = None
    logical_cores: int | None = None
    physical_cores: int | None = None
    usage_percent: float | None = None
    current_clock_mhz: int | None = None
    max_clock_mhz: int | None = None
    per_core_percent: list[float] = Field(default_factory=list)


class HeartbeatMemory(BaseModel):
    total_bytes: int | None = None
    used_bytes: int | None = None
    usage_percent: float | None = None
    available_bytes: int | None = None
    cached_bytes: int | None = None
    commit_used_bytes: int | None = None
    commit_limit_bytes: int | None = None
    paged_pool_bytes: int | None = None
    nonpaged_pool_bytes: int | None = None
    speed_mtps: int | None = None
    slots_used: int | None = None
    slots_total: int | None = None
    form_factor: str | None = None
    memory_type: str | None = None
    installed_bytes: int | None = None
    hardware_reserved_bytes: int | None = None


class HeartbeatDisk(BaseModel):
    mount: str
    total_bytes: int | None = None
    free_bytes: int | None = None
    usage_percent: float | None = None


class HeartbeatGpu(BaseModel):
    index: int
    model: str | None = None
    total_vram_mb: int | None = None
    used_vram_mb: int | None = None
    utilization_percent: float | None = None
    encoder_utilization_percent: float | None = None
    decoder_utilization_percent: float | None = None
    temperature_c: float | None = None
    power_draw_w: float | None = None
    power_limit_w: float | None = None
    clock_graphics_mhz: int | None = None
    clock_max_graphics_mhz: int | None = None
    clock_video_mhz: int | None = None
    fan_speed_percent: int | None = None
    pcie_gen: int | None = None
    pcie_width: int | None = None
    encoder_sessions: int | None = None
    decoder_sessions: int | None = None


class HeartbeatNvidia(BaseModel):
    driver_version: str | None = None
    cuda_version: str | None = None
    nvcc_version: str | None = None
    nvidia_smi_path: str | None = None


class HeartbeatPythonEnv(BaseModel):
    python_executable: str | None = None
    venv_path: str | None = None
    pip_available: bool = False
    python_version: str | None = None
    python_resolution_error: str | None = None
    active_environment_kind: str | None = None
    active_environment_name: str | None = None
    conda_prefix: str | None = None
    conda_default_env: str | None = None
    mamba_root_prefix: str | None = None
    uv_available: bool = False
    uv_executable: str | None = None
    conda_available: bool = False
    conda_executable: str | None = None
    micromamba_available: bool = False
    micromamba_executable: str | None = None
    supported_backends: list[str] = Field(default_factory=list)


class HeartbeatTaskRuntime(BaseModel):
    active_task_id: str | None = None
    active_pid: int | None = None
    started_at: str | None = None


class HeartbeatRequest(BaseModel):
    boot_id: str = Field(min_length=3, max_length=200)
    agent_version: str | None = None
    hostname: str | None = None
    heartbeat_interval_sec: int = Field(default=5, ge=3, le=3600)
    cpu: HeartbeatCpu = Field(default_factory=HeartbeatCpu)
    memory: HeartbeatMemory = Field(default_factory=HeartbeatMemory)
    disks: list[HeartbeatDisk] = Field(default_factory=list)
    gpus: list[HeartbeatGpu] = Field(default_factory=list)
    nvidia: HeartbeatNvidia = Field(default_factory=HeartbeatNvidia)
    python_env: HeartbeatPythonEnv = Field(default_factory=HeartbeatPythonEnv)
    task_runtime: HeartbeatTaskRuntime = Field(default_factory=HeartbeatTaskRuntime)
    extra: dict[str, Any] = Field(default_factory=dict)


class TaskEnvelope(BaseModel):
    task_id: str
    revision: int
    idempotency_key: str
    type: str
    payload: dict[str, Any]
    workdir: str | None = None
    env: dict[str, str] = Field(default_factory=dict)
    requested_gpu_ids: list[int] = Field(default_factory=list)
    timeout_sec: int = 3600
    kill_grace_sec: int = 15
    danger_level: str = "normal"


class TaskControlCommand(BaseModel):
    task_id: str
    action: Literal["cancel"]
    kill_grace_sec: int = 15


class AdminTaskCreateRequest(BaseModel):
    node_id: str
    type: TaskType
    payload: dict[str, Any] = Field(default_factory=dict)
    task_id: str | None = None
    revision: int = 1
    idempotency_key: str | None = None
    workdir: str | None = None
    env: dict[str, str] = Field(default_factory=dict)
    requested_gpu_ids: list[int] = Field(default_factory=list)
    timeout_sec: int | None = Field(default=None, ge=1, le=60 * 60 * 24 * 14)
    kill_grace_sec: int = Field(default=15, ge=1, le=600)
    danger_level: str = "normal"


class AdminTaskListItem(BaseModel):
    task_id: str
    revision: int
    node_id: str
    type: str
    status: str
    workdir: str | None
    requested_gpu_ids: list[int]
    timeout_sec: int
    danger_level: str
    created_at: str
    claimed_at: str | None
    started_at: str | None
    finished_at: str | None


class AdminTaskLogView(BaseModel):
    stream: Literal["stdout", "stderr"]
    last_offset: int
    preview_text: str
    center_log_path: str | None
    updated_at: str


class AdminTaskResultSummary(BaseModel):
    exit_code: int | None
    summary: dict[str, Any] = Field(default_factory=dict)
    finished_at: str | None


class AdminTaskArtifactView(BaseModel):
    artifact_name: str
    artifact_type: str
    content_type: str | None
    size_bytes: int
    storage_path: str
    preview: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class AdminTaskDetail(AdminTaskListItem):
    idempotency_key: str
    payload: dict[str, Any]
    env: dict[str, str]
    kill_grace_sec: int
    logs: list[AdminTaskLogView] = Field(default_factory=list)
    artifacts: list[AdminTaskArtifactView] = Field(default_factory=list)
    result: AdminTaskResultSummary | None = None


class HeartbeatResponse(BaseModel):
    server_time: str
    accepted: bool = True
    node_id: str
    tasks: list[TaskEnvelope] = Field(default_factory=list)
    task_controls: list[TaskControlCommand] = Field(default_factory=list)


class NodeStatusPreview(BaseModel):
    reported_at: str
    cpu: dict[str, Any]
    memory: dict[str, Any]
    disks: list[dict[str, Any]]
    gpus: list[dict[str, Any]]
    nvidia: dict[str, Any] = Field(default_factory=dict)
    python_env: dict[str, Any]
    task_runtime: dict[str, Any]
    extra: dict[str, Any] = Field(default_factory=dict)


class DashboardNodeCard(BaseModel):
    node_id: str
    display_name: str
    node_type: str
    os_type: str | None
    hostname: str | None
    tags: list[str]
    is_enabled: bool
    heartbeat_interval_sec: int
    first_seen_at: str | None
    last_seen_at: str | None
    online_status: Literal["online", "offline", "never_seen", "disabled"]
    onboarding_status: Literal["awaiting_first_heartbeat", "connected", "disabled"]
    latest_status: NodeStatusPreview | None = None
    active_task: dict[str, Any] | None = None


class DashboardTaskSummary(BaseModel):
    task_id: str
    node_id: str
    type: str
    status: str
    created_at: str
    claimed_at: str | None = None
    started_at: str | None = None
    finished_at: str | None = None


class DashboardOverview(BaseModel):
    server_time: str
    node_counts: dict[str, int]
    task_counts: dict[str, int]
    nodes: list[DashboardNodeCard]
    recent_tasks: list[DashboardTaskSummary]
    task_throughput_24h: list[int] = Field(default_factory=lambda: [0] * 24)


class AuditEventView(BaseModel):
    id: int
    actor_type: str
    actor_id: str | None
    action: str
    target_type: str
    target_id: str | None
    request_ip: str | None
    detail: dict[str, Any]
    created_at: str


class SecurityWarningView(BaseModel):
    id: int
    source_type: str
    source_id: str | None
    warning_type: str
    command_excerpt: str | None
    detail: dict[str, Any]
    created_at: str


class NodeTaskEventRequest(BaseModel):
    task_id: str
    event: Literal["claimed", "running", "cancelled", "failed", "timeout", "succeeded", "lost"]
    boot_id: str | None = None
    pid: int | None = None
    pgid_or_job_id: str | None = None
    detail: dict[str, Any] = Field(default_factory=dict)


class NodeTaskLogChunkRequest(BaseModel):
    task_id: str
    stream: Literal["stdout", "stderr"]
    offset_start: int = Field(ge=0)
    text: str
    is_final: bool = False


class NodeTaskResultRequest(BaseModel):
    task_id: str
    final_status: Literal["succeeded", "failed", "timeout", "cancelled", "lost"]
    exit_code: int | None = None
    summary: dict[str, Any] = Field(default_factory=dict)
    boot_id: str | None = None
    pid: int | None = None
    pgid_or_job_id: str | None = None
    started_at: str | None = None
    finished_at: str | None = None


class NodeArtifactUploadRequest(BaseModel):
    task_id: str
    artifact_name: str
    artifact_type: str
    content_base64: str
    content_type: str | None = None
    preview: dict[str, Any] = Field(default_factory=dict)


class NodeStatusHistoryItem(BaseModel):
    reported_at: str
    cpu_usage_percent: float | None = None
    memory_usage_percent: float | None = None
    gpu_utilization_percent: float | None = None
    gpu_memory_percent: float | None = None
    gpu_temperature_c: float | None = None
    gpu_power_draw_w: float | None = None
    gpu_clock_graphics_mhz: float | None = None


class NodeStatusHistoryResponse(BaseModel):
    node_id: str
    items: list[NodeStatusHistoryItem]
