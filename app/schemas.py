from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


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
    heartbeat_interval_sec: int = Field(default=10, ge=3, le=3600)
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
    last_seen_at: str | None
    created_at: str
    updated_at: str


class NodeCreateResponse(NodeResponse):
    node_secret: str
    signing_hint: str = "Agent should locally derive sha256(node_secret) and use it as the HMAC signing key."


class HeartbeatCpu(BaseModel):
    model: str | None = None
    logical_cores: int | None = None
    usage_percent: float | None = None


class HeartbeatMemory(BaseModel):
    total_bytes: int | None = None
    used_bytes: int | None = None
    usage_percent: float | None = None


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
    temperature_c: float | None = None


class HeartbeatPythonEnv(BaseModel):
    python_executable: str | None = None
    venv_path: str | None = None
    pip_available: bool = False
    python_version: str | None = None


class HeartbeatTaskRuntime(BaseModel):
    active_task_id: str | None = None
    active_pid: int | None = None
    started_at: str | None = None


class HeartbeatRequest(BaseModel):
    boot_id: str = Field(min_length=3, max_length=200)
    agent_version: str | None = None
    hostname: str | None = None
    heartbeat_interval_sec: int = Field(default=10, ge=3, le=3600)
    cpu: HeartbeatCpu = Field(default_factory=HeartbeatCpu)
    memory: HeartbeatMemory = Field(default_factory=HeartbeatMemory)
    disks: list[HeartbeatDisk] = Field(default_factory=list)
    gpus: list[HeartbeatGpu] = Field(default_factory=list)
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


class AdminTaskCreateRequest(BaseModel):
    node_id: str
    type: str
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


class NodeStatusPreview(BaseModel):
    reported_at: str
    cpu: dict[str, Any]
    memory: dict[str, Any]
    disks: list[dict[str, Any]]
    gpus: list[dict[str, Any]]
    python_env: dict[str, Any]
    task_runtime: dict[str, Any]


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
