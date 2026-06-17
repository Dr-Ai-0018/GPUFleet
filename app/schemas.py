from __future__ import annotations

from datetime import datetime
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
    allow_shell: bool = False
    allow_modal: bool = False


class NodeUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    os_type: Literal["windows", "linux"] | None = None
    hostname: str | None = None
    heartbeat_interval_sec: int | None = Field(default=None, ge=3, le=3600)
    allowed_workdirs: list[str] | None = None
    tags: list[str] | None = None
    is_enabled: bool | None = None
    allow_shell: bool | None = None
    allow_modal: bool | None = None


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
    allow_shell: bool
    allow_modal: bool
    created_at: str
    updated_at: str


class NodeOnboardingPackage(BaseModel):
    control_plane_url: str
    env_template: str
    startup_command: str
    onboarding_steps: list[str] = Field(default_factory=list)


class NodeCreateResponse(NodeResponse):
    node_secret: str
    signing_hint: str = "Agent should locally derive sha256(node_secret) and use it as the HMAC signing key; the server stores only an encrypted form."
    onboarding: NodeOnboardingPackage


class HeartbeatCpu(BaseModel):
    model: str | None = Field(default=None, description="CPU model name reported by the node.")
    logical_cores: int | None = Field(default=None, description="Visible logical CPU core count.")
    physical_cores: int | None = Field(default=None, description="Physical CPU core count when detectable.")
    usage_percent: float | None = Field(default=None, description="Overall CPU utilization percentage.")
    current_clock_mhz: int | None = Field(default=None, description="Current effective CPU clock in MHz.")
    max_clock_mhz: int | None = Field(default=None, description="Observed CPU max clock in MHz.")
    per_core_percent: list[float] = Field(default_factory=list, description="Per-core utilization percentages.")


class HeartbeatMemory(BaseModel):
    total_bytes: int | None = Field(default=None, description="Total system memory in bytes.")
    used_bytes: int | None = Field(default=None, description="Used system memory in bytes.")
    usage_percent: float | None = Field(default=None, description="Overall memory utilization percentage.")
    available_bytes: int | None = Field(default=None, description="Memory immediately available to new processes.")
    cached_bytes: int | None = Field(default=None, description="Cached memory in bytes when available.")
    commit_used_bytes: int | None = Field(default=None, description="Committed memory currently in use.")
    commit_limit_bytes: int | None = Field(default=None, description="Commit limit in bytes.")
    paged_pool_bytes: int | None = Field(default=None, description="Paged kernel pool bytes on Windows hosts.")
    nonpaged_pool_bytes: int | None = Field(default=None, description="Non-paged kernel pool bytes on Windows hosts.")
    speed_mtps: int | None = Field(default=None, description="Memory speed in MT/s when detectable.")
    slots_used: int | None = Field(default=None, description="Number of populated memory slots.")
    slots_total: int | None = Field(default=None, description="Total motherboard memory slots.")
    form_factor: str | None = Field(default=None, description="Memory module form factor.")
    memory_type: str | None = Field(default=None, description="Memory technology such as DDR5.")
    installed_bytes: int | None = Field(default=None, description="Installed physical memory in bytes.")
    hardware_reserved_bytes: int | None = Field(default=None, description="Hardware-reserved memory in bytes.")


class HeartbeatDisk(BaseModel):
    mount: str = Field(description="Mount point or drive letter.")
    total_bytes: int | None = Field(default=None, description="Total disk capacity in bytes.")
    free_bytes: int | None = Field(default=None, description="Free disk space in bytes.")
    usage_percent: float | None = Field(default=None, description="Disk utilization percentage.")


class HeartbeatGpu(BaseModel):
    index: int = Field(description="Zero-based GPU index on the node.")
    model: str | None = Field(default=None, description="GPU model name.")
    total_vram_mb: int | None = Field(default=None, description="Total VRAM in MiB.")
    used_vram_mb: int | None = Field(default=None, description="Used VRAM in MiB.")
    utilization_percent: float | None = Field(default=None, description="Core utilization percentage.")
    encoder_utilization_percent: float | None = Field(default=None, description="NVENC utilization percentage.")
    decoder_utilization_percent: float | None = Field(default=None, description="NVDEC utilization percentage.")
    temperature_c: float | None = Field(default=None, description="Current GPU temperature in Celsius.")
    power_draw_w: float | None = Field(default=None, description="Current GPU power draw in watts.")
    power_limit_w: float | None = Field(default=None, description="Configured GPU power limit in watts.")
    clock_graphics_mhz: int | None = Field(default=None, description="Current graphics clock in MHz.")
    clock_max_graphics_mhz: int | None = Field(default=None, description="Maximum graphics clock in MHz.")
    clock_video_mhz: int | None = Field(default=None, description="Current video clock in MHz.")
    fan_speed_percent: int | None = Field(default=None, description="Fan speed percentage when available.")
    pcie_gen: int | None = Field(default=None, description="Current PCIe generation.")
    pcie_width: int | None = Field(default=None, description="Current PCIe lane width.")
    encoder_sessions: int | None = Field(default=None, description="Active encoder session count.")
    decoder_sessions: int | None = Field(default=None, description="Active decoder session count.")


class HeartbeatNvidia(BaseModel):
    driver_version: str | None = Field(default=None, description="Installed NVIDIA driver version.")
    cuda_version: str | None = Field(default=None, description="CUDA runtime version.")
    nvcc_version: str | None = Field(default=None, description="nvcc compiler version when installed.")
    nvidia_smi_path: str | None = Field(default=None, description="Resolved nvidia-smi executable path.")


class HeartbeatPythonEnv(BaseModel):
    python_executable: str | None = Field(default=None, description="Resolved Python executable path.")
    venv_path: str | None = Field(default=None, description="Virtual environment path if active.")
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
    supported_backends: list[str] = Field(default_factory=list, description="Execution backends available on this node.")


class HeartbeatTaskRuntime(BaseModel):
    active_task_id: str | None = Field(default=None, description="Task id currently executing on the node.")
    active_pid: int | None = Field(default=None, description="Worker PID for the active task.")
    started_at: str | None = Field(default=None, description="UTC timestamp when the active task started.")


class HeartbeatSampleGpu(BaseModel):
    """高密 sample 内单卡的瞬时指标."""

    idx: int = Field(ge=0, description="GPU device index (与节点上 CUDA device 顺序一致).")
    util: float | None = Field(default=None, description="GPU 利用率百分比 (0-100).")
    temp_c: float | None = Field(default=None, description="GPU 温度 (摄氏度).")
    vram_used_bytes: int | None = Field(default=None, description="GPU 已用显存 (字节).")
    power_w: float | None = Field(default=None, description="GPU 当前功耗 (瓦特).")


class HeartbeatSample(BaseModel):
    """节点本地高密采样的单个时间点 (默认 1s/次)."""

    ts: datetime = Field(description="采样时刻 (节点本地系统时钟, UTC ISO8601 含毫秒).")
    cpu_percent: float | None = Field(default=None, description="该时刻 CPU 使用率 (0-100).")
    per_core_percent: list[float] = Field(default_factory=list, description="该时刻每个逻辑 CPU 核心的使用率 (0-100).")
    cpu_current_clock_mhz: int | None = Field(default=None, description="该时刻 CPU 当前频率 (MHz).")
    memory_percent: float | None = Field(default=None, description="该时刻内存使用率 (0-100).")
    memory_used_bytes: int | None = Field(default=None, description="该时刻已用内存字节数.")
    memory_available_bytes: int | None = Field(default=None, description="该时刻可用内存字节数.")
    gpus: list[HeartbeatSampleGpu] = Field(
        default_factory=list,
        description="该时刻所有 GPU 卡的瞬时指标 (覆盖多卡场景).",
    )
    upload_bps: float | None = Field(
        default=None,
        description="自上次采样以来的上行字节速率 (bytes/sec). 首次采样为 None.",
    )
    download_bps: float | None = Field(
        default=None,
        description="自上次采样以来的下行字节速率 (bytes/sec). 首次采样为 None.",
    )


class HeartbeatRequest(BaseModel):
    boot_id: str = Field(min_length=3, max_length=200)
    agent_version: str | None = None
    hostname: str | None = None
    heartbeat_interval_sec: int = Field(default=5, ge=3, le=3600)
    sample_interval_sec: int | None = Field(
        default=None,
        ge=1,
        le=60,
        description="高密采样间隔 (秒). 节点支持高密采样时填写, 否则保留为 None.",
    )
    cpu: HeartbeatCpu = Field(default_factory=HeartbeatCpu)
    memory: HeartbeatMemory = Field(default_factory=HeartbeatMemory)
    disks: list[HeartbeatDisk] = Field(default_factory=list)
    gpus: list[HeartbeatGpu] = Field(default_factory=list)
    nvidia: HeartbeatNvidia = Field(default_factory=HeartbeatNvidia)
    python_env: HeartbeatPythonEnv = Field(default_factory=HeartbeatPythonEnv)
    task_runtime: HeartbeatTaskRuntime = Field(default_factory=HeartbeatTaskRuntime)
    extra: dict[str, Any] = Field(default_factory=dict)
    samples: list[HeartbeatSample] = Field(
        default_factory=list,
        description="本次心跳累积的高密采样数组, 单次心跳长度 = heartbeat_interval / sample_interval. "
        "缺失或为空时退化为单点心跳, 兼容旧 agent.",
    )


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


class ReviewResult(BaseModel):
    """AI 审核结果摘要"""
    stage: int
    decision: str
    risk_score: float | None = None
    risk_factors: list[dict[str, Any]] = Field(default_factory=list)
    reasoning: str | None = None


class ReviewEscalateRequest(BaseModel):
    note: str | None = None


class ReviewApproveRequest(BaseModel):
    note: str | None = None


class ReviewRejectRequest(BaseModel):
    note: str | None = None


class AlertMessageView(BaseModel):
    id: int
    alert_type: str
    severity: str
    title: str
    summary: str | None
    detail: dict[str, Any] = Field(default_factory=dict)
    target_type: str | None
    target_id: str | None
    status: str
    actioned_by: int | None
    actioned_at: str | None
    expires_at: str | None
    created_at: str


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


class AdminTaskListPage(BaseModel):
    items: list[AdminTaskListItem]
    next_cursor: str | None = None
    total_estimate: int | None = None


class AdminTaskLogView(BaseModel):
    stream: Literal["stdout", "stderr"]
    last_offset: int
    preview_text: str
    center_log_path: str | None
    is_truncated: bool = False
    truncated_notice: str | None = None
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
    review_stage: int | None = None
    review_decision: str | None = None


class HeartbeatResponse(BaseModel):
    server_time: str
    accepted: bool = True
    node_id: str
    tasks: list[TaskEnvelope] = Field(default_factory=list)
    task_controls: list[TaskControlCommand] = Field(default_factory=list)
    refresh_fingerprint: bool = Field(
        default=False,
        description="若为 true, 节点收到后应异步重采完整指纹 (CPU 型号 / GPU 详情 / 虚拟化 / 网络 / Python 环境等), 下次心跳带新指纹.",
    )


class NodeStatusPreview(BaseModel):
    reported_at: str = Field(description="UTC timestamp when the status snapshot was reported.")
    cpu: HeartbeatCpu = Field(default_factory=HeartbeatCpu, description="Structured CPU snapshot for the node.")
    memory: HeartbeatMemory = Field(default_factory=HeartbeatMemory, description="Structured memory snapshot for the node.")
    disks: list[HeartbeatDisk] = Field(default_factory=list, description="Disk snapshots reported by the node.")
    gpus: list[HeartbeatGpu] = Field(default_factory=list, description="GPU snapshots reported by the node.")
    nvidia: HeartbeatNvidia = Field(default_factory=HeartbeatNvidia, description="NVIDIA runtime metadata.")
    python_env: HeartbeatPythonEnv = Field(default_factory=HeartbeatPythonEnv, description="Python environment snapshot.")
    task_runtime: HeartbeatTaskRuntime = Field(default_factory=HeartbeatTaskRuntime, description="Current active task runtime snapshot.")
    extra: dict[str, Any] = Field(default_factory=dict, description="Additional agent-provided status data.")


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


class AuditEventPage(BaseModel):
    items: list[AuditEventView]
    next_cursor: str | None = None
    total_estimate: int | None = None


class SecurityWarningView(BaseModel):
    id: int
    source_type: str
    source_id: str | None
    warning_type: str
    command_excerpt: str | None
    detail: dict[str, Any]
    created_at: str


class SecurityWarningPage(BaseModel):
    items: list[SecurityWarningView]
    next_cursor: str | None = None
    total_estimate: int | None = None


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
